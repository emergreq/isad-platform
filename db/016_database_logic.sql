-- =====================================================================
-- 016. Логика базы данных портала ISAD Hub
-- =====================================================================
-- Миграция ничего не пересоздаёт. Она добавляет поверх таблиц 001–015:
--   1. служебные функции (кто действует, проверки доступа, рассылка);
--   2. ограничения CHECK, чтобы база сама не пускала неверные данные;
--   3. триггеры: история, журнал, переходы статусов, защита от ошибок;
--   4. процедуры и функции основных действий портала;
--   5. представление календаря и функцию календаря пользователя;
--   6. индексы под частые запросы.
--
-- Свои коды ошибок (SQLSTATE). Сервер превращает их в HTTP-ответы:
--   IH403 -> 403  действие не разрешено этой роли
--   IH404 -> 404  объект не найден или недоступен этому пользователю
--   IH409 -> 409  конфликт состояния: уже рассмотрено, нет мест, отменено
--   IH422 -> 422  данные не проходят правило предметной области
-- Сообщение ошибки написано для пользователя и показывается на сайте.
-- =====================================================================


-- =====================================================================
-- 1. Служебные функции
-- =====================================================================

-- Кто сейчас действует. Процедура записывает id пользователя в настройку
-- текущей транзакции, а триггеры журнала читают его оттуда. Настройка
-- живёт только до конца транзакции (третий аргумент set_config = true).
CREATE FUNCTION set_actor(p_actor integer) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.actor_id', COALESCE(p_actor::text, ''), true);
END $$;

CREATE FUNCTION app_actor() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::integer
$$;

-- Дата по Москве. Все даты портала считаются по московскому времени,
-- независимо от часового пояса сервера.
CREATE FUNCTION msk_day(p_at timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_at AT TIME ZONE 'Europe/Moscow')::date
$$;

CREATE FUNCTION msk_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT msk_day(now())
$$;

-- Состоял ли пользователь в одной из групп предмета на указанную дату.
CREATE FUNCTION is_member_on(p_user integer, p_offering integer, p_day date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.user_id = p_user
      AND offering_has_group(p_offering, m.group_id)
      AND m.starts_on <= p_day
      AND (m.ends_on IS NULL OR m.ends_on >= p_day)
  )
$$;

-- Может ли пользователь управлять предметом: координатор или его преподаватель.
CREATE FUNCTION can_manage_offering(p_user integer, p_offering integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_user
      AND (u.role = 'coordinator'
           OR (u.role = 'teacher'
               AND EXISTS (SELECT 1 FROM offerings o WHERE o.id = p_offering AND o.teacher_id = u.id)))
  )
$$;

-- Может ли пользователь видеть предмет: координатор, преподаватель
-- или студент, который сегодня состоит в одной из групп предмета.
CREATE FUNCTION can_read_offering(p_user integer, p_offering integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.role = 'coordinator')
      OR EXISTS (SELECT 1 FROM offerings o WHERE o.id = p_offering AND o.teacher_id = p_user)
      OR is_member_on(p_user, p_offering, msk_today())
$$;

