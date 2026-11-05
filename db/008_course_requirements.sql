ALTER TABLE offerings ADD COLUMN assessment_type text CHECK(assessment_type IN ('exam','credit','graded_credit'));
ALTER TABLE offerings ADD COLUMN completion_conditions text NOT NULL DEFAULT '';
UPDATE calendar_events SET topics=replace(topics,' Другие темы в сообщении не перечислены.','') WHERE source_key='algo-test-20261113';
