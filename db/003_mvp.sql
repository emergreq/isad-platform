ALTER TABLE offerings ADD COLUMN current_meeting_url text;
ALTER TABLE offerings ADD COLUMN provider text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN meeting_url text;
ALTER TABLE sessions ADD COLUMN recording_url text;
ALTER TABLE sessions ADD COLUMN cancellation_reason text;
ALTER TABLE sessions ADD COLUMN cancelled_by integer REFERENCES users;
ALTER TABLE sessions ADD COLUMN cancelled_at timestamptz;
ALTER TABLE materials ADD COLUMN kind text NOT NULL DEFAULT 'reference';
ALTER TABLE materials ADD COLUMN topic text NOT NULL DEFAULT '';
ALTER TABLE materials ADD COLUMN author text NOT NULL DEFAULT '';
ALTER TABLE materials ADD COLUMN lesson_no integer;
ALTER TABLE materials ADD COLUMN published boolean NOT NULL DEFAULT true;
ALTER TABLE materials ADD COLUMN source_date date;
CREATE TABLE stored_files (
 id uuid PRIMARY KEY, owner_id integer NOT NULL REFERENCES users,
 material_id integer REFERENCES materials, original_name text NOT NULL,
 storage_name text NOT NULL UNIQUE, mime text NOT NULL, size bigint NOT NULL CHECK(size>0),
 checksum text NOT NULL, page_count integer, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','ready','reference','error')), error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX material_file_checksum ON stored_files(material_id,checksum);
CREATE TABLE calendar_events (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 offering_id integer NOT NULL REFERENCES offerings, session_id integer REFERENCES sessions,
 kind text NOT NULL CHECK(kind IN ('test','deadline','coursework','announcement','consultation')),
 title text NOT NULL, description text NOT NULL DEFAULT '', topics text NOT NULL DEFAULT '',
 event_date date NOT NULL, starts_at timestamptz, url text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','cancelled')),
 created_by integer NOT NULL REFERENCES users, source_key text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_by_offering ON calendar_events(offering_id,event_date);
CREATE TABLE event_progress (event_id integer REFERENCES calendar_events, user_id integer REFERENCES users,
 done boolean NOT NULL DEFAULT false, PRIMARY KEY(event_id,user_id));
CREATE TABLE notifications (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, recipient_id integer NOT NULL REFERENCES users,
 event_key text NOT NULL, title text NOT NULL, message text NOT NULL DEFAULT '',
 target_page text NOT NULL, target_id integer, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 UNIQUE(recipient_id,event_key)
);
CREATE INDEX notifications_owner ON notifications(recipient_id,created_at DESC);
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer REFERENCES users, object_type text NOT NULL, object_id integer,
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cancellation_requests (session_id integer PRIMARY KEY REFERENCES sessions,
 actor_id integer REFERENCES users, request_key text NOT NULL, replacement_id integer REFERENCES homework);
CREATE TABLE meeting_links(offering_id integer REFERENCES offerings,weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 7),
 url text NOT NULL,provider text NOT NULL DEFAULT '',recordings_at_same_url boolean NOT NULL DEFAULT false,PRIMARY KEY(offering_id,weekday));

CREATE FUNCTION snapshot_meeting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.meeting_url IS NULL THEN
   SELECT url INTO NEW.meeting_url FROM meeting_links WHERE offering_id=NEW.offering_id
   AND weekday IN (0,extract(isodow FROM NEW.starts_at AT TIME ZONE 'Europe/Moscow')::integer)
   ORDER BY weekday DESC LIMIT 1;
   IF NEW.meeting_url IS NULL THEN SELECT current_meeting_url INTO NEW.meeting_url FROM offerings WHERE id=NEW.offering_id; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_meeting_snapshot BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION snapshot_meeting();

CREATE PROCEDURE cancel_study_session(sid integer, actor integer, reason text, replacement jsonb, request_key text)
LANGUAGE plpgsql AS $$
DECLARE s sessions; oid integer; replacement_id integer; actor_role text;
BEGIN
 SELECT * INTO s FROM sessions WHERE id=sid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Занятие не найдено'; END IF;
 SELECT role INTO actor_role FROM users WHERE id=actor;
 IF actor_role<>'coordinator' AND NOT EXISTS(SELECT 1 FROM offerings WHERE id=s.offering_id AND teacher_id=actor AND actor_role='teacher') THEN
   RAISE EXCEPTION 'Нет прав на занятие';
 END IF;
 IF s.cancelled THEN RETURN; END IF;
 IF reason IS NULL OR length(trim(reason))=0 THEN RAISE EXCEPTION 'Нужна причина отмены'; END IF;
 UPDATE sessions SET cancelled=true,cancellation_reason=reason,cancelled_by=actor,cancelled_at=now() WHERE id=sid;
 IF replacement IS NOT NULL THEN
   INSERT INTO homework(session_id,title,description,due_at)
   VALUES(sid,replacement->>'title',replacement->>'description',(replacement->>'due_at')::timestamptz) RETURNING id INTO replacement_id;
 END IF;
 INSERT INTO cancellation_requests VALUES(sid,actor,request_key,replacement_id);
 INSERT INTO audit_events(actor_id,object_type,object_id,action,detail)
 VALUES(actor,'session',sid,'cancel',jsonb_build_object('reason',reason,'replacement_id',replacement_id));
 INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id)
 SELECT DISTINCT m.user_id,'cancel-session:'||sid,'Занятие отменено: '||s.title,reason||CASE WHEN replacement_id IS NOT NULL THEN '. Добавлено задание взамен.' ELSE '' END,'calendar',sid
 FROM memberships m JOIN offerings o ON o.group_id=m.group_id
 WHERE o.id=s.offering_id AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE)
 ON CONFLICT DO NOTHING;
