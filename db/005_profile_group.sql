ALTER TABLE user_profiles ADD COLUMN subgroup smallint NOT NULL DEFAULT 1 CHECK(subgroup IN (1,2));