-- Разослать уведомление всем студентам предмета, которые состоят
-- в его группах на дату p_day. Повторная рассылка с тем же ключом
-- ничего не дублирует: UNIQUE(recipient_id, event_key).
-- Возвращает число новых уведомлений.
CREATE FUNCTION notify_offering_students(
  p_offering integer, p_day date, p_key text, p_title text,
  p_message text, p_page text, p_target integer
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO notifications(recipient_id, event_key, title, message, target_page, target_id)
  SELECT DISTINCT m.user_id, p_key, p_title, COALESCE(p_message, ''), p_page, p_target
  FROM memberships m
  WHERE offering_has_group(p_offering, m.group_id)
    AND m.starts_on <= p_day
    AND (m.ends_on IS NULL OR m.ends_on >= p_day)
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;


-- =====================================================================
-- 2. Ограничения CHECK
-- =====================================================================
-- Сначала приводим старые строки к новым правилам, затем добавляем
-- ограничения как NOT VALID: они сразу действуют для новых и изменённых
-- строк. В конце раздела база проверяет и старые строки (VALIDATE).
-- Если какие-то старые данные правилу не соответствуют, миграция не
-- падает, а пишет NOTICE: такие строки надо поправить вручную.

-- 2.1. Исправление старых данных
UPDATE sessions
   SET cancellation_reason = NULL, cancelled_by = NULL, cancelled_at = NULL
 WHERE NOT cancelled
   AND (cancellation_reason IS NOT NULL OR cancelled_by IS NOT NULL OR cancelled_at IS NOT NULL);
UPDATE sessions SET cancelled_at = now() WHERE cancelled AND cancelled_at IS NULL;
UPDATE sessions SET cancellation_reason = NULL WHERE btrim(cancellation_reason) = '';
UPDATE credit_requests SET decision_scope = NULL WHERE status <> 'approved' AND decision_scope IS NOT NULL;
UPDATE contacts SET telegram = ltrim(btrim(telegram), '@') WHERE telegram <> ltrim(btrim(telegram), '@');

-- 2.2. Занятия
ALTER TABLE sessions
  ADD CONSTRAINT chk_sessions_title CHECK (btrim(title) <> '') NOT VALID,
  -- у неотменённой пары нет данных об отмене
  ADD CONSTRAINT chk_sessions_cancel_fields CHECK (
    cancelled OR (cancellation_reason IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
  ) NOT VALID,
  -- у отменённой пары известно время отмены
  ADD CONSTRAINT chk_sessions_cancelled_at CHECK (NOT cancelled OR cancelled_at IS NOT NULL) NOT VALID,
  ADD CONSTRAINT chk_sessions_reason CHECK (
    cancellation_reason IS NULL OR btrim(cancellation_reason) <> ''
  ) NOT VALID,
  -- перенос: исходное время и время переноса заполняются вместе
  ADD CONSTRAINT chk_sessions_reschedule CHECK (
    (rescheduled_at IS NULL) = (original_starts_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT chk_sessions_meeting_url CHECK (
    meeting_url IS NULL OR meeting_url = '' OR meeting_url ~ '^https://'
  ) NOT VALID,
  ADD CONSTRAINT chk_sessions_recording_url CHECK (
    recording_url IS NULL OR recording_url ~ '^https://'
  ) NOT VALID;

ALTER TABLE homework
  ADD CONSTRAINT chk_homework_title CHECK (btrim(title) <> '') NOT VALID;

ALTER TABLE meeting_links
  ADD CONSTRAINT chk_meeting_links_url CHECK (url ~ '^https://') NOT VALID;

-- 2.3. События календаря
ALTER TABLE calendar_events
  ADD CONSTRAINT chk_events_title CHECK (btrim(title) <> '') NOT VALID,
  ADD CONSTRAINT chk_events_url CHECK (url = '' OR url ~ '^https?://') NOT VALID,
  -- если у события есть время, его дата по Москве совпадает с датой события
  ADD CONSTRAINT chk_events_same_day CHECK (
    starts_at IS NULL OR msk_day(starts_at) = event_date
  ) NOT VALID;

-- 2.4. Материалы
ALTER TABLE materials
  ADD CONSTRAINT chk_materials_title CHECK (btrim(title) <> '') NOT VALID,
  ADD CONSTRAINT chk_materials_kind CHECK (
    kind IN ('presentation', 'manual', 'practice', 'reference')
  ) NOT VALID,
  ADD CONSTRAINT chk_materials_lesson_no CHECK (lesson_no IS NULL OR lesson_no BETWEEN 1 AND 999) NOT VALID,
  ADD CONSTRAINT chk_materials_url CHECK (url = '' OR url ~ '^(https?://|/api/files/)') NOT VALID;

-- 2.5. Хакатоны, достижения, заявки на зачёт
ALTER TABLE hackathons
  ADD CONSTRAINT chk_hackathons_title CHECK (btrim(title) <> '') NOT VALID,
  ADD CONSTRAINT chk_hackathons_dates CHECK (
    starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on
  ) NOT VALID,
  ADD CONSTRAINT chk_hackathons_url CHECK (source_url = '' OR source_url ~ '^https?://') NOT VALID;

ALTER TABLE achievements
  ADD CONSTRAINT chk_achievements_github CHECK (github_url = '' OR github_url ~ '^https?://') NOT VALID;

ALTER TABLE credit_requests
  -- отказ и запрос уточнений без комментария студенту не нужны
  ADD CONSTRAINT chk_credit_comment CHECK (
    status NOT IN ('rejected', 'needs_info') OR btrim(comment) <> ''
  ) NOT VALID,
  ADD CONSTRAINT chk_credit_decision_scope CHECK (
    decision_scope IS NULL OR decision_scope IN ('assignment', 'coursework', 'whole_course')
  ) NOT VALID,
  -- объём решения бывает только у одобренной заявки
  ADD CONSTRAINT chk_credit_scope_only_approved CHECK (
    decision_scope IS NULL OR status = 'approved'
  ) NOT VALID,
  -- кто проверил и когда заполняются вместе
  ADD CONSTRAINT chk_credit_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)) NOT VALID,
  ADD CONSTRAINT chk_credit_version CHECK (version >= 1) NOT VALID;

-- 2.6. Справочники и проекты
ALTER TABLE contacts
  ADD CONSTRAINT chk_contacts_reachable CHECK (email <> '' OR telegram <> '') NOT VALID,
  ADD CONSTRAINT chk_contacts_telegram CHECK (telegram = '' OR telegram ~ '^[A-Za-z0-9_]{5,32}$') NOT VALID;
ALTER TABLE courses  ADD CONSTRAINT chk_courses_title CHECK (btrim(title) <> '') NOT VALID;
ALTER TABLE groups   ADD CONSTRAINT chk_groups_name CHECK (btrim(name) <> '') NOT VALID;
ALTER TABLE projects ADD CONSTRAINT chk_projects_title CHECK (btrim(title) <> '') NOT VALID;
ALTER TABLE project_roles ADD CONSTRAINT chk_project_roles_title CHECK (btrim(title) <> '') NOT VALID;

-- 2.7. Проверка старых строк
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c' AND NOT convalidated AND conname LIKE 'chk\_%'
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Старые строки в % не проходят %: для новых данных правило уже действует, старые надо поправить',
        c.tbl, c.conname;
    END;
  END LOOP;
END $$;


-- =====================================================================
-- 3. Триггеры
-- =====================================================================

-- 3.1. Занятия: служебные поля отмены заполняет сама база.
-- Отменили -> время отмены и автор; вернули пару -> данные отмены стираются.
CREATE FUNCTION sessions_cancel_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancelled AND (TG_OP = 'INSERT' OR NOT OLD.cancelled) THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, app_actor());
  ELSIF TG_OP = 'UPDATE' AND OLD.cancelled AND NOT NEW.cancelled THEN
    NEW.cancellation_reason := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sessions_cancel_fields
BEFORE INSERT OR UPDATE OF cancelled ON sessions
FOR EACH ROW EXECUTE FUNCTION sessions_cancel_fields();

-- 3.2. Занятия: журнал отмены, возврата и смены ссылок.
-- Пишется при любом способе изменения, даже в обход процедур.
CREATE FUNCTION sessions_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancelled IS DISTINCT FROM OLD.cancelled THEN
    INSERT INTO audit_events(actor_id, object_type, object_id, action, detail)
    VALUES (COALESCE(app_actor(), NEW.cancelled_by), 'session', NEW.id,
            CASE WHEN NEW.cancelled THEN 'cancel' ELSE 'restore' END,
            jsonb_build_object('reason', CASE WHEN NEW.cancelled THEN NEW.cancellation_reason
                                              ELSE OLD.cancellation_reason END));
  END IF;
  IF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url THEN
    INSERT INTO audit_events(actor_id, object_type, object_id, action, detail)
    VALUES (app_actor(), 'session', NEW.id, 'meeting',
            jsonb_build_object('from', OLD.meeting_url, 'to', NEW.meeting_url));
  END IF;
  IF NEW.recording_url IS DISTINCT FROM OLD.recording_url THEN
    INSERT INTO audit_events(actor_id, object_type, object_id, action, detail)
    VALUES (app_actor(), 'session', NEW.id, 'recording',
            jsonb_build_object('from', OLD.recording_url, 'to', NEW.recording_url));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER sessions_audit
AFTER UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION sessions_audit();

-- 3.3. Посещаемость: нельзя отмечать на отменённой паре и нельзя
-- отмечать студента, которого не было в группе на дату пары.
CREATE FUNCTION attendance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s sessions;
BEGIN
  SELECT * INTO s FROM sessions WHERE id = NEW.session_id;
  IF s.cancelled THEN
    RAISE EXCEPTION 'Занятие отменено: отметки менять нельзя' USING ERRCODE = 'IH409';
  END IF;
  IF NOT is_member_on(NEW.student_id, s.offering_id, msk_day(s.starts_at)) THEN
    RAISE EXCEPTION 'Студент не входил в группу на дату занятия' USING ERRCODE = 'IH422';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER attendance_guard
BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION attendance_guard();

-- 3.4. Проекты: роль принадлежит этому проекту, и мест в роли не больше,
-- чем capacity. Строка роли блокируется, поэтому два одновременных
-- принятия не займут одно последнее место.
CREATE FUNCTION project_members_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r project_roles;
  taken integer;
BEGIN
  SELECT * INTO r FROM project_roles WHERE id = NEW.role_id FOR UPDATE;
  IF NOT FOUND OR r.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'Роль не относится к этому проекту' USING ERRCODE = 'IH422';
  END IF;
  SELECT count(*) INTO taken FROM project_members WHERE role_id = NEW.role_id;
  IF taken >= r.capacity THEN
    RAISE EXCEPTION 'Свободных мест нет' USING ERRCODE = 'IH409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER project_members_capacity
BEFORE INSERT ON project_members
FOR EACH ROW EXECUTE FUNCTION project_members_capacity();

-- 3.5. Заявки на зачёт: при создании.
-- Хакатон берётся из достижения, достижение должно принадлежать студенту.
-- Статус, версию и поля проверки задаёт база, а не тот, кто вставляет строку.
CREATE FUNCTION credit_requests_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a achievements;
BEGIN
  SELECT * INTO a FROM achievements WHERE id = NEW.achievement_id;
  IF NOT FOUND OR a.owner_id <> NEW.student_id OR a.hackathon_id IS NULL THEN
    RAISE EXCEPTION 'Выберите своё достижение с хакатоном' USING ERRCODE = 'IH422';
  END IF;
  NEW.hackathon_id   := a.hackathon_id;
  NEW.status         := 'pending';
  NEW.version        := 1;
  NEW.decision_scope := NULL;
  NEW.reviewed_by    := NULL;
  NEW.reviewed_at    := NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER credit_requests_before_insert
BEFORE INSERT ON credit_requests
FOR EACH ROW EXECUTE FUNCTION credit_requests_before_insert();

-- 3.6. Заявки на зачёт: при изменении.
-- Разрешены только переходы
--   pending    -> approved | rejected | needs_info   (решение преподавателя)
--   needs_info -> pending                           (студент дополнил заявку)
-- approved и rejected окончательные. Версия растёт при каждом изменении:
-- по ней сервер ловит одновременные решения (оптимистическая блокировка).
CREATE FUNCTION credit_requests_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Решение по заявке уже принято' USING ERRCODE = 'IH409';
  END IF;
  IF NEW.student_id <> OLD.student_id OR NEW.offering_id <> OLD.offering_id
     OR NEW.hackathon_id <> OLD.hackathon_id
     OR NEW.achievement_id IS DISTINCT FROM OLD.achievement_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Нельзя менять студента, предмет и хакатон заявки' USING ERRCODE = 'IH422';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'needs_info'))
         OR (OLD.status = 'needs_info' AND NEW.status = 'pending')) THEN
      RAISE EXCEPTION 'Недопустимый переход статуса заявки: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'IH409';
    END IF;
    IF NEW.status = 'pending' THEN
      NEW.reviewed_by    := NULL;
      NEW.reviewed_at    := NULL;
      NEW.decision_scope := NULL;
    ELSE
      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'Не указан проверяющий преподаватель' USING ERRCODE = 'IH422';
      END IF;
      NEW.reviewed_at := now();
    END IF;
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER credit_requests_before_update
BEFORE UPDATE ON credit_requests
FOR EACH ROW EXECUTE FUNCTION credit_requests_before_update();

