ALTER TABLE import_batch ADD COLUMN IF NOT EXISTS reference_date DATE;

CREATE TABLE IF NOT EXISTS app_setting (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_setting (setting_key, setting_value) VALUES
  ('business_timezone', 'America/Cuiaba'),
  ('ledger_accounting_lag_days', '3'),
  ('ledger_import_deadline', '09:00')
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS job_role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_sector_permission (
  role_id UUID NOT NULL REFERENCES job_role(id) ON DELETE CASCADE,
  sector_name TEXT NOT NULL,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, sector_name)
);

CREATE TABLE IF NOT EXISTS employee_role (
  employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES job_role(id) ON DELETE CASCADE,
  source_batch_id UUID REFERENCES import_batch(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, role_id)
);

CREATE TABLE IF NOT EXISTS pa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pa_code TEXT NOT NULL UNIQUE,
  agency_name TEXT,
  regional_code TEXT,
  regional_name TEXT,
  city TEXT,
  is_office BOOLEAN NOT NULL DEFAULT FALSE,
  responsible_name TEXT,
  source_batch_id UUID REFERENCES import_batch(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_name_idx ON employee (name);
CREATE INDEX IF NOT EXISTS role_sector_permission_sector_idx ON role_sector_permission (sector_name);
