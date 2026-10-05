CREATE TABLE IF NOT EXISTS access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_employee_id UUID REFERENCES employee(id) ON DELETE SET NULL,
  target_employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_audit_log_created_at_idx ON access_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS access_audit_log_target_idx ON access_audit_log (target_employee_id, created_at DESC);