-- 3.7. Заявки на зачёт: после создания преподаватель получает уведомление.
CREATE FUNCTION credit_requests_after_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notifications(recipient_id, event_key, title, message, target_page, target_id)
  SELECT o.teacher_id, 'credit:' || NEW.id, 'Новая заявка на зачёт',
         c.title || ' · ' || u.name, 'hackathons', NEW.id
  FROM offerings o
  JOIN courses c ON c.id = o.course_id
  JOIN users u ON u.id = NEW.student_id
  WHERE o.id = NEW.offering_id
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
  RETURN NULL;
END $$;

CREATE TRIGGER credit_requests_after_insert
AFTER INSERT ON credit_requests
FOR EACH ROW EXECUTE FUNCTION credit_requests_after_insert();

-- 3.8. Заявки на зачёт: после смены статуса база сама пишет историю
-- и уведомляет вторую сторону (студента о решении, преподавателя о дополнении).
CREATE FUNCTION credit_requests_after_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := COALESCE(app_actor(),
                              CASE WHEN NEW.status = 'pending' THEN NEW.student_id ELSE NEW.reviewed_by END);
BEGIN
  INSERT INTO credit_history(request_id, actor_id, status, snapshot)
  VALUES (NEW.id, v_actor, NEW.status, to_jsonb(NEW));

  IF NEW.status = 'pending' THEN
    INSERT INTO notifications(recipient_id, event_key, title, message, target_page, target_id)
    SELECT o.teacher_id, 'credit-resubmit:' || NEW.id || ':' || NEW.version, 'Заявка дополнена',
           u.name, 'hackathons', NEW.id
    FROM offerings o JOIN users u ON u.id = NEW.student_id
    WHERE o.id = NEW.offering_id
    ON CONFLICT (recipient_id, event_key) DO NOTHING;
  ELSE
    INSERT INTO notifications(recipient_id, event_key, title, message, target_page, target_id)
    VALUES (NEW.student_id, 'credit-decision:' || NEW.id || ':' || NEW.version,
            'Рассмотрена заявка на зачёт',
            COALESCE(NULLIF(NEW.comment, ''),
                     CASE NEW.status WHEN 'approved' THEN 'Заявка одобрена'
                                     WHEN 'rejected' THEN 'Заявка отклонена'
                                     ELSE 'Нужны уточнения' END),
            'hackathons', NEW.id)
    ON CONFLICT (recipient_id, event_key) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER credit_requests_after_status
