CREATE TABLE IF NOT EXISTS budget_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id UUID NOT NULL REFERENCES budget_version(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  pa_code TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_id UUID REFERENCES account(id),
  amount NUMERIC(20,6) NOT NULL,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (budget_version_id, period_date, pa_code, account_code)
);

CREATE INDEX IF NOT EXISTS budget_entry_period_pa_idx ON budget_entry (period_date, pa_code);
CREATE INDEX IF NOT EXISTS budget_entry_account_period_idx ON budget_entry (account_code, period_date);
