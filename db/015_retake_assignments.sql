CREATE TABLE retake_eligibility(retake_id integer NOT NULL REFERENCES retakes, debt_id integer NOT NULL REFERENCES debts, PRIMARY KEY(retake_id,debt_id));
INSERT INTO retake_eligibility(retake_id,debt_id) SELECT r.id,d.id FROM retakes r JOIN debts d ON d.offering_id=r.offering_id WHERE r.kind='debt_day' AND NOT d.closed;
INSERT INTO retake_eligibility(retake_id,debt_id) SELECT retake_id,debt_id FROM retake_registrations ON CONFLICT DO NOTHING;