AFTER UPDATE OF status ON credit_requests
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION credit_requests_after_status();


-- =====================================================================
-- 4. Процедуры и функции основных действий
-- =====================================================================

-- 4.1. Отмена пары (заменяет версию из 003/010).
-- В одной транзакции: блокировка пары, проверка прав, задание взамен,
-- флаг отмены, запись в cancellation_requests и уведомления.
-- Повторный вызов для уже отменённой пары ничего не делает (идемпотентность).
-- Уведомления получают студенты, которые в группе НА ДАТУ ПАРЫ.
CREATE OR REPLACE PROCEDURE cancel_study_session(
  sid integer, actor integer, reason text, replacement jsonb, request_key text
)
LANGUAGE plpgsql AS $$
DECLARE
  s sessions;
  v_reason text := btrim(COALESCE(reason, ''));
  v_replacement_id integer;
BEGIN
  PERFORM set_actor(actor);
  SELECT * INTO s FROM sessions WHERE id = sid FOR UPDATE;
  -- чужую пару не отменить; её существование тоже не раскрываем
  IF NOT FOUND OR NOT can_manage_offering(actor, s.offering_id) THEN
    RAISE EXCEPTION 'Занятие не найдено или недоступно' USING ERRCODE = 'IH404';
  END IF;
  IF s.cancelled THEN
    RETURN;
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Нужна причина отмены' USING ERRCODE = 'IH422';
  END IF;

  IF replacement IS NOT NULL THEN
    IF btrim(COALESCE(replacement->>'title', '')) = '' OR replacement->>'due_at' IS NULL THEN
      RAISE EXCEPTION 'У задания взамен нужны название и срок' USING ERRCODE = 'IH422';
    END IF;
    INSERT INTO homework(session_id, title, description, due_at)
    VALUES (sid, btrim(replacement->>'title'), COALESCE(replacement->>'description', ''),
            (replacement->>'due_at')::timestamptz)
    RETURNING id INTO v_replacement_id;
  END IF;

  -- время отмены и автора дополнит триггер sessions_cancel_fields,
  -- запись в журнал сделает триггер sessions_audit
  UPDATE sessions
     SET cancelled = true, cancellation_reason = v_reason, cancelled_by = actor
   WHERE id = sid;

  INSERT INTO cancellation_requests(session_id, actor_id, request_key, replacement_id)
  VALUES (sid, actor, COALESCE(request_key, ''), v_replacement_id)
  ON CONFLICT (session_id) DO UPDATE
    SET actor_id = EXCLUDED.actor_id, request_key = EXCLUDED.request_key,
        replacement_id = EXCLUDED.replacement_id;

  PERFORM notify_offering_students(
    s.offering_id, msk_day(s.starts_at), 'cancel-session:' || sid,
    'Занятие отменено: ' || s.title,
    v_reason || CASE WHEN v_replacement_id IS NOT NULL THEN '. Добавлено задание взамен.' ELSE '' END,
    'calendar', sid);
