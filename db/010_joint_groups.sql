CREATE TABLE offering_groups(offering_id integer NOT NULL REFERENCES offerings ON DELETE CASCADE,group_id integer NOT NULL REFERENCES groups,PRIMARY KEY(offering_id,group_id));
INSERT INTO offering_groups SELECT id,group_id FROM offerings;
CREATE FUNCTION offering_has_group(oid integer,gid integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM offerings o WHERE o.id=oid AND (o.group_id=gid OR EXISTS(SELECT 1 FROM offering_groups j WHERE j.offering_id=oid AND j.group_id=gid)))
$$;
CREATE FUNCTION offering_group_names(oid integer) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT COALESCE(array_agg(g.name ORDER BY g.name),'{}') FROM groups g WHERE offering_has_group(oid,g.id)
$$;
INSERT INTO groups(name) SELECT 'БИВТ-25-6-2' WHERE EXISTS(SELECT 1 FROM groups WHERE name='БИВТ-25-6-1') ON CONFLICT(name) DO NOTHING;
INSERT INTO offering_groups(offering_id,group_id)
 SELECT o.id,g2.id FROM offerings o JOIN courses c ON c.id=o.course_id JOIN groups g1 ON g1.id=o.group_id
 CROSS JOIN groups g2 WHERE g1.name='БИВТ-25-6-1' AND g2.name='БИВТ-25-6-2'
 AND c.title IN ('Алгоритмы и структуры данных','Практикум программирования на Python','Базы данных') ON CONFLICT DO NOTHING;

CREATE OR REPLACE PROCEDURE cancel_study_session(sid integer, actor integer, reason text, replacement jsonb, request_key text)
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
 FROM memberships m JOIN offerings o ON offering_has_group(o.id,m.group_id)
 WHERE o.id=s.offering_id AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE)
 ON CONFLICT DO NOTHING;
END $$;
