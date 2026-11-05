CREATE TABLE coursework (
 event_id integer PRIMARY KEY REFERENCES calendar_events ON DELETE CASCADE,
 requirements_file_id uuid NOT NULL REFERENCES stored_files
);