END $$;

-- 4.2. Смена ссылки на созвон.
--   current_only   - только эта пара;
--   future_default - эта пара и новая ссылка по умолчанию для следующих пар
--                    (правило по дню недели + текущая ссылка предмета);
--   none           - убрать ссылку у этой пары.
CREATE FUNCTION set_session_meeting(
  p_session integer, p_actor integer, p_scope text, p_url text, p_provider text
) RETURNS sessions
LANGUAGE plpgsql AS $$
DECLARE
  s sessions;
  v_url text;
  v_provider text := left(COALESCE(p_provider, ''), 100);
  v_rule integer;
BEGIN
  PERFORM set_actor(p_actor);
  SELECT * INTO s FROM sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR NOT can_manage_offering(p_actor, s.offering_id) THEN
    RAISE EXCEPTION 'Занятие не найдено или недоступно' USING ERRCODE = 'IH404';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('current_only', 'future_default', 'none') THEN
    RAISE EXCEPTION 'Выберите режим ссылки' USING ERRCODE = 'IH422';
  END IF;
  IF p_scope <> 'none' AND (p_url IS NULL OR p_url !~ '^https://') THEN
    RAISE EXCEPTION 'Нужна HTTPS-ссылка' USING ERRCODE = 'IH422';
  END IF;
  v_url := CASE WHEN p_scope = 'none' THEN NULL ELSE p_url END;

  UPDATE sessions SET meeting_url = v_url WHERE id = p_session RETURNING * INTO s;

  IF p_scope = 'future_default' THEN
    -- правило для этого дня недели, если его нет - общее правило (0)
    SELECT weekday INTO v_rule
    FROM meeting_links
    WHERE offering_id = s.offering_id
      AND weekday IN (0, extract(isodow FROM s.starts_at AT TIME ZONE 'Europe/Moscow')::integer)
    ORDER BY weekday DESC
    LIMIT 1;
    INSERT INTO meeting_links(offering_id, weekday, url, provider)
    VALUES (s.offering_id, COALESCE(v_rule, 0), v_url, v_provider)
    ON CONFLICT (offering_id, weekday) DO UPDATE SET url = EXCLUDED.url, provider = EXCLUDED.provider;
    UPDATE offerings SET current_meeting_url = v_url, provider = v_provider WHERE id = s.offering_id;
  END IF;

  PERFORM notify_offering_students(
    s.offering_id, msk_day(s.starts_at),
    'meeting:' || s.id || ':' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
    'Изменена ссылка занятия', s.title, 'calendar', s.id);
  RETURN s;
