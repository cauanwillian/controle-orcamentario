-- O arquivo de orçamento pode ter mais de uma linha para a mesma PA e código
-- de conta (por exemplo, níveis diferentes da estrutura contábil). A linha de
-- origem é preservada para impedir perda ou consolidação silenciosa de valores.
ALTER TABLE budget_entry
  DROP CONSTRAINT IF EXISTS budget_entry_budget_version_id_period_date_pa_code_account__key;

ALTER TABLE budget_entry
  ADD COLUMN source_account_name TEXT,
  ADD COLUMN source_row_number INTEGER;

CREATE UNIQUE INDEX budget_entry_source_period_key
  ON budget_entry (budget_version_id, source_row_number, period_date);