END $$;

CREATE TABLE hackathons (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '',
 organizer text NOT NULL DEFAULT '', starts_on date, ends_on date, source_url text NOT NULL DEFAULT '',
 is_demo boolean NOT NULL DEFAULT false, created_by integer REFERENCES users
);
CREATE TABLE user_profiles(user_id integer PRIMARY KEY REFERENCES users, bio text NOT NULL DEFAULT '',
 resume_file_id uuid REFERENCES stored_files);
CREATE TABLE skills(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,name text UNIQUE NOT NULL);
CREATE TABLE user_skills(user_id integer REFERENCES users,skill_id integer REFERENCES skills,PRIMARY KEY(user_id,skill_id));
CREATE TABLE achievements (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id integer NOT NULL REFERENCES users,
 hackathon_id integer REFERENCES hackathons,title text NOT NULL,github_url text NOT NULL DEFAULT '',
 contribution text NOT NULL,certificate_file_id uuid REFERENCES stored_files,
 result text NOT NULL DEFAULT 'participation' CHECK(result IN ('participation','prize','winner')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_requests (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,student_id integer NOT NULL REFERENCES users,
 offering_id integer NOT NULL REFERENCES offerings,achievement_id integer REFERENCES achievements,
 hackathon_id integer NOT NULL REFERENCES hackathons, snapshot jsonb NOT NULL,
 requested_scope text NOT NULL CHECK(requested_scope IN ('assignment','coursework','whole_course')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','needs_info')),
 decision_scope text,comment text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
 reviewed_by integer REFERENCES users,reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'approved' OR (decision_scope IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_credit ON credit_requests(student_id,offering_id) WHERE status IN ('pending','needs_info');
CREATE TABLE credit_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id integer REFERENCES credit_requests,
 actor_id integer REFERENCES users,status text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE import_batches(key text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),detail jsonb NOT NULL DEFAULT '{}');
INSERT INTO skills(name) VALUES('SQL'),('PostgreSQL'),('Python'),('React'),('Алгоритмы'),('Docker') ON CONFLICT DO NOTHING;