END $$;

-- 4.3. Студент подаёт заявку на зачёт за хакатон.
-- Снимок достижения сохраняется в заявке: если студент потом изменит
-- достижение, преподаватель увидит то, что было подано.
CREATE FUNCTION create_credit_request(
  p_student integer, p_offering integer, p_achievement integer, p_scope text
) RETURNS credit_requests
LANGUAGE plpgsql AS $$
DECLARE
  a achievements;
  r credit_requests;
BEGIN
  PERFORM set_actor(p_student);
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_student AND role IN ('student', 'headman')) THEN
    RAISE EXCEPTION 'Доступно студенту' USING ERRCODE = 'IH403';
  END IF;
  IF NOT can_read_offering(p_student, p_offering) THEN
    RAISE EXCEPTION 'Предмет не найден или недоступен' USING ERRCODE = 'IH404';
  END IF;
  SELECT * INTO a FROM achievements WHERE id = p_achievement AND owner_id = p_student;
  IF NOT FOUND OR a.hackathon_id IS NULL THEN
    RAISE EXCEPTION 'Выберите своё достижение с хакатоном' USING ERRCODE = 'IH422';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('assignment', 'coursework', 'whole_course') THEN
    RAISE EXCEPTION 'Выберите объём зачёта' USING ERRCODE = 'IH422';
  END IF;
  IF EXISTS (SELECT 1 FROM credit_requests
             WHERE student_id = p_student AND offering_id = p_offering
               AND status IN ('pending', 'needs_info')) THEN
    RAISE EXCEPTION 'По этому предмету уже есть заявка на рассмотрении' USING ERRCODE = 'IH409';
  END IF;
  -- статус и версию выставит триггер, уведомление преподавателю - тоже триггер
  INSERT INTO credit_requests(student_id, offering_id, achievement_id, hackathon_id, snapshot, requested_scope)
  VALUES (p_student, p_offering, a.id, a.hackathon_id, to_jsonb(a), p_scope)
  RETURNING * INTO r;
  RETURN r;
END $$;

-- 4.4. Преподаватель принимает решение по заявке.
-- p_version - версия, которую преподаватель видел на экране. Если заявку
-- уже кто-то изменил, версия не совпадёт и вернётся конфликт IH409.
CREATE FUNCTION decide_credit_request(
  p_request integer, p_actor integer, p_version integer,
  p_status text, p_scope text, p_comment text
) RETURNS credit_requests
LANGUAGE plpgsql AS $$
DECLARE
  r credit_requests;
  v_comment text := btrim(COALESCE(p_comment, ''));
BEGIN
  PERFORM set_actor(p_actor);
  SELECT * INTO r FROM credit_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT can_manage_offering(p_actor, r.offering_id) THEN
    RAISE EXCEPTION 'Заявка не найдена' USING ERRCODE = 'IH404';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'needs_info') THEN
    RAISE EXCEPTION 'Выберите решение' USING ERRCODE = 'IH422';
  END IF;
  IF r.status <> 'pending' OR r.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Заявка уже изменена или рассмотрена' USING ERRCODE = 'IH409';
  END IF;
  IF p_status = 'approved' AND (p_scope IS NULL OR p_scope NOT IN ('assignment', 'coursework', 'whole_course')) THEN
    RAISE EXCEPTION 'Укажите объём зачёта' USING ERRCODE = 'IH422';
  END IF;
  IF p_status <> 'approved' AND v_comment = '' THEN
    RAISE EXCEPTION 'Напишите комментарий студенту' USING ERRCODE = 'IH422';
  END IF;
  IF length(v_comment) > 4000 THEN
    RAISE EXCEPTION 'Комментарий: не более 4000 символов' USING ERRCODE = 'IH422';
  END IF;
  -- версию, время проверки, историю и уведомление добавят триггеры
  UPDATE credit_requests
     SET status = p_status,
         comment = v_comment,
         decision_scope = CASE WHEN p_status = 'approved' THEN p_scope END,
         reviewed_by = p_actor
   WHERE id = p_request
  RETURNING * INTO r;
  RETURN r;
END $$;

