ALTER TABLE sessions ADD COLUMN original_starts_at timestamptz;
ALTER TABLE sessions ADD COLUMN rescheduled_at timestamptz;
ALTER TABLE sessions ADD COLUMN rescheduled_by integer REFERENCES users;
ALTER TABLE sessions ADD COLUMN reschedule_reason text;
