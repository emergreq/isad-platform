CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS documents(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 portal_file_id uuid UNIQUE NOT NULL,material_id integer NOT NULL,title text NOT NULL,version integer NOT NULL,checksum text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS chunks(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 document_id bigint NOT NULL REFERENCES documents ON DELETE CASCADE,page integer NOT NULL,ordinal integer NOT NULL,content text NOT NULL,
 search tsvector GENERATED ALWAYS AS(to_tsvector('russian',content)) STORED,UNIQUE(document_id,page,ordinal));
CREATE INDEX IF NOT EXISTS chunks_search ON chunks USING gin(search);
CREATE TABLE IF NOT EXISTS conversations(id uuid PRIMARY KEY,owner_id text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS messages(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,role text NOT NULL,text text NOT NULL,mode text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS answer_sources(message_id bigint REFERENCES messages ON DELETE CASCADE,chunk_id bigint REFERENCES chunks ON DELETE CASCADE,PRIMARY KEY(message_id,chunk_id));
CREATE TABLE IF NOT EXISTS search_runs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id text NOT NULL,query text NOT NULL,result_count integer NOT NULL,elapsed_ms integer NOT NULL,created_at timestamptz DEFAULT now());
