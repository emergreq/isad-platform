ALTER TABLE stored_files ADD COLUMN purpose text NOT NULL DEFAULT 'personal' CHECK(purpose IN ('personal','library','schedule'));
UPDATE stored_files SET purpose='library' WHERE material_id IS NOT NULL;
ALTER TABLE materials ADD COLUMN import_key text UNIQUE;
