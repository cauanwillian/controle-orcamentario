import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { appendEntrySearchCondition, normalizeEntrySearch, parseEntrySearchAmount } from "./entry-search.js";

test("search trims, defaults to history, and blank input disables any mode", () => {
  assert.deepEqual(normalizeEntrySearch("  Água  "), { entrySearch: "Água", entrySearchType: "history" });
  assert.equal(normalizeEntrySearch(" \n ", "invalid"), undefined);
  assert.equal(normalizeEntrySearch(undefined, "amount"), undefined);
  for (const [input, type] of [["x", "invalid"], [["x"], "history"], ["x".repeat(201), "entry"]]) {
    assert.throws(() => normalizeEntrySearch(input, type), (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400);
  }
});

test("amounts use exact decimal strings across BR currency and decimal formats", () => {
  for (const [input, expected] of [
    ["R$ 1.234,56", "1234.56"], ["-R$ 1.234,56", "1234.56"], ["R$ -36,00", "36.00"],
    ["1234.56", "1234.56"], ["36", "36.00"], ["36,0", "36.00"], ["1.234", "1234.00"],
    ["0000,00", "0.00"], ["9007199254740993,01", "9007199254740993.01"], ["+0.5", "0.50"],
  ]) assert.equal(parseEntrySearchAmount(input), expected, input);
});

test("invalid money input is rejected before any query", () => {
  for (const input of ["", "NaN", "Infinity", "1e4", "1,234", "1234.567", "1.23.456,78", "1,2,3", "1 OR 1=1", "36,", "--36", "R$R$36"]) {
    assert.throws(() => parseEntrySearchAmount(input), (error: unknown) => error instanceof BadRequestException, input);
  }
  assert.throws(() => normalizeEntrySearch("1,234", "amount"), (error: unknown) => error instanceof BadRequestException);
});

test("history treats wildcard and SQL-looking text literally, with accent folding", () => {
  const conditions = ["a.access_scope_name = ANY($1::text[])"], values: unknown[] = [["ADMINISTRATIVO"]];
  appendEntrySearchCondition(conditions, values, "  PROVISÃO 10%_\\ ' OR 1=1 --  ", "history");
  assert.deepEqual(values[1], "%provisao 10\\%\\_\\\\ ' or 1=1 --%");
  assert.ok(conditions[1].includes("COALESCE(l.history, '')"));
  assert.ok(conditions[1].includes("LIKE $2 ESCAPE E'\\\\'"));
  assert.ok(!conditions[1].includes("OR 1=1"));
});

test("entry ID is exact and normalizes zeros without numeric precision loss", () => {
  const conditions: string[] = [], values: unknown[] = [];
  appendEntrySearchCondition(conditions, values, "0009007199254740993", "entry");
  assert.deepEqual(values, ["9007199254740993"]);
  assert.ok(conditions[0].includes("LTRIM(BTRIM(l.entry_number), '0')"));
  assert.ok(conditions[0].includes("= $1"));
  assert.ok(!conditions[0].includes("LIKE"));
  const zeroValues: unknown[] = [];
  appendEntrySearchCondition([], zeroValues, "000", "entry");
  assert.deepEqual(zeroValues, ["0"]);
  const textConditions: string[] = [], textValues: unknown[] = [];
  appendEntrySearchCondition(textConditions, textValues, "AB'_%9", "entry");
  assert.deepEqual(textValues, ["ab'_%9"]);
  assert.equal(textConditions[0], "LOWER(BTRIM(l.entry_number)) = $1");
});

test("amount matches each monetary entry field by absolute exact numeric amount", () => {
  const conditions = ["l.posting_date <= $1::date"], values: unknown[] = ["2026-10-19"];
  appendEntrySearchCondition(conditions, values, "-R$ 1.234,56", "amount");
  assert.deepEqual(values, ["2026-10-19", "1234.56"]);
  for (const column of ["l.debit_amount", "l.credit_amount", "l.credit_amount - l.debit_amount"]) {
    assert.ok(conditions[1].includes(`ABS(${column}) = $2::numeric`));
  }
  assert.ok(!conditions[1].includes("1234"));
});
