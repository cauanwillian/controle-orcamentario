"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExportExcelButton } from "./export-excel-button";
import { buildEntryReport } from "./entry-export";
import type { ExportMetadata } from "./export-report";

export type LedgerEntry = {
  posting_date: string;
  account_code: string;
  account_name: string;
  history: string | null;
  lot_code: string;
  entry_number: string;
  debitAmount: number;
  creditAmount: number;
  realized: number;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const monthLabel = (key: string) => `${shortMonth.format(new Date(`${key}-01T12:00:00Z`)).replace(".", "").toUpperCase()}/${key.slice(0, 4)}`;
const entryCount = (count: number) => `${count.toLocaleString("pt-BR")} lançamento${count === 1 ? "" : "s"}`;

export function EntryMonthList({ entries, exportMetadata = [] }: { entries: LedgerEntry[]; exportMetadata?: ExportMetadata }) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const months = useMemo(() => {
    const grouped = new Map<string, LedgerEntry[]>();
    entries.forEach(entry => {
      const key = entry.posting_date.slice(0, 7);
      const monthEntries = grouped.get(key) ?? [];
      monthEntries.push(entry);
      grouped.set(key, monthEntries);
    });
    return Array.from(grouped.entries()).sort(([left], [right]) => right.localeCompare(left));
  }, [entries]);
  const selectedEntries = months.find(([key]) => key === selectedMonth)?.[1] ?? [];
  const availableDates = useMemo(() => {
    const counts = new Map<string, number>();
    selectedEntries.forEach(entry => counts.set(entry.posting_date, (counts.get(entry.posting_date) ?? 0) + 1));
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [selectedEntries]);
  const hasDateFilter = selectedDates.length > 0;
  const filteredEntries = useMemo(() => {
    if (selectedDates.length === 0) return selectedEntries;
    const includedDates = new Set(selectedDates);
    return selectedEntries.filter(entry => includedDates.has(entry.posting_date));
  }, [selectedEntries, selectedDates]);
  const dates = useMemo(() => {
    const grouped = new Map<string, LedgerEntry[]>();
    filteredEntries.forEach(entry => {
      const dateEntries = grouped.get(entry.posting_date) ?? [];
      dateEntries.push(entry);
      grouped.set(entry.posting_date, dateEntries);
    });
    return Array.from(grouped.entries()).sort(([left], [right]) => right.localeCompare(left));
  }, [filteredEntries]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [selectedDates]);

  useEffect(() => {
    if (!selectedMonth) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [selectedMonth]);

  const close = () => setSelectedMonth(null);
  const account = selectedEntries[0];
  const realized = filteredEntries.reduce((total, entry) => total + entry.realized, 0);

  return <>
    <div className="ledger-date-list budget-ledger-date-list entry-month-list">
      {months.map(([key, monthEntries]) => <button
        className="entry-month-trigger"
        type="button"
        key={key}
        aria-haspopup="dialog"
        aria-label={`Ver ${entryCount(monthEntries.length)} de ${monthLabel(key)}`}
        onClick={event => { triggerRef.current = event.currentTarget; setSelectedDates([]); setSelectedMonth(key); }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2v4M13 2v4M7 11h2M11 11h2M7 14h2" /></svg>
        <span>{monthLabel(key)}</span>
        <small>{entryCount(monthEntries.length)}</small>
        <span className="entry-month-open-hint">Ver lançamentos</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m7 4 6 6-6 6" /></svg>
      </button>)}
    </div>
    {selectedMonth ? createPortal(<dialog
      className="entry-month-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
    >
      <div className="entry-month-dialog-layout">
        <header className="entry-month-dialog-header">
          <div>
            <p className="entry-month-dialog-eyebrow">LANÇAMENTOS POR DATA</p>
            <h2 id={titleId}>{monthLabel(selectedMonth)}</h2>
            <p id={descriptionId} aria-live="polite" aria-atomic="true">{hasDateFilter ? `${filteredEntries.length.toLocaleString("pt-BR")} de ${entryCount(selectedEntries.length)}` : entryCount(selectedEntries.length)} em {dates.length} data{dates.length === 1 ? "" : "s"}</p>
          </div>
          <div className="entry-month-dialog-actions">
          <ExportExcelButton label="Exportar lançamentos" disabled={filteredEntries.length === 0} buildReport={() => buildEntryReport(filteredEntries, selectedMonth, selectedDates, exportMetadata)} />
          <button className="entry-month-close" ref={closeButtonRef} type="button" onClick={close} autoFocus>
            <span>Fechar</span><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
          </div>
        </header>
        <div className="entry-month-dialog-context">
          <div><strong>{account?.account_name || "Conta contábil"}</strong><span>CONTA {account?.account_code || "—"}</span></div>
          <div className="entry-month-total"><span>{hasDateFilter ? "Realizado nos dias selecionados" : "Realizado no mês"}</span><strong className={realized >= 0 ? "positive-text" : "negative-text"}>{money.format(realized)}</strong></div>
        </div>
        <div className="entry-month-date-filter" role="group" aria-labelledby={`${titleId}-filter`}>
          <div className="entry-month-filter-heading">
            <div><span className="entry-month-filter-title" id={`${titleId}-filter`}>Dias com lançamentos</span><p className="entry-month-filter-help" id={`${titleId}-filter-help`}>Clique em um ou mais dias para filtrar.</p></div>
            <button type="button" className="entry-month-all-days" aria-pressed={!hasDateFilter} onClick={() => setSelectedDates([])}>Todos os dias</button>
          </div>
          <div className="entry-month-days" role="group" aria-label={`Dias disponíveis em ${monthLabel(selectedMonth)}`} aria-describedby={`${titleId}-filter-help`}>
            {availableDates.map(([postingDate, count]) => {
              const selected = selectedDates.includes(postingDate);
              const dayLabel = date.format(new Date(`${postingDate}T12:00:00Z`));
              return <button type="button" className="entry-month-day-option" key={postingDate} aria-pressed={selected} aria-label={`Dia ${dayLabel}, ${entryCount(count)}`} title={dayLabel} onClick={() => setSelectedDates(current => current.includes(postingDate) ? current.filter(value => value !== postingDate) : [...current, postingDate])}>
                <span className="entry-month-day-check" aria-hidden="true">{selected ? "✓" : ""}</span><span className="entry-month-day-number">{postingDate.slice(8, 10)}</span><small>{count.toLocaleString("pt-BR")} lanç.</small>
              </button>;
            })}
          </div>
        </div>
        <div className="entry-month-dialog-body" ref={bodyRef} tabIndex={0} role="region" aria-label="Datas e lançamentos do mês">
          {dates.map(([postingDate, dateEntries]) => <section className="entry-day" key={postingDate} aria-labelledby={`${titleId}-${postingDate}`}>
            <div className="entry-day-heading"><h3 id={`${titleId}-${postingDate}`}><time dateTime={postingDate}>{date.format(new Date(`${postingDate}T12:00:00Z`))}</time></h3><span>{entryCount(dateEntries.length)}</span></div>
            <div className="entry-day-scroll" tabIndex={0} role="region" aria-label={`Lançamentos de ${date.format(new Date(`${postingDate}T12:00:00Z`))}`}>
              <table className="entry-day-table">
                <caption className="sr-only">Lançamentos de {date.format(new Date(`${postingDate}T12:00:00Z`))}</caption>
                <thead><tr><th scope="col">Lançamento</th><th scope="col">Histórico</th><th scope="col">Débito</th><th scope="col">Crédito</th><th scope="col">Realizado</th></tr></thead>
                <tbody>{dateEntries.map((entry, index) => <tr key={`${entry.entry_number}-${entry.lot_code}-${index}`}>
                  <td>{entry.entry_number || entry.lot_code || "—"}</td>
                  <td className="entry-day-history">{entry.history || "Sem histórico informado"}</td>
                  <td className={entry.debitAmount > 0 ? "positive-text" : entry.debitAmount < 0 ? "negative-text" : undefined}>{money.format(entry.debitAmount)}</td>
                  <td className={entry.creditAmount > 0 ? "positive-text" : entry.creditAmount < 0 ? "negative-text" : undefined}>{money.format(entry.creditAmount)}</td>
                  <td className={entry.realized >= 0 ? "positive-text" : "negative-text"}>{money.format(entry.realized)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>)}
          {dates.length === 0 ? <p className="entry-month-empty" role="status">{hasDateFilter ? "Nenhum lançamento encontrado nos dias selecionados." : "Nenhum lançamento encontrado neste mês."}</p> : null}
        </div>
        <footer className="entry-month-dialog-footer">Datas da mais recente para a mais antiga. <span>Pressione Esc para fechar.</span></footer>
      </div>
    </dialog>, document.body) : null}
  </>;
}