-- 4.5. Студент дополняет заявку, по которой попросили уточнения.
CREATE FUNCTION resubmit_credit_request(
  p_request integer, p_student integer, p_version integer, p_contribution text
) RETURNS credit_requests
LANGUAGE plpgsql AS $$
DECLARE
  r credit_requests;
  v_text text := btrim(COALESCE(p_contribution, ''));
BEGIN
  PERFORM set_actor(p_student);
  SELECT * INTO r FROM credit_requests WHERE id = p_request AND student_id = p_student FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заявка не найдена' USING ERRCODE = 'IH404';
  END IF;
  IF r.status <> 'needs_info' OR r.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Заявка уже изменена' USING ERRCODE = 'IH409';
  END IF;
  IF v_text = '' OR length(v_text) > 4000 THEN
    RAISE EXCEPTION 'Опишите свой вклад (до 4000 символов)' USING ERRCODE = 'IH422';
  END IF;
  UPDATE credit_requests
     SET status = 'pending',
         snapshot = snapshot || jsonb_build_object('contribution', v_text)
   WHERE id = p_request
  RETURNING * INTO r;
  RETURN r;
END $$;

-- 4.6. Владелец проекта принимает отклик.
-- Отклик и роль блокируются; число мест проверяет триггер project_members_capacity.
CREATE FUNCTION accept_application(p_application integer, p_owner integer) RETURNS applications
LANGUAGE plpgsql AS $$
DECLARE
  a applications;
  v_project integer;
BEGIN
  PERFORM set_actor(p_owner);
  SELECT ap.* INTO a
  FROM applications ap
  JOIN project_roles r ON r.id = ap.role_id
  JOIN projects p ON p.id = r.project_id
  WHERE ap.id = p_application AND p.owner_id = p_owner
  FOR UPDATE OF ap, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заявка не найдена' USING ERRCODE = 'IH404';
  END IF;
  IF a.status <> 'pending' THEN
    RAISE EXCEPTION 'Заявка уже рассмотрена' USING ERRCODE = 'IH409';
  END IF;
  SELECT project_id INTO v_project FROM project_roles WHERE id = a.role_id;
  INSERT INTO project_members(project_id, user_id, role_id) VALUES (v_project, a.user_id, a.role_id);
  UPDATE applications SET status = 'accepted' WHERE id = p_application RETURNING * INTO a;
  INSERT INTO application_events(application_id, actor_id, status) VALUES (p_application, p_owner, 'accepted');
  RETURN a;
END $$;

-- 4.7. Удалить просроченные сессии входа. Возвращает, сколько удалено.
CREATE FUNCTION cleanup_expired_sessions() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM login_sessions WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;


-- =====================================================================
-- 5. Календарь
-- =====================================================================

-- 5.1. Всё, что бывает в календаре, в одном представлении:
-- события, пары, домашние задания, пересдачи. Одна строка - один пункт.
-- detail хранит все поля исходной строки для страницы календаря.
CREATE VIEW calendar_items AS
SELECT 'event'::text            AS source_type,
       e.id                     AS source_id,
       e.offering_id,
       e.kind,
       e.title,
       e.event_date             AS item_date,
       e.starts_at,
       e.starts_at IS NULL      AS all_day,
       e.status,
       to_jsonb(e) || jsonb_build_object(
         'event_date', to_char(e.event_date, 'YYYY-MM-DD'),
         'requirements_name', f.original_name,
         'requirements_file_id', f.id,
         'requirements_published', rm.published) AS detail
FROM calendar_events e
LEFT JOIN coursework cw ON cw.event_id = e.id
LEFT JOIN stored_files f ON f.id = cw.requirements_file_id
LEFT JOIN materials rm ON rm.id = f.material_id
UNION ALL
SELECT 'session', s.id, s.offering_id, 'session', s.title,
       msk_day(s.starts_at), s.starts_at, false,
       CASE WHEN s.cancelled THEN 'cancelled' ELSE 'published' END,
       to_jsonb(s)
FROM sessions s
UNION ALL
SELECT 'homework', h.id, s.offering_id, 'homework', h.title,
       msk_day(h.due_at), h.due_at, false, 'published',
       to_jsonb(h) || jsonb_build_object('cancelled', s.cancelled, 'offering_id', s.offering_id)
FROM homework h
JOIN sessions s ON s.id = h.session_id
UNION ALL
SELECT 'retake', r.id, r.offering_id, r.kind,
       CASE WHEN r.kind = 'retake' THEN 'Пересдача' ELSE 'Сдача долгов' END,
       msk_day(r.starts_at), r.starts_at, false,
       CASE WHEN r.status = 'cancelled' THEN 'cancelled' ELSE 'published' END,
       to_jsonb(r) || jsonb_build_object(
         'description', r.room || CASE WHEN r.change_reason <> '' THEN ' · ' || r.change_reason ELSE '' END)
FROM retakes r;

