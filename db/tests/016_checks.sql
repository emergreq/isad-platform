-- =====================================================================
-- Проверки логики из миграции 016
-- =====================================================================
-- Как запустить в DBeaver: открыть файл, выбрать базу isad, нажать
-- «Выполнить скрипт» (Alt+X). В конце будет таблица: номер, итог (OK или
-- ОШИБКА), что проверяли и что ответила база.
-- Скрипт работает внутри транзакции и в конце делает ROLLBACK, поэтому
-- в базе ничего не остаётся. Нужна база с применёнными миграциями 001–016.
-- Тот же файл запускает автотест: npm run test:db
-- =====================================================================

BEGIN;

CREATE TEMP TABLE chk_results (
  n      serial PRIMARY KEY,
  ok     boolean NOT NULL,
  label  text NOT NULL,
  detail text
) ON COMMIT DROP;

-- условие должно быть истинным
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chk_results(ok, label) VALUES (COALESCE(p_cond, false), p_label);
END $$;

-- команда должна упасть с этим кодом ошибки (SQLSTATE)
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO chk_results(ok, label, detail) VALUES (false, p_label, 'ошибки не было');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO chk_results(ok, label, detail)
  VALUES (SQLSTATE = p_code, p_label, SQLSTATE || ': ' || SQLERRM);
END $$;

