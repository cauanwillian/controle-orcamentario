-- Capture after registration and schema_migration INSERT, before COMMIT,
-- under ledger-import-current lock and SET LOCAL TIME ZONE 'UTC'.
-- The rollback guard computes this same SELECT independently under table locks.
SELECT jsonb_build_object(
  'ledger', (SELECT jsonb_build_object('count', COUNT(*), 'max_updated_at', MAX(updated_at)::TEXT,
    'digest', md5(COALESCE(string_agg(md5(to_jsonb(t)::TEXT), '' ORDER BY id), ''))) FROM ledger_entry t),
  'revisions', (SELECT jsonb_build_object('count', COUNT(*), 'max_archived_at', MAX(archived_at)::TEXT,
    'digest', md5(COALESCE(string_agg(md5(to_jsonb(t)::TEXT), '' ORDER BY id), ''))) FROM ledger_entry_revision t),
  'imports', (SELECT jsonb_build_object('count', COUNT(*), 'max_created_at', MAX(created_at)::TEXT,
    'max_completed_at', MAX(completed_at)::TEXT,
    'digest', md5(COALESCE(string_agg(md5(to_jsonb(t)::TEXT), '' ORDER BY id), ''))) FROM import_batch t),
  'uploads', (SELECT jsonb_build_object('count', COUNT(*), 'max_uploaded_at', MAX(uploaded_at)::TEXT,
    'digest', md5(COALESCE(string_agg(md5(to_jsonb(t)::TEXT), '' ORDER BY id), ''))) FROM ledger_upload t),
  'migrations', (SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM schema_migration t),
  'scopes', (SELECT jsonb_agg(to_jsonb(t) ORDER BY generation) FROM ledger_import_scope t)
) AS state;
