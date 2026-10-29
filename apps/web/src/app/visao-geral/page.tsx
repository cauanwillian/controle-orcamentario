"use client";

import { useEffect, useState } from "react";
import "./overview.css";
import { LoginSession } from "../login-screen";
import { AppSideNavigation } from "../app-side-navigation";
import { ExportExcelButton } from "../export-excel-button";
import { EntrySearchField } from "../entry-search-field";
import type { EntrySearch } from "../entry-search-field";
import { readDashboardResponse } from "../dashboard-response";
import { makeExportFilename, exportDate } from "../export-report";
import type { ExportReport } from "../export-report";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const fullCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const favorableVariation = (row: Row) => row.variation * (row.variationDirection ?? 1) >= 0;
const searchLabels = { history: "Palavra do histórico", amount: "Valor", entry: "Nº do lançamento" };

type Row = { label: string; budget: number; actual: number; variation: number; variationPercent: number | null; variationDirection?: 1 | -1 };
type Dashboard = { reportingDate: string; totals: { budget: number; actual: number; variation: number; variationPercent: number | null }; rows: Row[] };
type Status = { status: "EM_DIA" | "PENDENTE"; deadline: string; uploadedToday: boolean; expectedReferenceDate: string; latestLedgerDate: string | null };
type FilterOptions = { years: number[]; pas: { code: string; label: string }[]; sectors: string[] };

function monthOptions(year: number) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return { value: `${year}-${month}`, label: `${monthName.format(new Date(Date.UTC(year, index, 1)))} de ${year}` };
  });
}

