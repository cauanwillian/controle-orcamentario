"use client";

import { useEffect, useMemo, useState } from "react";
import "./overview.css";
import "./chart-tooltip.css";
import { LoginSession } from "../login-screen";
import { AppSideNavigation } from "../app-side-navigation";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const fullCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" });

type Row = { label: string; budget: number; actual: number; variation: number; variationPercent: number | null };
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
  const [hovered, setHovered] = useState<{ row: Row; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const headers = { authorization: `Bearer ${session.token}` };
    const query = new URLSearchParams({ year: String(year), dimension: "group" });
    if (pa) query.set("pa", pa);
    if (sector) query.set("sector", sector);
    if (period) query.set("period", period);

    setError(null);
    Promise.all([
      fetch(`${api}/dashboard/overview?${query.toString()}`, { headers }),
      fetch(`${api}/dashboard/ledger-import-status`, { headers }),
    ])
      .then(async ([overview, importStatus]) => {
        if (!overview.ok || !importStatus.ok) throw new Error();
        setData(await overview.json());
        setStatus(await importStatus.json());
      })
      .catch(() => setError("Não foi possível carregar a visão geral com os filtros selecionados."));
  }, [session, year, pa, sector, period]);

  const rows = useMemo(() => data ? [...data.rows].sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation)).slice(0, 6) : [], [data]);
  const maxVariation = Math.max(...rows.map((row) => Math.abs(row.variation)), 1);
  const filterDescription = period
    ? monthOptions(year).find((item) => item.value === period)?.label ?? "Período selecionado"
    : `Acumulado de ${year}`;

  if (!session) return <main className="overview-shell"><section className="overview-empty"><h1>Sessão não encontrada</h1><a href="/">Ir para login</a></section></main>;

  return <main className="overview-shell app-with-sidebar">
    <AppSideNavigation active="overview" />
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
      </section>

      {error ? <p className="overview-error">{error}</p> : null}
      {data ? <>
        <section className="metric-grid">
          <article><span>Orçado acumulado</span><strong>{compactCurrency.format(data.totals.budget)}</strong><small>{filterDescription}</small></article>
          <article><span>Realizado acumulado</span><strong>{compactCurrency.format(data.totals.actual)}</strong><small>Até a data contábil de referência</small></article>
          <article className={data.totals.variation >= 0 ? "positive" : "negative"}><span>Variação</span><strong>{compactCurrency.format(data.totals.variation)}</strong><small>{percent.format(data.totals.variationPercent ?? 0)}</small></article>
          <article><span>Data contábil de referência</span><strong>{date.format(new Date(`${data.reportingDate}T12:00:00Z`))}</strong><small>Última referência processada</small></article>
        </section>

        <section className="deviation-card">
          <header><div><p>ANÁLISE</p><h2>Maiores desvios</h2></div><span>Passe o cursor sobre uma barra para ver o valor.</span></header>
          <div className="deviation-chart">
            <div className="chart-axis"><span>{fullCurrency.format(-maxVariation)}</span><span>R$ 0,00</span><span>{fullCurrency.format(maxVariation)}</span></div>
            <div className="chart-rows">{rows.map((row) => {
              const width = Math.max(2, Math.abs(row.variation) / maxVariation * 50);
              const isPositive = row.variation >= 0;
              return <div className="chart-row" key={row.label}>
                <span className="chart-label" title={row.label}>{row.label}</span>
                <button type="button" className="chart-track" aria-label={`${row.label}: ${fullCurrency.format(row.variation)}`} onMouseEnter={(event) => setHovered({ row, x: event.clientX, y: event.clientY })} onMouseMove={(event) => setHovered({ row, x: event.clientX, y: event.clientY })} onMouseLeave={() => setHovered(null)} onFocus={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHovered({ row, x: box.left + box.width / 2, y: box.top }); }} onBlur={() => setHovered(null)}>
                  <i className="chart-zero" />
                  <b className={isPositive ? "positive" : "negative"} style={isPositive ? { left: "50%", width: `${width}%` } : { left: `${50 - width}%`, width: `${width}%` }} />
                </button>
              </div>;
            })}</div>
            {hovered ? <div className={`chart-tooltip ${hovered.row.variation >= 0 ? "positive" : "negative"}`} style={{ left: `${Math.min(hovered.x + 14, window.innerWidth - 310)}px`, top: `${Math.min(hovered.y + 14, window.innerHeight - 92)}px` }}><strong>{hovered.row.label}</strong><span>Variação: {fullCurrency.format(hovered.row.variation)}</span></div> : null}
          </div>
        </section>

        <section className="overview-table"><header><p>RESUMO POR GRUPO CONTÁBIL</p><h2>Orçado, realizado e variação</h2></header><div><table><thead><tr><th>Grupo contábil</th><th>Orçado</th><th>Realizado</th><th>Variação</th><th>%</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{fullCurrency.format(row.budget)}</td><td>{fullCurrency.format(row.actual)}</td><td className={row.variation >= 0 ? "positive-text" : "negative-text"}>{fullCurrency.format(row.variation)}</td><td className={row.variationPercent !== null && row.variationPercent >= 0 ? "positive-text" : "negative-text"}>{row.variationPercent === null ? "—" : percent.format(row.variationPercent)}</td></tr>)}</tbody></table></div></section>
      </> : <p className="overview-loading">Carregando indicadores…</p>}
    </section>
  </main>;
}