-- команда должна выполниться без ошибки
CREATE FUNCTION pg_temp.expect_ok(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO chk_results(ok, label) VALUES (true, p_label);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO chk_results(ok, label, detail) VALUES (false, p_label, SQLSTATE || ': ' || SQLERRM);
END $$;

-- короткие ссылки на тестовые объекты
CREATE FUNCTION pg_temp.uid(p_name text) RETURNS integer LANGUAGE sql AS $$
  SELECT id FROM users WHERE email = p_name || '@chk016.local'
$$;
CREATE FUNCTION pg_temp.off() RETURNS integer LANGUAGE sql AS $$
  SELECT id FROM offerings WHERE semester = 'chk016'
$$;
CREATE FUNCTION pg_temp.sess(p_title text) RETURNS integer LANGUAGE sql AS $$
  SELECT id FROM sessions WHERE offering_id = pg_temp.off() AND title = p_title
$$;
CREATE FUNCTION pg_temp.credit() RETURNS integer LANGUAGE sql AS $$
  SELECT max(id) FROM credit_requests WHERE offering_id = pg_temp.off()
$$;
CREATE FUNCTION pg_temp.credit_version() RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM credit_requests WHERE id = pg_temp.credit()
$$;


-- ---------------------------------------------------------------------
-- Тестовые данные
-- ---------------------------------------------------------------------
INSERT INTO users(name, email, password_hash, role) VALUES
  ('Проверка Преподаватель',   'teacher@chk016.local',  'x:y', 'teacher'),
  ('Проверка Преподаватель 2', 'teacher2@chk016.local', 'x:y', 'teacher'),
  ('Проверка Студент',         'student@chk016.local',  'x:y', 'student'),
  ('Проверка Чужой студент',   'other@chk016.local',    'x:y', 'student'),
  ('Проверка Координатор',     'coord@chk016.local',    'x:y', 'coordinator');
INSERT INTO groups(name) VALUES ('CHK016-A'), ('CHK016-B');
INSERT INTO memberships(user_id, group_id, starts_on)
SELECT pg_temp.uid('student'), id, DATE '2020-01-01' FROM groups WHERE name = 'CHK016-A';
INSERT INTO memberships(user_id, group_id, starts_on)
SELECT pg_temp.uid('other'), id, DATE '2020-01-01' FROM groups WHERE name = 'CHK016-B';
INSERT INTO courses(title) VALUES ('CHK016 Базы данных');
INSERT INTO offerings(course_id, teacher_id, group_id, semester)
SELECT c.id, pg_temp.uid('teacher'), g.id, 'chk016'
FROM courses c, groups g WHERE c.title = 'CHK016 Базы данных' AND g.name = 'CHK016-A';
INSERT INTO sessions(offering_id, title, starts_at, room) VALUES
  (pg_temp.off(), 'Пара 1', now() + interval '7 days',  'А-1'),
  (pg_temp.off(), 'Пара 2', now() + interval '14 days', 'А-1'),
  (pg_temp.off(), 'Пара 3', now() + interval '21 days', 'А-1');


-- ---------------------------------------------------------------------
-- 1. Функции доступа
-- ---------------------------------------------------------------------
SELECT pg_temp.ok(can_read_offering(pg_temp.uid('student'), pg_temp.off()), 'студент своей группы видит предмет');
SELECT pg_temp.ok(NOT can_read_offering(pg_temp.uid('other'), pg_temp.off()), 'студент другой группы не видит предмет');
SELECT pg_temp.ok(can_manage_offering(pg_temp.uid('teacher'), pg_temp.off()), 'преподаватель управляет своим предметом');
SELECT pg_temp.ok(NOT can_manage_offering(pg_temp.uid('teacher2'), pg_temp.off()), 'чужой преподаватель не управляет предметом');
SELECT pg_temp.ok(can_manage_offering(pg_temp.uid('coord'), pg_temp.off()), 'координатор управляет любым предметом');
SELECT pg_temp.ok(NOT can_manage_offering(pg_temp.uid('student'), pg_temp.off()), 'студент не управляет предметом');


-- ---------------------------------------------------------------------
-- 2. Ограничения CHECK (код 23514)
-- ---------------------------------------------------------------------
SELECT pg_temp.expect_error(format(
  'UPDATE sessions SET cancellation_reason = %L WHERE id = %s', 'причина', pg_temp.sess('Пара 3')),
  '23514', 'у неотменённой пары не может быть причины отмены');
SELECT pg_temp.expect_error(format(
  'UPDATE sessions SET meeting_url = %L WHERE id = %s', 'http://example.org', pg_temp.sess('Пара 3')),
  '23514', 'ссылка на созвон только https');
SELECT pg_temp.expect_error(format(
  'UPDATE sessions SET title = %L WHERE id = %s', '   ', pg_temp.sess('Пара 3')),
  '23514', 'название пары не может быть пустым');
SELECT pg_temp.expect_error(format(
  'UPDATE sessions SET rescheduled_at = now() WHERE id = %s', pg_temp.sess('Пара 3')),
  '23514', 'перенос без исходного времени запрещён');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO calendar_events(offering_id, kind, title, event_date, starts_at, created_by)
     VALUES (%s, 'test', 'Контрольная', DATE '2030-05-10', TIMESTAMPTZ '2030-05-11 10:00+03', %s)$q$,
  pg_temp.off(), pg_temp.uid('teacher')),
  '23514', 'время события должно быть в день события (по Москве)');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO materials(offering_id, title, url, kind) VALUES (%s, 'Видео', '', 'video')$q$, pg_temp.off()),
  '23514', 'тип материала только из списка');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO materials(offering_id, title, url, lesson_no) VALUES (%s, 'Лекция', '', 0)$q$, pg_temp.off()),
  '23514', 'номер занятия от 1 до 999');
SELECT pg_temp.expect_error(
  $q$INSERT INTO hackathons(title, starts_on, ends_on) VALUES ('Хакатон', DATE '2030-05-10', DATE '2030-05-01')$q$,
  '23514', 'хакатон не может закончиться раньше начала');
SELECT pg_temp.expect_error(
  $q$INSERT INTO contacts(name, position) VALUES ('Без связи', 'Преподаватель')$q$,
  '23514', 'у контакта должна быть почта или Telegram');
SELECT pg_temp.expect_error(
  $q$INSERT INTO contacts(name, position, telegram) VALUES ('Короткий ник', 'Преподаватель', 'ab')$q$,
  '23514', 'ник Telegram: 5–32 символа, латиница, цифры, _');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO meeting_links(offering_id, weekday, url) VALUES (%s, 1, 'http://example.org')$q$, pg_temp.off()),
  '23514', 'ссылка правила созвона только https');


