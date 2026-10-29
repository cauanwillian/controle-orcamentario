-- RECOVERY ONLY. Stop API/import workers, restore the prior importer code,
-- and take a database backup before executing this reviewed rollback.
-- This intentionally refuses rollback after any subsequent ledger import.
BEGIN;
LOCK TABLE ledger_entry IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE applied TIMESTAMPTZ;
BEGIN
  SELECT applied_at INTO applied FROM schema_migration WHERE version='010_ledger_current_versions.sql';
  IF applied IS NULL THEN RAISE EXCEPTION 'A migração 010 não está aplicada.'; END IF;
  IF EXISTS (SELECT 1 FROM import_batch WHERE source_type='LIVRO_RAZAO' AND created_at>applied)
     OR EXISTS (SELECT 1 FROM ledger_entry WHERE legacy_source_key IS NULL)
     OR EXISTS (SELECT 1 FROM ledger_entry_revision WHERE reason='import-content-update' AND archived_at>applied) THEN
    RAISE EXCEPTION 'Há importações/alterações posteriores. Restauração deve conciliar as revisões, sem sobregravá-las.';
  END IF;
END $$;
DROP INDEX IF EXISTS ledger_entry_current_identity_idx;
UPDATE ledger_entry SET source_key=legacy_source_key WHERE legacy_source_key IS NOT NULL AND source_key IS DISTINCT FROM legacy_source_key;
UPDATE ledger_entry SET superseded_at=NULL,superseded_by=NULL
WHERE id IN (SELECT ledger_entry_id FROM ledger_entry_revision WHERE reason='legacy-grouping-duplicate');
-- Preserve the migration audit trail while allowing deliberate re-application.
UPDATE schema_migration SET version=version || '.rolled-back.' || to_char(NOW(),'YYYYMMDDHH24MISSUS') WHERE version='010_ledger_current_versions.sql';
COMMIT;
