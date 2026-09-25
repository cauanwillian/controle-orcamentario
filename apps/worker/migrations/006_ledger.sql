CREATE TABLE IF NOT EXISTS business_holiday (
  holiday_date DATE PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  posting_date DATE NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT,
  account_id UUID REFERENCES account(id),
  pa_code TEXT NOT NULL,
  lot_code TEXT NOT NULL,
  entry_number TEXT NOT NULL,
  grouping_code TEXT,
  history TEXT,
  debit_amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(20, 6),
  balance_nature TEXT,
  source_batch_id UUID NOT NULL REFERENCES import_batch(id),
  source_row_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_batch_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS ledger_entry_posting_date_idx ON ledger_entry (posting_date);
CREATE INDEX IF NOT EXISTS ledger_entry_account_date_idx ON ledger_entry (account_code, posting_date);
CREATE INDEX IF NOT EXISTS ledger_entry_pa_date_idx ON ledger_entry (pa_code, posting_date);
