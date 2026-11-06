-- Schema only: real contacts are loaded privately, outside public source code.
ALTER TABLE contacts ADD COLUMN telegram text NOT NULL DEFAULT '';
ALTER TABLE contacts ALTER COLUMN email SET DEFAULT '';
