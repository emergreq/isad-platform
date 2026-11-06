-- Проверяем вместимость не только при добавлении, но и при переносе участника.
-- Блокировка целевой роли сериализует конкурирующие изменения.
CREATE OR REPLACE FUNCTION project_members_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r project_roles;
  taken integer;
BEGIN
  SELECT * INTO r FROM project_roles WHERE id = NEW.role_id FOR UPDATE;
  IF NOT FOUND OR r.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'Роль не относится к этому проекту' USING ERRCODE = 'IH422';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Текущая строка ещё находится в таблице: не считаем её дополнительным местом.
    SELECT count(*) INTO taken FROM project_members
    WHERE role_id = NEW.role_id
      AND NOT (project_id = OLD.project_id AND user_id = OLD.user_id);
  ELSE
    SELECT count(*) INTO taken FROM project_members WHERE role_id = NEW.role_id;
  END IF;
  IF taken >= r.capacity THEN
    RAISE EXCEPTION 'Свободных мест нет' USING ERRCODE = 'IH409';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER project_members_capacity ON project_members;
CREATE TRIGGER project_members_capacity
BEFORE INSERT OR UPDATE OF project_id, role_id, user_id ON project_members
FOR EACH ROW EXECUTE FUNCTION project_members_capacity();
