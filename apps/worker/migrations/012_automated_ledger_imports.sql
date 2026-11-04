ALTER TABLE ledger_upload ALTER COLUMN uploaded_by_employee_id DROP NOT NULL;

ALTER TABLE ledger_upload
  ADD COLUMN IF NOT EXISTS upload_source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (upload_source IN ('MANUAL', 'AUTOMATICO', 'CLI'));

ALTER TABLE ledger_upload
  ADD COLUMN IF NOT EXISTS unmapped_account_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS import_batch_source_checksum_status_idx
  ON import_batch (source_type, checksum_sha256, status);
