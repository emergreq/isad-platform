CREATE TABLE project_interests (
 user_id integer PRIMARY KEY REFERENCES users,
 topics text[] NOT NULL DEFAULT '{}', roles text[] NOT NULL DEFAULT '{}',
 enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
