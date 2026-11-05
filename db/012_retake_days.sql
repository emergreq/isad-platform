ALTER TABLE retakes ADD COLUMN kind text NOT NULL DEFAULT 'retake' CHECK(kind IN ('retake','debt_day'));
ALTER TABLE retakes ADD COLUMN status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled'));
ALTER TABLE retakes ADD COLUMN change_reason text NOT NULL DEFAULT '';
ALTER TABLE retakes ADD COLUMN previous_starts_at timestamptz;
ALTER TABLE retakes ADD COLUMN revision integer NOT NULL DEFAULT 1;
