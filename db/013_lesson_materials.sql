ALTER TABLE materials ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE stored_files ADD COLUMN archived boolean NOT NULL DEFAULT false;