-- ---------------------------------------------------------------------
-- 3. Триггеры занятий: служебные поля и журнал
-- ---------------------------------------------------------------------
-- отмена старым способом (просто флаг), как делает старый PATCH /api/sessions/:id
UPDATE sessions SET cancelled = true WHERE id = pg_temp.sess('Пара 3');
SELECT pg_temp.ok((SELECT cancelled_at IS NOT NULL FROM sessions WHERE id = pg_temp.sess('Пара 3')),
  'при отмене база сама ставит время отмены');
UPDATE sessions SET cancelled = false WHERE id = pg_temp.sess('Пара 3');
SELECT pg_temp.ok((SELECT cancelled_at IS NULL AND cancellation_reason IS NULL
                   FROM sessions WHERE id = pg_temp.sess('Пара 3')),
  'при возврате пары данные отмены стираются');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM audit_events
                   WHERE object_type = 'session' AND object_id = pg_temp.sess('Пара 3')
                     AND action IN ('cancel', 'restore')),
  'журнал записал отмену и возврат пары');


-- ---------------------------------------------------------------------
-- 4. Процедура отмены пары cancel_study_session
-- ---------------------------------------------------------------------
SELECT pg_temp.expect_error(format(
  'CALL cancel_study_session(%s, %s, %L, NULL, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('teacher2'), 'Болезнь', 'k1'),
  'IH404', 'чужой преподаватель не может отменить пару');
SELECT pg_temp.expect_error(format(
  'CALL cancel_study_session(%s, %s, %L, NULL, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('student'), 'Хочу', 'k1'),
  'IH404', 'студент не может отменить пару');
SELECT pg_temp.expect_error(format(
  'CALL cancel_study_session(%s, %s, %L, NULL, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('teacher'), '  ', 'k1'),
  'IH422', 'отмена без причины запрещена');
SELECT pg_temp.expect_error(format(
  'CALL cancel_study_session(%s, %s, %L, %L::jsonb, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('teacher'), 'Болезнь',
  '{"title":"Задание"}', 'k1'),
  'IH422', 'у задания взамен нужен срок');
SELECT pg_temp.expect_ok(format(
  'CALL cancel_study_session(%s, %s, %L, %L::jsonb, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('teacher'), 'Болезнь',
  json_build_object('title', 'Построить ER-диаграмму', 'description', 'По теме пары',
                    'due_at', (now() + interval '10 days')::text)::text, 'k1'),
  'преподаватель отменяет свою пару с заданием взамен');
SELECT pg_temp.ok((SELECT cancelled AND cancellation_reason = 'Болезнь' AND cancelled_by = pg_temp.uid('teacher')
                   FROM sessions WHERE id = pg_temp.sess('Пара 1')),
  'пара отменена, сохранены причина и автор');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM homework WHERE session_id = pg_temp.sess('Пара 1')),
  'создано одно задание взамен');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM notifications
                   WHERE event_key = 'cancel-session:' || pg_temp.sess('Пара 1')),
  'уведомление получил только студент группы');
SELECT pg_temp.expect_ok(format(
  'CALL cancel_study_session(%s, %s, %L, NULL, %L)', pg_temp.sess('Пара 1'), pg_temp.uid('teacher'), 'Повтор', 'k1'),
  'повторная отмена не даёт ошибки');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM homework WHERE session_id = pg_temp.sess('Пара 1'))
              AND (SELECT cancellation_reason = 'Болезнь' FROM sessions WHERE id = pg_temp.sess('Пара 1')),
  'повторная отмена ничего не дублирует и не меняет');
SELECT pg_temp.ok((SELECT actor_id = pg_temp.uid('teacher') FROM audit_events
                   WHERE object_type = 'session' AND object_id = pg_temp.sess('Пара 1') AND action = 'cancel'),
  'в журнале отмены записан преподаватель');