export default function VisaoGeral() {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ years: [], pas: [], sectors: [] });
  const [year, setYear] = useState(2026);
  const [pa, setPa] = useState("");
  const [sector, setSector] = useState("");
  const [period, setPeriod] = useState("");
  const [entrySearch, setEntrySearch] = useState<EntrySearch>({ term: "", type: "history" });
  const [error, setError] = useState<string | null>(null);
  const [loadedFilterKey, setLoadedFilterKey] = useState<string | null>(null);
  const filterKey = JSON.stringify([year, pa, sector, period, entrySearch.term, entrySearch.type, session?.viewer.employeeCode ?? ""]);

  useEffect(() => {
    const raw = window.localStorage.getItem("orcamento-session");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as LoginSession;
      if (new Date(saved.expiresAt) > new Date()) setSession(saved);
    } catch {
      window.localStorage.removeItem("orcamento-session");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const headers = { authorization: `Bearer ${session.token}` };
    fetch(`${api}/dashboard/filters?year=${year}`, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setOptions(await response.json());
      })
      .catch(() => setError("Não foi possível carregar as opções de filtro."));
  }, [session, year]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let alive = true;
    const requestedFilterKey = filterKey;
    const headers = { authorization: `Bearer ${session.token}` };
    const query = new URLSearchParams({ year: String(year), dimension: "group", reportDimension: "group" });
    if (pa) query.set("pa", pa);
    if (sector) query.set("sector", sector);
    if (period) query.set("period", period);
    if (entrySearch.term) { query.set("search", entrySearch.term); query.set("searchType", entrySearch.type); }

    setError(null);
    setData(null);
    setLoadedFilterKey(null);
    Promise.all([
      fetch(`${api}/dashboard/overview?${query.toString()}`, { headers, signal: controller.signal }),
      fetch(`${api}/dashboard/ledger-import-status`, { headers, signal: controller.signal }),
    ])
      .then(async ([overview, importStatus]) => {
        const [nextData, nextStatus] = await Promise.all([
          readDashboardResponse<Dashboard>(overview, "Não foi possível carregar a visão geral com os filtros selecionados."),
          readDashboardResponse<Status>(importStatus, "Não foi possível verificar a importação do Livro Razão."),
        ]);
        if (!alive) return;
        setData(nextData);
        setStatus(nextStatus);
        setLoadedFilterKey(requestedFilterKey);
      })
      .catch((cause: unknown) => { if (alive && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a visão geral com os filtros selecionados."); });
    return () => { alive = false; controller.abort(); };
  }, [session, year, pa, sector, period, entrySearch, filterKey]);

  const filterDescription = period
    ? monthOptions(year).find((item) => item.value === period)?.label ?? "Período selecionado"
    : `Acumulado de ${year}`;
  const buildOverviewReport = (): ExportReport => {
    if (!data || loadedFilterKey !== filterKey) throw new Error("Aguarde a atualização dos filtros antes de exportar.");
    return {
      fileName: makeExportFilename("visao-geral", String(year), pa ? `pa-${pa}` : "todos-pas", sector || "todos-setores", period || "acumulado"),
      title: "Visão geral por grupo contábil",
      sheetName: "Resumo",
      metadata: [
        ["Ano", year],
        ["PA", pa ? pa.padStart(2, "0") : "Todos os PAs"],
        ["Setor", sector || "Todos os setores"],
        ["Período", period ? `${period.slice(5, 7)}/${period.slice(0, 4)}` : "Acumulado do ano"],
        ["Buscar por", entrySearch.term ? searchLabels[entrySearch.type] : "Sem busca"],
        ["Busca de lançamentos", entrySearch.term || "Todos os lançamentos"],
        ["Percentual de execução", "Realizado / orçado"],
        ["Data contábil de referência", exportDate(data.reportingDate)],
      ],
      columns: [
        { header: "Grupo contábil", width: 48, format: "text" },
        { header: "Orçado", format: "currency" },
        { header: "Realizado", format: "currency" },
        { header: "Variação", format: "currency" },
        { header: "Execução (%)", format: "percent" },
      ],
      rows: data.rows.map(row => [row.label, row.budget, row.actual, row.variation, row.variationPercent]),
      totalRow: ["TOTAL", data.totals.budget, data.totals.actual, data.totals.variation, data.totals.variationPercent],
    };
  };

  if (!session) return <main className="overview-shell"><section className="overview-empty"><h1>Sessão não encontrada</h1><a href="/">Ir para login</a></section></main>;

  return <><AppSideNavigation active="overview" /><main className="overview-shell app-with-top-navigation">
    <section className="overview-page">
      <header className="overview-header">
        <div><p>CONTROLE ORÇAMENTÁRIO</p><h1>Visão geral</h1><span>Acompanhamento consolidado de orçado x realizado da cooperativa.</span></div>
        <a href="/">Abrir análises</a>
      </header>

      {status ? <section className={`ledger-status ${status.status === "EM_DIA" ? "ok" : "pending"}`}>
        <strong>{status.status === "EM_DIA" ? "✓ Livro Razão recebido hoje" : "! Livro Razão pendente"}</strong>
        <span>{status.status === "EM_DIA" ? `Referência contábil: ${status.latestLedgerDate ? date.format(new Date(`${status.latestLedgerDate}T12:00:00Z`)) : "—"}` : `Envie o arquivo até ${status.deadline}. Referência esperada: ${date.format(new Date(`${status.expectedReferenceDate}T12:00:00Z`))}.`}</span>
      </section> : null}

      <section className="overview-filters" aria-label="Filtros da visão geral">
        <label>Ano<select value={year} onChange={(event) => { setYear(Number(event.target.value)); setPeriod(""); }}>
          {(options.years.length ? options.years : [year]).map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label>PA<select value={pa} onChange={(event) => setPa(event.target.value)}><option value="">Todos os PAs</option>{options.pas.map((item) => <option key={item.code} value={item.code}>{item.code}{item.label ? ` — ${item.label}` : ""}</option>)}</select></label>
        <label>Setor<select value={sector} onChange={(event) => setSector(event.target.value)}><option value="">Todos os setores</option>{options.sectors.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Período<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="">Acumulado do ano</option>{monthOptions(year).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <EntrySearchField value={entrySearch} onSearch={setEntrySearch} />
      </section>
      {entrySearch.term ? <p className="entry-search-note" role="status">{searchLabels[entrySearch.type]}: “{entrySearch.term}”.{entrySearch.type === "amount" ? " Busca no débito, crédito ou realizado, sem considerar o sinal." : ""} O orçado corresponde às contas dos lançamentos encontrados.</p> : null}
      {data?.rows.length === 0 ? <p className="overview-loading" role="status">Nenhum lançamento encontrado para os filtros selecionados.</p> : null}

      {error ? <p className="overview-error">{error}</p> : null}
      {data ? <>
        <section className="metric-grid">
          <article><span>Orçado acumulado</span><strong>{compactCurrency.format(data.totals.budget)}</strong><small>{filterDescription}</small></article>
          <article><span>Realizado acumulado</span><strong>{compactCurrency.format(data.totals.actual)}</strong><small>Até a data contábil de referência</small></article>
          <article className={data.totals.variation >= 0 ? "positive" : "negative"}><span>Variação</span><strong>{compactCurrency.format(data.totals.variation)}</strong><small>{data.totals.variationPercent === null ? "Sem orçamento no período" : `Execução: ${percent.format(data.totals.variationPercent)} do orçado`}</small></article>
          <article><span>Data contábil de referência</span><strong>{date.format(new Date(`${data.reportingDate}T12:00:00Z`))}</strong><small>Data de corte dos valores</small></article>
        </section>

        <section className="overview-table"><header className="export-section-header"><div><p>RESUMO POR GRUPO CONTÁBIL</p><h2>Orçado, realizado e variação</h2></div><ExportExcelButton buildReport={buildOverviewReport} disabled={loadedFilterKey !== filterKey || data.rows.length === 0} /></header><div><table><thead><tr><th>Grupo contábil</th><th>Orçado</th><th>Realizado</th><th>Variação</th><th title="Realizado / orçado">Execução</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{fullCurrency.format(row.budget)}</td><td>{fullCurrency.format(row.actual)}</td><td className={favorableVariation(row) ? "positive-text" : "negative-text"}>{fullCurrency.format(row.variation)}</td><td className={favorableVariation(row) ? "positive-text" : "negative-text"}>{row.variationPercent === null ? "—" : percent.format(row.variationPercent)}</td></tr>)}</tbody></table></div></section>
      </> : !error ? <p className="overview-loading">Carregando indicadores…</p> : null}
    </section>
  </main></>;
}
