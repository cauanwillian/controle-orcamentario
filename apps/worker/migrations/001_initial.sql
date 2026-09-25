CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migration (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('PLANO_CONTAS', 'ORCAMENTO', 'LIVRO_RAZAO', 'CONTROLE_ACESSOS')),
  original_filename TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RECEBIDO', 'PROCESSANDO', 'VALIDADO', 'PUBLICADO', 'REJEITADO')),
  record_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  subgroup_name TEXT,
  sector_code TEXT,
  sector_name TEXT,
  access_scope_name TEXT,
  objective TEXT NOT NULL CHECK (objective IN ('MAIOR', 'MENOR')),
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_group_name_idx ON account (group_name);
CREATE INDEX IF NOT EXISTS account_sector_name_idx ON account (sector_name);
CREATE INDEX IF NOT EXISTS account_access_scope_name_idx ON account (access_scope_name);