-- ---------------------------------------------------------------------
-- 5. Посещаемость
-- ---------------------------------------------------------------------
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO attendance(session_id, student_id, status, updated_by) VALUES (%s, %s, 'present', %s)$q$,
  pg_temp.sess('Пара 1'), pg_temp.uid('student'), pg_temp.uid('teacher')),
  'IH409', 'на отменённой паре отметки ставить нельзя');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO attendance(session_id, student_id, status, updated_by) VALUES (%s, %s, 'present', %s)$q$,
  pg_temp.sess('Пара 2'), pg_temp.uid('other'), pg_temp.uid('teacher')),
  'IH422', 'нельзя отметить студента не из группы');
SELECT pg_temp.expect_ok(format(
  $q$INSERT INTO attendance(session_id, student_id, status, updated_by) VALUES (%s, %s, 'present', %s)$q$,
  pg_temp.sess('Пара 2'), pg_temp.uid('student'), pg_temp.uid('teacher')),
  'студента своей группы отметить можно');


-- ---------------------------------------------------------------------
-- 6. Ссылка на созвон set_session_meeting
-- ---------------------------------------------------------------------
SELECT pg_temp.expect_error(format(
  'SELECT set_session_meeting(%s, %s, %L, %L, %L)', pg_temp.sess('Пара 2'), pg_temp.uid('teacher2'),
  'current_only', 'https://meet.example.org/a', 'Meet'),
  'IH404', 'чужой преподаватель не меняет ссылку');
SELECT pg_temp.expect_error(format(
  'SELECT set_session_meeting(%s, %s, %L, %L, %L)', pg_temp.sess('Пара 2'), pg_temp.uid('teacher'),
  'current_only', 'http://meet.example.org/a', 'Meet'),
  'IH422', 'ссылка должна быть https');
SELECT pg_temp.expect_error(format(
  'SELECT set_session_meeting(%s, %s, %L, %L, %L)', pg_temp.sess('Пара 2'), pg_temp.uid('teacher'),
  'forever', 'https://meet.example.org/a', 'Meet'),
  'IH422', 'неизвестный режим ссылки');
SELECT pg_temp.expect_ok(format(
  'SELECT set_session_meeting(%s, %s, %L, %L, %L)', pg_temp.sess('Пара 2'), pg_temp.uid('teacher'),
  'future_default', 'https://meet.example.org/new', 'Meet'),
  'преподаватель ставит ссылку для этой и будущих пар');
SELECT pg_temp.ok((SELECT current_meeting_url = 'https://meet.example.org/new' FROM offerings WHERE id = pg_temp.off()),
  'ссылка стала ссылкой предмета по умолчанию');
INSERT INTO sessions(offering_id, title, starts_at) VALUES (pg_temp.off(), 'Пара 4', now() + interval '28 days');
SELECT pg_temp.ok((SELECT meeting_url = 'https://meet.example.org/new' FROM sessions WHERE id = pg_temp.sess('Пара 4')),
  'новая пара сама получила новую ссылку');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM audit_events
                   WHERE object_type = 'session' AND object_id = pg_temp.sess('Пара 2') AND action = 'meeting'
                     AND actor_id = pg_temp.uid('teacher')),
  'смена ссылки записана в журнал');


-- ---------------------------------------------------------------------
-- 7. Заявки на зачёт за хакатон
-- ---------------------------------------------------------------------
INSERT INTO hackathons(title) VALUES ('CHK016 Хакатон');
INSERT INTO achievements(owner_id, hackathon_id, title, contribution)
SELECT pg_temp.uid('student'), id, 'Проект студента', 'Сделал базу данных' FROM hackathons WHERE title = 'CHK016 Хакатон';
INSERT INTO achievements(owner_id, hackathon_id, title, contribution)
SELECT pg_temp.uid('other'), id, 'Проект чужого', 'Чужой вклад' FROM hackathons WHERE title = 'CHK016 Хакатон';

