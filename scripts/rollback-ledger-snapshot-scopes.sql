-- RECOVERY ONLY. Stop API/import workers and verify the pre-011 backup first.
-- This restores the 010 read view only before any subsequent data/import change.
-- Raw rows, revisions and the scope audit table are deliberately retained.
-- Do not resume imports until 011 is reapplied or the matching importer is restored.
--
-- Required settings, supplied from the APPLIED artifact:
--   app.rollback_011_expected_generation = recoveryCheckpoint.generation
--   app.rollback_011_expected_batch_id   = recoveryCheckpoint.import_batch_id
--   app.rollback_011_expected_checkpoint = recoveryCheckpoint.state (JSON)
-- For this standalone script, first set all three with set_config(name, value,
-- false) in a dedicated recovery connection; then execute this file there.
-- A transaction runner may instead omit this file's outer BEGIN/COMMIT and use
-- set_config(name, value, true) after its own BEGIN, before executing this body.
-- For psql, bind each supplied -v value through :'variable' in set_config.
-- Do not manufacture a new checkpoint from the database at recovery time.
--
-- Capture SQL is scripts/ledger-snapshot-checkpoint.sql. Keep the SELECT below
-- equivalent to it; both run with TIME ZONE 'UTC' to preserve timestamp text.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SELECT pg_advisory_xact_lock(hashtext('ledger-import-current'));
LOCK TABLE schema_migration, import_batch, ledger_entry, ledger_entry_revision,
  ledger_upload, ledger_import_scope IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  expected_generation_text TEXT := NULLIF(current_setting('app.rollback_011_expected_generation', true), '');
  expected_batch_text TEXT := NULLIF(current_setting('app.rollback_011_expected_batch_id', true), '');
  expected_checkpoint_text TEXT := NULLIF(current_setting('app.rollback_011_expected_checkpoint', true), '');
  expected_generation BIGINT;
  expected_batch UUID;
  expected_checkpoint JSONB;
  actual_checkpoint JSONB;
  applied TIMESTAMPTZ;
BEGIN
  IF expected_generation_text IS NULL OR expected_generation_text !~ '^[1-9][0-9]*$'
     OR expected_batch_text IS NULL OR expected_checkpoint_text IS NULL THEN
    RAISE EXCEPTION 'Informe geração, lote e checkpoint do artefato aplicado; rollback cancelado.';
  END IF;
  expected_generation := expected_generation_text::BIGINT;
  expected_batch := expected_batch_text::UUID;
  expected_checkpoint := expected_checkpoint_text::JSONB;
  IF jsonb_typeof(expected_checkpoint) <> 'object'
     OR NOT (expected_checkpoint ?& ARRAY['ledger', 'revisions', 'imports', 'uploads', 'migrations', 'scopes']) THEN
    RAISE EXCEPTION 'Checkpoint de recuperação incompleto; rollback cancelado.';
  END IF;

  SELECT applied_at INTO applied FROM schema_migration
  WHERE version = '011_ledger_snapshot_scopes.sql';
  IF applied IS NULL OR NOT EXISTS (
    SELECT 1 FROM schema_migration WHERE version = '010_ledger_current_versions.sql'
  ) THEN
    RAISE EXCEPTION 'As migrações 010 e 011 precisam estar ativas para esta recuperação.';
  END IF;
  IF (SELECT COUNT(*) FROM ledger_import_scope) <> 1 OR NOT EXISTS (
    SELECT 1 FROM ledger_import_scope
    WHERE generation = expected_generation AND import_batch_id = expected_batch
  ) THEN
    RAISE EXCEPTION 'Há outro escopo ou a geração/lote não coincide; restauração deve conciliar os arquivos originais.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM import_batch WHERE id = expected_batch
      AND source_type = 'LIVRO_RAZAO' AND status = 'PUBLICADO'
  ) THEN
    RAISE EXCEPTION 'O lote esperado não está publicado; rollback cancelado.';
  END IF;
  IF EXISTS (SELECT 1 FROM import_batch WHERE created_at > applied OR completed_at > applied)
     OR EXISTS (SELECT 1 FROM ledger_entry WHERE created_at > applied OR updated_at > applied)
     OR EXISTS (SELECT 1 FROM ledger_entry_revision WHERE archived_at > applied)
     OR EXISTS (SELECT 1 FROM ledger_upload WHERE uploaded_at > applied) THEN
    RAISE EXCEPTION 'Há importações ou alterações posteriores à aplicação; use restauração auditada com os originais e revisões.';
  END IF;

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
  ) INTO actual_checkpoint;
  IF actual_checkpoint IS DISTINCT FROM expected_checkpoint THEN
    RAISE EXCEPTION 'O estado atual difere do checkpoint aplicado; rollback cancelado para preservar alterações posteriores.';
  END IF;
END $$;

CREATE OR REPLACE VIEW ledger_entry_current AS
SELECT * FROM ledger_entry WHERE superseded_at IS NULL;

-- Preserve migration history and permit only deliberate re-application.
UPDATE schema_migration
SET version = version || '.rolled-back.' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
WHERE version = '011_ledger_snapshot_scopes.sql';
COMMIT;