-- 5.2. Календарь конкретного пользователя за период.
-- Права: пункты предмета видят те, кому can_read_offering разрешает;
-- пересдачи - преподаватель, координатор и записанные студенты;
-- черновики - только те, кто управляет предметом.
-- done - личная отметка «выполнено» для событий и домашек.
CREATE FUNCTION calendar_for(p_user integer, p_from date, p_to date) RETURNS SETOF jsonb
LANGUAGE sql STABLE AS $$
  SELECT (ci.detail - 'requirements_file_id' - 'requirements_published') || jsonb_build_object(
           'source_type', ci.source_type,
           'source_id',   ci.source_id,
           'key',         ci.source_type || ':' || ci.source_id,
           'kind',        ci.kind,
           'title',       ci.title,
           'date',        to_char(ci.item_date, 'YYYY-MM-DD'),
           'starts_at',   ci.starts_at,
           'all_day',     ci.all_day,
           'status',      ci.status,
           'offering_id', ci.offering_id,
           'course',      c.title,
           'group_name',  g.name,
           'group_names', to_jsonb(offering_group_names(o.id)),
           'done', CASE ci.source_type
                     WHEN 'event' THEN COALESCE((SELECT ep.done FROM event_progress ep
                                                 WHERE ep.event_id = ci.source_id AND ep.user_id = p_user), false)
                     WHEN 'homework' THEN EXISTS (SELECT 1 FROM homework_done hd
                                                  WHERE hd.homework_id = ci.source_id AND hd.user_id = p_user)
                     ELSE false
                   END,
           'requirements_url',
             CASE WHEN ci.detail->>'requirements_file_id' IS NOT NULL
                   AND (COALESCE((ci.detail->>'requirements_published')::boolean, false)
                        OR can_manage_offering(p_user, ci.offering_id)
                        OR o.teacher_id = p_user)
                  THEN '/api/files/' || (ci.detail->>'requirements_file_id') END)
  FROM calendar_items ci
  JOIN offerings o ON o.id = ci.offering_id
  JOIN courses c ON c.id = o.course_id
  JOIN groups g ON g.id = o.group_id
  WHERE ci.item_date BETWEEN p_from AND p_to
    AND CASE WHEN ci.source_type = 'retake'
             THEN o.teacher_id = p_user
                  OR can_manage_offering(p_user, ci.offering_id)
                  OR EXISTS (SELECT 1 FROM retake_registrations x JOIN debts d ON d.id = x.debt_id
                             WHERE x.retake_id = ci.source_id AND d.student_id = p_user)
             ELSE can_read_offering(p_user, ci.offering_id)
        END
    AND (ci.status <> 'draft' OR o.teacher_id = p_user OR can_manage_offering(p_user, ci.offering_id))
  ORDER BY ci.item_date, ci.starts_at NULLS FIRST, ci.source_type, ci.source_id
$$;


-- =====================================================================
-- 6. Индексы под частые запросы
-- =====================================================================
-- Уже были: sessions(offering_id, starts_at), calendar_events(offering_id, event_date),
-- notifications(recipient_id, created_at), memberships(user_id, ...), debts(student_id, closed).

-- календарь ищет пары и домашки по дате по Москве
CREATE INDEX IF NOT EXISTS sessions_msk_day ON sessions (msk_day(starts_at));
CREATE INDEX IF NOT EXISTS homework_msk_day ON homework (msk_day(due_at));
CREATE INDEX IF NOT EXISTS homework_session ON homework (session_id);
CREATE INDEX IF NOT EXISTS retakes_offering_starts ON retakes (offering_id, starts_at);
-- рассылка уведомлений и проверки доступа ищут состав группы
CREATE INDEX IF NOT EXISTS memberships_group ON memberships (group_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS offering_groups_group ON offering_groups (group_id);
-- непрочитанные уведомления пользователя (частичный индекс)
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (recipient_id) WHERE read_at IS NULL;
-- заявки на рассмотрении у преподавателя
CREATE INDEX IF NOT EXISTS credit_requests_offering_status ON credit_requests (offering_id, status);
CREATE INDEX IF NOT EXISTS credit_history_request ON credit_history (request_id);
-- посещаемость и долги студента
CREATE INDEX IF NOT EXISTS attendance_student ON attendance (student_id);
CREATE INDEX IF NOT EXISTS debts_offering ON debts (offering_id);
CREATE INDEX IF NOT EXISTS materials_offering ON materials (offering_id);
-- журнал по объекту
CREATE INDEX IF NOT EXISTS audit_events_object ON audit_events (object_type, object_id);
-- вход: поиск сессий пользователя и чистка просроченных
CREATE INDEX IF NOT EXISTS login_sessions_user ON login_sessions (user_id);
CREATE INDEX IF NOT EXISTS login_sessions_expires ON login_sessions (expires_at);
