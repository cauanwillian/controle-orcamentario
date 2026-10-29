"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./entry-search-field.css";

export type EntrySearchType = "history" | "amount" | "entry";
export type EntrySearch = { term: string; type: EntrySearchType };

type EntrySearchFieldProps = {
  value: EntrySearch;
  onSearch: (value: EntrySearch) => void;
};

const placeholders: Record<EntrySearchType, string> = {
  history: "Ex.: água, aluguel, fornecedor",
  amount: "Ex.: 1.234,56",
  entry: "Ex.: 0000000227",
};

export function EntrySearchField({ value, onSearch }: EntrySearchFieldProps) {
  const inputId = useId();
  const modeId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value.term);
  const [type, setType] = useState<EntrySearchType>(value.type);

  useEffect(() => {
    setDraft(value.term);
    setType(value.type);
  }, [value.term, value.type]);

  return <form className="entry-search-filter" role="search" aria-label="Buscar lançamentos" onSubmit={(event) => {
    event.preventDefault();
    const term = draft.trim();
    setDraft(term);
    onSearch({ term, type });
  }}>
    <span className="entry-search-title">Buscar lançamentos</span>
    <div className="entry-search-controls">
      <label className="entry-search-hidden-label" htmlFor={modeId}>Buscar por</label>
      <select id={modeId} className="entry-search-mode" value={type} onChange={(event) => {
        setType(event.target.value as EntrySearchType);
        setDraft("");
      }}>
        <option value="history">Palavra do histórico</option>
        <option value="amount">Valor</option>
        <option value="entry">Nº do lançamento</option>
      </select>
      <div className="entry-search-input-wrap">
        <label className="entry-search-hidden-label" htmlFor={inputId}>Busca de lançamentos</label>
        <input ref={inputRef} id={inputId} className="entry-search-input" type="search" maxLength={200}
          inputMode={type === "amount" ? "decimal" : type === "entry" ? "numeric" : "text"}
          autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholders[type]} />
        {draft || value.term ? <button type="button" className="entry-search-clear" aria-label="Limpar busca de lançamentos" onClick={() => {
          setDraft("");
          onSearch({ term: "", type });
          inputRef.current?.focus();
        }}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button> : null}
      </div>
      <button className="entry-search-submit" type="submit"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>Buscar</button>
    </div>
  </form>;
}
