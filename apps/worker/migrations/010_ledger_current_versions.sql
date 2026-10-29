-- Preserve original rows and their keys while reconciling identities whose
-- export-only grouping code changed between otherwise identical imports.
LOCK TABLE ledger_entry IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE ledger_entry ADD COLUMN IF NOT EXISTS legacy_source_key TEXT;
ALTER TABLE ledger_entry ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE ledger_entry ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES ledger_entry(id);

CREATE TABLE IF NOT EXISTS ledger_entry_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_entry_id UUID NOT NULL REFERENCES ledger_entry(id),
  source_batch_id UUID NOT NULL REFERENCES import_batch(id),
  reason TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ledger_entry_revision_entry_idx ON ledger_entry_revision (ledger_entry_id, archived_at DESC);

CREATE OR REPLACE FUNCTION public.ledger_identity_component(value TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT SET search_path = pg_catalog, public AS $$
DECLARE normalized TEXT;
BEGIN
  -- Same edge whitespace as ECMAScript String.trim(). Delimiters and internal
  -- control characters are invalid in accounting identifiers, not separators.
  normalized := BTRIM(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  IF normalized = '' OR normalized ~ '[[:cntrl:]|]' THEN
    RAISE EXCEPTION 'Identificador contábil vazio ou com caracteres inválidos.' USING ERRCODE='22023';
  END IF;
  RETURN normalized;
END $$;

CREATE OR REPLACE FUNCTION public.ledger_entry_identity_key(posting_date DATE, account_code TEXT, pa_code TEXT, lot_code TEXT, entry_number TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT SET search_path = pg_catalog, public AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', 'ledger:v2', to_char(posting_date, 'YYYY-MM-DD'), public.ledger_identity_component(account_code),
    CASE WHEN public.ledger_identity_component(pa_code) ~ '^[0-9]+$' THEN COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code), '0'), ''), '0') ELSE public.ledger_identity_component(pa_code) END,
    public.ledger_identity_component(lot_code), public.ledger_identity_component(entry_number)), 'UTF8')), 'hex');
$$;

-- Fail closed for ambiguous identity collisions. Financially different rows
-- must never be silently collapsed by this reconciliation.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entry l WHERE l.superseded_at IS NULL
    GROUP BY ledger_entry_identity_key(l.posting_date, l.account_code, l.pa_code, l.lot_code, l.entry_number)
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT (COALESCE(l.history, ''), l.debit_amount, l.credit_amount)) > 1
  ) THEN RAISE EXCEPTION 'Há identidades contábeis ambíguas com conteúdos diferentes. Reconciliação cancelada.'; END IF;
  IF EXISTS (
    SELECT 1 FROM ledger_entry l WHERE l.superseded_at IS NULL
    GROUP BY l.source_batch_id, ledger_entry_identity_key(l.posting_date, l.account_code, l.pa_code, l.lot_code, l.entry_number)
    HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Há identidades repetidas no mesmo arquivo. Reconciliação cancelada.'; END IF;
END $$;

UPDATE ledger_entry SET legacy_source_key = source_key WHERE legacy_source_key IS NULL;

CREATE TEMP TABLE IF NOT EXISTS ledger_duplicate_reconciliation (id UUID, current_id UUID) ON COMMIT DROP;
TRUNCATE pg_temp.ledger_duplicate_reconciliation;
INSERT INTO ledger_duplicate_reconciliation
WITH ranked AS (
  SELECT l.id, FIRST_VALUE(l.id) OVER (
    PARTITION BY ledger_entry_identity_key(l.posting_date, l.account_code, l.pa_code, l.lot_code, l.entry_number)
    ORDER BY b.completed_at DESC NULLS LAST, b.created_at DESC, l.updated_at DESC, l.id DESC
  ) AS current_id
  FROM ledger_entry l JOIN import_batch b ON b.id = l.source_batch_id
  WHERE l.superseded_at IS NULL
)
SELECT id, current_id FROM ranked WHERE id <> current_id;

INSERT INTO ledger_entry_revision (ledger_entry_id, source_batch_id, reason, snapshot)
SELECT l.id, l.source_batch_id, 'legacy-grouping-duplicate', to_jsonb(l)
FROM ledger_entry l JOIN ledger_duplicate_reconciliation d ON d.id = l.id;

UPDATE ledger_entry l SET superseded_at = NOW(), superseded_by = d.current_id
FROM ledger_duplicate_reconciliation d WHERE d.id = l.id;

UPDATE ledger_entry l
SET source_key = ledger_entry_identity_key(l.posting_date, l.account_code, l.pa_code, l.lot_code, l.entry_number)
WHERE l.superseded_at IS NULL
  AND l.source_key IS DISTINCT FROM ledger_entry_identity_key(l.posting_date, l.account_code, l.pa_code, l.lot_code, l.entry_number);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entry_current_identity_idx
ON ledger_entry (ledger_entry_identity_key(posting_date, account_code, pa_code, lot_code, entry_number))
WHERE superseded_at IS NULL;

CREATE OR REPLACE VIEW ledger_entry_current AS SELECT * FROM ledger_entry WHERE superseded_at IS NULL;

-- Re-importing unchanged data only refreshes provenance. Archive content
-- changes before upsert so corrected histories/amounts remain recoverable.
CREATE OR REPLACE FUNCTION public.archive_ledger_entry_revision() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(OLD) - ARRAY['updated_at', 'source_batch_id', 'source_row_number', 'source_key', 'legacy_source_key'])
     IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['updated_at', 'source_batch_id', 'source_row_number', 'source_key', 'legacy_source_key']) THEN
    INSERT INTO public.ledger_entry_revision (ledger_entry_id, source_batch_id, reason, snapshot)
    VALUES (OLD.id, OLD.source_batch_id, 'import-content-update', to_jsonb(OLD));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_entry_revision_before_update ON ledger_entry;
CREATE TRIGGER ledger_entry_revision_before_update BEFORE UPDATE ON ledger_entry
FOR EACH ROW EXECUTE FUNCTION archive_ledger_entry_revision();