SELECT pg_temp.expect_error(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('teacher'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект студента'), 'assignment'),
  'IH403', 'преподаватель не подаёт заявку на зачёт');
SELECT pg_temp.expect_error(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('other'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект чужого'), 'assignment'),
  'IH404', 'студент не подаёт заявку по чужому предмету');
SELECT pg_temp.expect_error(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('student'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект чужого'), 'assignment'),
  'IH422', 'нельзя подать заявку с чужим достижением');
SELECT pg_temp.expect_error(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('student'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект студента'), 'everything'),
  'IH422', 'объём зачёта только из списка');
SELECT pg_temp.expect_ok(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('student'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект студента'), 'assignment'),
  'студент подаёт заявку');
SELECT pg_temp.ok((SELECT status = 'pending' AND version = 1 AND snapshot->>'contribution' = 'Сделал базу данных'
                   FROM credit_requests WHERE id = pg_temp.credit()),
  'заявка на рассмотрении, версия 1, снимок достижения сохранён');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM notifications
                   WHERE recipient_id = pg_temp.uid('teacher') AND event_key = 'credit:' || pg_temp.credit()),
  'преподаватель получил уведомление о заявке');
SELECT pg_temp.expect_error(format(
  'SELECT create_credit_request(%s, %s, %s, %L)', pg_temp.uid('student'), pg_temp.off(),
  (SELECT id FROM achievements WHERE title = 'Проект студента'), 'coursework'),
  'IH409', 'вторая активная заявка по тому же предмету запрещена');

SELECT pg_temp.expect_error(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, NULL, %L)', pg_temp.credit(), pg_temp.uid('teacher2'), 1,
  'rejected', 'Нет'),
  'IH404', 'чужой преподаватель не решает заявку');
SELECT pg_temp.expect_error(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, %L, %L)', pg_temp.credit(), pg_temp.uid('teacher'), 7,
  'approved', 'assignment', 'Да'),
  'IH409', 'решение с устаревшей версией отклоняется');
SELECT pg_temp.expect_error(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, NULL, %L)', pg_temp.credit(), pg_temp.uid('teacher'), 1,
  'rejected', ''),
  'IH422', 'отказ без комментария запрещён');
SELECT pg_temp.expect_error(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, NULL, %L)', pg_temp.credit(), pg_temp.uid('teacher'), 1,
  'approved', 'Да'),
  'IH422', 'одобрение без объёма зачёта запрещено');
SELECT pg_temp.expect_ok(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, NULL, %L)', pg_temp.credit(), pg_temp.uid('teacher'), 1,
  'needs_info', 'Приложите ссылку на репозиторий'),
  'преподаватель просит уточнения');
SELECT pg_temp.ok((SELECT status = 'needs_info' AND version = 2 AND reviewed_by = pg_temp.uid('teacher')
                          AND reviewed_at IS NOT NULL
                   FROM credit_requests WHERE id = pg_temp.credit()),
  'версия выросла до 2, проверяющий и время записаны');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM credit_history WHERE request_id = pg_temp.credit()),
  'база сама записала историю решения');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM notifications
                   WHERE recipient_id = pg_temp.uid('student')
                     AND event_key = 'credit-decision:' || pg_temp.credit() || ':2'),
  'студент получил уведомление о решении');
SELECT pg_temp.expect_error(format(
  $q$UPDATE credit_requests SET status = 'approved', decision_scope = 'assignment', reviewed_by = %s WHERE id = %s$q$,
  pg_temp.uid('teacher'), pg_temp.credit()),
  'IH409', 'из «нужны уточнения» сразу в «одобрено» перейти нельзя');
SELECT pg_temp.expect_error(format(
  'SELECT resubmit_credit_request(%s, %s, %s, %L)', pg_temp.credit(), pg_temp.uid('student'), 1, 'Ссылка: ...'),
  'IH409', 'дополнение с устаревшей версией отклоняется');
SELECT pg_temp.expect_ok(format(
  'SELECT resubmit_credit_request(%s, %s, %s, %L)', pg_temp.credit(), pg_temp.uid('student'), 2,
  'Сделал базу данных, репозиторий github.com/example'),
  'студент дополняет заявку');
SELECT pg_temp.ok((SELECT status = 'pending' AND version = 3 AND reviewed_by IS NULL AND reviewed_at IS NULL
                          AND snapshot->>'contribution' LIKE '%github.com/example'
                   FROM credit_requests WHERE id = pg_temp.credit()),
  'заявка снова на рассмотрении, версия 3, вклад обновлён');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM notifications
                   WHERE recipient_id = pg_temp.uid('teacher')
                     AND event_key = 'credit-resubmit:' || pg_temp.credit() || ':3'),
  'преподаватель получил уведомление о дополнении');
