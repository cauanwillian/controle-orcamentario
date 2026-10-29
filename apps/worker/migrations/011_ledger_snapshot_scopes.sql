-- Exported entry numbers can be reassigned. A published source replaces the
-- declared date/account interval for the PAs actually observed in that source.
-- Raw rows and content revisions remain preserved; no financial-row deletion.
SELECT pg_advisory_xact_lock(hashtext('ledger-import-current'));
LOCK TABLE ledger_entry IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.ledger_snapshot_pas_valid(codes TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT cardinality(codes) > 0
    AND NOT EXISTS(SELECT 1 FROM unnest(codes) code WHERE code IS NULL OR code !~ '^(0|[1-9][0-9]*)$')
    AND cardinality(codes) = (SELECT COUNT(DISTINCT code) FROM unnest(codes) code);
$$;

CREATE TABLE IF NOT EXISTS ledger_import_scope (
  import_batch_id UUID PRIMARY KEY REFERENCES import_batch(id),
  generation BIGSERIAL NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  account_from TEXT NOT NULL,
  account_to TEXT NOT NULL,
  pa_codes TEXT[] NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count > 0),
  cooperative_code TEXT NOT NULL CHECK (cooperative_code='4598'),
  source_emitted_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (period_start <= period_end),
  CHECK (account_from ~ '^[0-9]\.[0-9]\.[0-9]\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}-[0-9]$'),
  CHECK (account_to ~ '^[0-9]\.[0-9]\.[0-9]\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}-[0-9]$'),
  CHECK ((account_from COLLATE "C") <= (account_to COLLATE "C")),
  CHECK (public.ledger_snapshot_pas_valid(pa_codes))
);

-- With no registered scopes this remains identical to migration 010.
-- Sequence allocation happens under the import lock immediately before
-- publication, so transaction start times cannot reorder competing imports.
CREATE OR REPLACE VIEW ledger_entry_current AS
SELECT l.* FROM ledger_entry l
LEFT JOIN ledger_import_scope own_scope ON own_scope.import_batch_id=l.source_batch_id
WHERE l.superseded_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM ledger_import_scope newer
  JOIN import_batch published ON published.id=newer.import_batch_id AND published.status='PUBLICADO'
  WHERE newer.generation > COALESCE(own_scope.generation,0)
    AND l.posting_date BETWEEN newer.period_start AND newer.period_end
    AND (l.account_code COLLATE "C") BETWEEN (newer.account_from COLLATE "C") AND (newer.account_to COLLATE "C")
    AND COALESCE(NULLIF(LTRIM(public.ledger_identity_component(l.pa_code),'0'),''),'0') = ANY(newer.pa_codes)
);
