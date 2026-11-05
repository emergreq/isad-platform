ALTER TABLE contacts ADD COLUMN telegram text NOT NULL DEFAULT '';
ALTER TABLE contacts ALTER COLUMN email SET DEFAULT '';
UPDATE contacts SET name='Иван Зимин',position='Преподаватель баз данных',email='',telegram='zimin_ivan_a',verified_at=CURRENT_DATE WHERE name='Пример контакта' AND email='contact@example.org';
INSERT INTO contacts(name,position,email,telegram)
SELECT v.name,v.position,'',v.telegram FROM (VALUES
 ('Иван Зимин','Преподаватель баз данных','zimin_ivan_a'),
 ('Овчинников Сергей Андреевич','Преподаватель практикума программирования на Python · Академический руководитель трека ИСАД','serov0305'),
 ('Куренков Владимир Вячеславович','Преподаватель алгоритмов и структур данных','vvk101'),
 ('Маркин Александр Александрович','Менеджер программы ИСАД','lexmarkin')
) AS v(name,position,telegram) WHERE NOT EXISTS(SELECT 1 FROM contacts c WHERE c.telegram=v.telegram);