SELECT pg_temp.expect_ok(format(
  'SELECT decide_credit_request(%s, %s, %s, %L, %L, %L)', pg_temp.credit(), pg_temp.uid('teacher'), 3,
  'approved', 'assignment', 'Зачтено'),
  'преподаватель одобряет заявку');
SELECT pg_temp.ok((SELECT status = 'approved' AND version = 4 AND decision_scope = 'assignment'
                   FROM credit_requests WHERE id = pg_temp.credit())
              AND (SELECT count(*) = 3 FROM credit_history WHERE request_id = pg_temp.credit()),
  'заявка одобрена, версия 4, в истории три записи');
SELECT pg_temp.expect_error(format(
  $q$UPDATE credit_requests SET comment = 'Передумал' WHERE id = %s$q$, pg_temp.credit()),
  'IH409', 'одобренную заявку изменить нельзя');


-- ---------------------------------------------------------------------
-- 8. Проекты: лимит мест
-- ---------------------------------------------------------------------
INSERT INTO projects(owner_id, title, description) VALUES (pg_temp.uid('teacher'), 'CHK016 Проект', 'Описание');
INSERT INTO project_roles(project_id, title, capacity)
SELECT id, 'Бэкенд', 1 FROM projects WHERE title = 'CHK016 Проект';
INSERT INTO applications(role_id, user_id)
SELECT r.id, u.id FROM project_roles r, users u
WHERE r.title = 'Бэкенд' AND r.project_id = (SELECT id FROM projects WHERE title = 'CHK016 Проект')
  AND u.email IN ('student@chk016.local', 'other@chk016.local');

SELECT pg_temp.expect_error(format('SELECT accept_application(%s, %s)',
  (SELECT a.id FROM applications a WHERE a.user_id = pg_temp.uid('student')
     AND a.role_id = (SELECT id FROM project_roles WHERE title = 'Бэкенд'
                      AND project_id = (SELECT id FROM projects WHERE title = 'CHK016 Проект'))),
  pg_temp.uid('teacher2')),
  'IH404', 'принять отклик может только владелец проекта');
SELECT pg_temp.expect_ok(format('SELECT accept_application(%s, %s)',
  (SELECT a.id FROM applications a WHERE a.user_id = pg_temp.uid('student')
     AND a.role_id = (SELECT id FROM project_roles WHERE title = 'Бэкенд'
                      AND project_id = (SELECT id FROM projects WHERE title = 'CHK016 Проект'))),
  pg_temp.uid('teacher')),
  'владелец принимает первый отклик');
SELECT pg_temp.expect_error(format('SELECT accept_application(%s, %s)',
  (SELECT a.id FROM applications a WHERE a.user_id = pg_temp.uid('other')
     AND a.role_id = (SELECT id FROM project_roles WHERE title = 'Бэкенд'
                      AND project_id = (SELECT id FROM projects WHERE title = 'CHK016 Проект'))),
  pg_temp.uid('teacher')),
  'IH409', 'второй отклик на последнее место не проходит');
SELECT pg_temp.expect_error(format('SELECT accept_application(%s, %s)',
  (SELECT a.id FROM applications a WHERE a.user_id = pg_temp.uid('student')
     AND a.role_id = (SELECT id FROM project_roles WHERE title = 'Бэкенд'
                      AND project_id = (SELECT id FROM projects WHERE title = 'CHK016 Проект'))),
  pg_temp.uid('teacher')),
  'IH409', 'уже принятый отклик повторно не принимается');


-- ---------------------------------------------------------------------
-- 9. Календарь: представление calendar_items и функция calendar_for
-- ---------------------------------------------------------------------
INSERT INTO calendar_events(offering_id, kind, title, event_date, status, created_by)
VALUES (pg_temp.off(), 'test', 'CHK016 Черновик контрольной', msk_today() + 5, 'draft', pg_temp.uid('teacher'));

