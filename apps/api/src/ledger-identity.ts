import { createHash } from "node:crypto";

// Must match ledger_entry_identity_key() in migration 010 and the worker helper.
export function ledgerIdentityKey(date: string, account: string, pa: string, lot: string, entry: string): string {
  const parts = [date, account, pa, lot, entry].map(value => value.trim());
  if (parts.some(value => !value || /[\u0000-\u001f\u007f|]/.test(value))) throw new Error("Identificador contábil vazio ou com caracteres inválidos.");
  const [postingDate, accountCode, rawPa, lotCode, entryNumber] = parts;
  const normalizedPa = /^\d+$/.test(rawPa) ? rawPa.replace(/^0+(?=\d)/, "") : rawPa;
  return createHash("sha256").update(["ledger:v2", postingDate, accountCode, normalizedPa, lotCode, entryNumber].join("|")).digest("hex");
}
