import { BadRequestException } from "@nestjs/common";

export type EntrySearchType = "history" | "amount" | "entry";
export type EntrySearch = { entrySearch: string; entrySearchType: EntrySearchType };

/** Decimal string, never a floating-point conversion; signs are ignored. */
export function parseEntrySearchAmount(value: string): string {
  const raw = value.replace(/\s/g, "").replace(/^([+-]?)R\$/i, "$1").replace(/^[+-]/, "");
  let decimal: string;
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(raw)) {
    decimal = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    decimal = raw.replace(/\./g, "");
  } else if (/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    decimal = raw;
  } else {
    throw new BadRequestException("Informe um valor válido, como 1.234,56 ou 36,00.");
  }
  const [integer, fraction = ""] = decimal.split(".");
  return `${integer.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

export function normalizeEntrySearch(input: unknown, inputType: unknown = "history"): EntrySearch | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "string") throw new BadRequestException("Busca de lançamentos inválida.");
  const entrySearch = input.trim();
  if (entrySearch.length > 200) throw new BadRequestException("A busca deve ter no máximo 200 caracteres.");
  if (!entrySearch) return undefined;
  const entrySearchType = inputType ?? "history";
  if (entrySearchType !== "history" && entrySearchType !== "amount" && entrySearchType !== "entry") {
    throw new BadRequestException("Tipo de busca inválido.");
  }
  if (entrySearchType === "amount") parseEntrySearchAmount(entrySearch);
  return { entrySearch, entrySearchType };
}

/** The clauses use the ledger alias l and only add bound parameters. */
export function appendEntrySearchCondition(conditions: string[], values: unknown[], input: unknown, inputType: unknown = "history") {
  const search = normalizeEntrySearch(input, inputType);
  if (!search) return;
  if (search.entrySearchType === "amount") {
    values.push(parseEntrySearchAmount(search.entrySearch));
    const parameter = `$${values.length}::numeric`;
    conditions.push(`(ABS(l.debit_amount) = ${parameter} OR ABS(l.credit_amount) = ${parameter} OR ABS(l.credit_amount - l.debit_amount) = ${parameter})`);
    return;
  }
  if (search.entrySearchType === "entry") {
    if (/^\d+$/.test(search.entrySearch)) {
      values.push(search.entrySearch.replace(/^0+(?=\d)/, ""));
      conditions.push(`(BTRIM(l.entry_number) ~ '^[0-9]+$' AND COALESCE(NULLIF(LTRIM(BTRIM(l.entry_number), '0'), ''), '0') = $${values.length})`);
    } else {
      values.push(search.entrySearch.toLocaleLowerCase("pt-BR"));
      conditions.push(`LOWER(BTRIM(l.entry_number)) = $${values.length}`);
    }
    return;
  }
  const folded = search.entrySearch.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/[\\%_]/g, "\\$&");
  values.push(`%${folded}%`);
  conditions.push(`translate(lower(COALESCE(l.history, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn') LIKE $${values.length} ESCAPE E'\\\\'`);
}
