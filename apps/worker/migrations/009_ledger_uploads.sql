CREATE TABLE IF NOT EXISTS ledger_upload (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID NOT NULL UNIQUE REFERENCES import_batch(id) ON DELETE CASCADE,
  uploaded_by_employee_id UUID NOT NULL REFERENCES employee(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stored_filename TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_upload_uploaded_at_idx ON ledger_upload (uploaded_at DESC);