SELECT pg_temp.ok((SELECT count(*) >= 4 FROM calendar_items WHERE offering_id = pg_temp.off()),
  'представление собирает пары, домашки и события предмета');
SELECT pg_temp.ok((SELECT count(*) > 0 FROM calendar_for(pg_temp.uid('student'), msk_today(), msk_today() + 40) x
                   WHERE (x->>'offering_id')::int = pg_temp.off()),
  'студент группы видит календарь предмета');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM calendar_for(pg_temp.uid('other'), msk_today(), msk_today() + 40) x
                   WHERE (x->>'offering_id')::int = pg_temp.off()),
  'студент другой группы не видит календарь предмета');
SELECT pg_temp.ok((SELECT x->>'status' = 'cancelled'
                   FROM calendar_for(pg_temp.uid('student'), msk_today(), msk_today() + 40) x
                   WHERE x->>'source_type' = 'session' AND (x->>'source_id')::int = pg_temp.sess('Пара 1')),
  'отменённая пара в календаре помечена как отменённая');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM calendar_for(pg_temp.uid('student'), msk_today(), msk_today() + 40) x
                              WHERE x->>'title' = 'CHK016 Черновик контрольной'),
  'черновик события студент не видит');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM calendar_for(pg_temp.uid('teacher'), msk_today(), msk_today() + 40) x
                          WHERE x->>'title' = 'CHK016 Черновик контрольной'),
  'черновик события преподаватель видит');
INSERT INTO homework_done(homework_id, user_id)
SELECT id, pg_temp.uid('student') FROM homework WHERE session_id = pg_temp.sess('Пара 1');
SELECT pg_temp.ok((SELECT (x->>'done')::boolean
                   FROM calendar_for(pg_temp.uid('student'), msk_today(), msk_today() + 40) x
                   WHERE x->>'source_type' = 'homework' AND x->>'title' = 'Построить ER-диаграмму'),
  'отметка «выполнено» по домашке у студента видна');


-- ---------------------------------------------------------------------
-- 10. Служебное
-- ---------------------------------------------------------------------
INSERT INTO login_sessions(token_hash, user_id, expires_at)
VALUES ('chk016-old', pg_temp.uid('student'), now() - interval '1 day'),
       ('chk016-new', pg_temp.uid('student'), now() + interval '1 day');
-- удаление отдельным шагом: внутри одного запроса проверка видела бы данные до удаления
CREATE TEMP TABLE chk_cleanup ON COMMIT DROP AS SELECT cleanup_expired_sessions() AS removed;
SELECT pg_temp.ok((SELECT removed >= 1 FROM chk_cleanup)
              AND NOT EXISTS (SELECT 1 FROM login_sessions WHERE token_hash = 'chk016-old')
              AND EXISTS (SELECT 1 FROM login_sessions WHERE token_hash = 'chk016-new'),
  'просроченные входы удаляются, действующие остаются');
SELECT pg_temp.ok(notify_offering_students(pg_temp.off(), msk_today(), 'chk016-notice', 'Проверка', '', 'home', NULL) = 1
              AND notify_offering_students(pg_temp.off(), msk_today(), 'chk016-notice', 'Проверка', '', 'home', NULL) = 0,
  'рассылка доходит до группы и не дублируется');


-- ---------------------------------------------------------------------
-- Итог
-- ---------------------------------------------------------------------
SELECT n AS "№",
       CASE WHEN ok THEN 'OK' ELSE 'ОШИБКА' END AS "итог",
       label AS "проверка",
       detail AS "ответ базы"
FROM chk_results
ORDER BY n;

DO $$
DECLARE
  v_total integer;
  v_bad text;
BEGIN
  SELECT count(*), string_agg(n || '. ' || label || COALESCE(' (' || detail || ')', ''), E'\n' ORDER BY n)
           FILTER (WHERE NOT ok)
    INTO v_total, v_bad
  FROM chk_results;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'Проверки 016 не прошли:\n%', v_bad;
  END IF;
  RAISE NOTICE 'Проверки 016: все % прошли', v_total;
END $$;

ROLLBACK;
