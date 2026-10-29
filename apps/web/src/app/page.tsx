"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./globals.css";
import "./profile.css";
import "./monthly-table.css";
import "./main-monthly-table.css";
import "./overview-states.css";
import "./budget-table.css";
import "./ledger-detail.css";
import "./group-ledger-detail.css";
import "./ledger-group-hierarchy.css";
import "./entry-month-list.css";
import "./export-excel-button.css";
import "./entry-search-field.css";
import { LoginScreen, LoginSession } from "./login-screen";
import { AppSideNavigation } from "./app-side-navigation";
import { EntryMonthList } from "./entry-month-list";
import type { LedgerEntry as Entry } from "./entry-month-list";
import { ExportExcelButton } from "./export-excel-button";
import { EntrySearchField } from "./entry-search-field";
import type { EntrySearchType } from "./entry-search-field";
import { readDashboardResponse } from "./dashboard-response";
import { buildDashboardReport } from "./dashboard-export";
import { budgetMetrics, ledgerMetrics, variationTone } from "./report-metrics";
import type { ReportMonthlyValue } from "./report-metrics";
import { exportDate } from "./export-report";
import type { ExportMetadata } from "./export-report";

type Value = ReportMonthlyValue;
type Row = { label: string; values: Value[]; budget: number; actual: number; variation: number; variationPercent: number | null; variationDirection?: 1 | -1 };
type Dashboard = { year: number; dimension: string; filters: { paCode?: string; sectorName?: string; period?: string; accountSearch?: string; entrySearch?: string; entrySearchType?: EntrySearchType; ledgerOnly?: boolean }; reportingDate: string; latestLedgerDate: string | null; totals: { budget: number; actual: number; variation: number; variationPercent: number | null }; months: string[]; monthlyTotals?: Value[]; rows: Row[]; viewer: { employeeName: string; roles: string[]; fullAccess: boolean } };
type Filters = { pa: string; sector: string; period: string; account: string; search: string; searchType: EntrySearchType };
type Options = { years: number[]; pas: { code: string; label: string }[]; sectors: string[] };
type Ledger = { sectorName: string; reportingDate: string; total: number; pas: { paCode: string; total: number; realized: number }[]; entries: Entry[] };
type View = "budget-group" | "budget-sector" | "ledger-group" | "ledger-sector";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const dateText = (v: string | null) => v ? date.format(new Date(`${v}T12:00:00Z`)) : "—";
const pct = (v: number | null) => v === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 }).format(v);
const paText = (value: string) => /^\d+$/.test(value) ? value.padStart(2, "0") : value;
const searchLabels: Record<EntrySearchType, string> = { history: "Palavra do histórico", amount: "Valor", entry: "Nº do lançamento" };
const views: { id: View; label: string }[] = [{ id: "budget-group", label: "GRUPOS - ORÇAMENTOS" }, { id: "budget-sector", label: "SETORES - ORÇAMENTOS" }, { id: "ledger-group", label: "GRUPOS - RAZÃO" }, { id: "ledger-sector", label: "SETORES - RAZÃO" }];

export default function Home() {
  const [view, setView] = useState<View>("budget-group"), [year, setYear] = useState(2026);
  const [session, setSession] = useState<LoginSession | null>(null);
  const [options, setOptions] = useState<Options>({ years: [2026], pas: [], sectors: [] });
  const [filters, setFilters] = useState<Filters>({ pa: "", sector: "", period: "", account: "", search: "", searchType: "history" }), [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRequestKey, setOverviewRequestKey] = useState(0);
  const [sector, setSector] = useState<string | null>(null), [ledger, setLedger] = useState<Ledger | null>(null), [loadingLedger, setLoadingLedger] = useState(false), [activePa, setActivePa] = useState<string | null>(null), [entries, setEntries] = useState<Entry[]>([]), [loadingPa, setLoadingPa] = useState(false), [budgetSectorPas, setBudgetSectorPas] = useState<Dashboard | null>(null), [budgetSectorPa, setBudgetSectorPa] = useState<string | null>(null), [budgetSectorAccounts, setBudgetSectorAccounts] = useState<Dashboard | null>(null), [loadingBudgetSector, setLoadingBudgetSector] = useState(false), [loadingBudgetSectorAccounts, setLoadingBudgetSectorAccounts] = useState(false);
  const [budgetSectorGroup, setBudgetSectorGroup] = useState<string | null>(null);
  const [budgetSectorSubgroup, setBudgetSectorSubgroup] = useState<string | null>(null);
  const [budgetSectorSubgroups, setBudgetSectorSubgroups] = useState<Record<string, Dashboard>>({});
  const [budgetSectorPasBySubgroup, setBudgetSectorPasBySubgroup] = useState<Record<string, Dashboard>>({});
  const [loadingBudgetSectorGroups, setLoadingBudgetSectorGroups] = useState(false);
  const [loadingBudgetSectorSubgroups, setLoadingBudgetSectorSubgroups] = useState(false);
  const [budgetSectorAccount, setBudgetSectorAccount] = useState<string | null>(null);
  const [budgetSectorEntries, setBudgetSectorEntries] = useState<Entry[]>([]);
  const [loadingBudgetSectorEntries, setLoadingBudgetSectorEntries] = useState(false);
  const [ledgerSectorGroups, setLedgerSectorGroups] = useState<Dashboard | null>(null);
  const [ledgerSectorGroup, setLedgerSectorGroup] = useState<string | null>(null);
  const [ledgerSectorSubgroup, setLedgerSectorSubgroup] = useState<string | null>(null);
  const [ledgerSectorSubgroups, setLedgerSectorSubgroups] = useState<Record<string, Dashboard>>({});
  const [ledgerSectorPasBySubgroup, setLedgerSectorPasBySubgroup] = useState<Record<string, Dashboard>>({});
  const [ledgerSectorPa, setLedgerSectorPa] = useState<string | null>(null);
  const [ledgerSectorAccounts, setLedgerSectorAccounts] = useState<Dashboard | null>(null);
  const [ledgerSectorAccount, setLedgerSectorAccount] = useState<string | null>(null);
  const [ledgerSectorEntries, setLedgerSectorEntries] = useState<Entry[]>([]);
  const [loadingLedgerSectorGroups, setLoadingLedgerSectorGroups] = useState(false);
  const [loadingLedgerSectorSubgroups, setLoadingLedgerSectorSubgroups] = useState(false);
  const [loadingLedgerSectorAccounts, setLoadingLedgerSectorAccounts] = useState(false);
  const [loadingLedgerSectorEntries, setLoadingLedgerSectorEntries] = useState(false);
  const [ledgerGroupPasBySubgroup, setLedgerGroupPasBySubgroup] = useState<Record<string, Dashboard>>({});
  const detailRequestVersion = useRef(0);
  const beginDetailRequest = () => ++detailRequestVersion.current;
  const isCurrentDetailRequest = (version: number) => version === detailRequestVersion.current;
  const resetDetailLoading = () => { setLoadingLedger(false); setLoadingPa(false); setLoadingBudgetSector(false); setLoadingBudgetSectorAccounts(false); setLoadingBudgetSectorGroups(false); setLoadingBudgetSectorSubgroups(false); setLoadingGroup(false); setLoadingSubgroup(false); setLoadingGroupPa(false); setLoadingGroupEntries(false); setLoadingBudgetGroupPas(false); setLoadingLedgerSectorGroups(false); setLoadingLedgerSectorSubgroups(false); setLoadingLedgerSectorAccounts(false); setLoadingLedgerSectorEntries(false); };
  const [group, setGroup] = useState<string | null>(null), [accounts, setAccounts] = useState<Dashboard | null>(null), [loadingGroup, setLoadingGroup] = useState(false), [subgroup, setSubgroup] = useState<string | null>(null), [subgroupAccounts, setSubgroupAccounts] = useState<Dashboard | null>(null), [loadingSubgroup, setLoadingSubgroup] = useState(false), [groupPa, setGroupPa] = useState<string | null>(null), [groupPaAccounts, setGroupPaAccounts] = useState<Dashboard | null>(null), [loadingGroupPa, setLoadingGroupPa] = useState(false), [groupAccount, setGroupAccount] = useState<string | null>(null), [groupEntries, setGroupEntries] = useState<Entry[]>([]), [loadingGroupEntries, setLoadingGroupEntries] = useState(false), [budgetGroupPas, setBudgetGroupPas] = useState<Record<string, Dashboard>>({}), [loadingBudgetGroupPas, setLoadingBudgetGroupPas] = useState(false);
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("view"); if (requested === "budget-group" || requested === "budget-sector" || requested === "ledger-group" || requested === "ledger-sector") setView(requested); }, []);
  const isBudget = view.startsWith("budget"), dimension = view.endsWith("group") ? "group" : "sector", label = dimension === "group" ? "Grupo contábil" : "Setor";
  const exportTitle = `${isBudget ? "Orçamento" : "Razão"} por ${dimension === "group" ? "grupos" : "setores"}`;
  const overviewMatchesFilters = Boolean(data && data.year === year && data.dimension === dimension && Boolean(data.filters?.ledgerOnly) === !isBudget && (data.filters?.paCode ?? "") === filters.pa && (data.filters?.sectorName ?? "") === filters.sector && (data.filters?.period ?? "") === filters.period && (data.filters?.accountSearch ?? "") === filters.account && (data.filters?.entrySearch ?? "") === filters.search && (!filters.search || data.filters?.entrySearchType === filters.searchType));
  const reportMetadata: ExportMetadata = [["Aba", exportTitle], ["Ano", year], ["PA", filters.pa ? paText(filters.pa) : "Todos os PAs"], ["Setor", filters.sector || "Todos os setores"], ["Período", filters.period ? `${filters.period.slice(5, 7)}/${year}` : `Acumulado de ${year}`], ["Busca por conta", filters.account || "Todas as contas"], ["Buscar por", filters.search ? searchLabels[filters.searchType] : "Sem busca"], ["Busca de lançamentos", filters.search || "Todos os lançamentos"], ["Data contábil de referência", exportDate(data?.reportingDate ?? null)]];
  const clearDetails = () => { beginDetailRequest(); resetDetailLoading(); setSector(null); setLedger(null); setActivePa(null); setEntries([]); setBudgetSectorPas(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorGroup(null); setBudgetSectorSubgroup(null); setBudgetSectorSubgroups({}); setBudgetSectorPasBySubgroup({}); setBudgetSectorAccount(null); setBudgetSectorEntries([]); setLedgerSectorGroups(null); setLedgerSectorGroup(null); setLedgerSectorSubgroup(null); setLedgerSectorSubgroups({}); setLedgerSectorPasBySubgroup({}); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); setGroup(null); setAccounts(null); setSubgroup(null); setSubgroupAccounts(null); setLedgerGroupPasBySubgroup({}); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); };
  const params = (extra: Record<string, string> = {}) => { const q = new URLSearchParams({ year: String(year), employee: session?.viewer.employeeCode ?? "", ...extra }); if (filters.pa && !q.has("pa")) q.set("pa", filters.pa); if (filters.sector && !q.has("sector")) q.set("sector", filters.sector); if (filters.period && !q.has("period")) q.set("period", filters.period); if (filters.account && !q.has("account")) q.set("account", filters.account); if (filters.search && !q.has("search")) { q.set("search", filters.search); q.set("searchType", filters.searchType); } q.set("reportDimension", dimension); return q; };
  useEffect(() => { const raw = window.localStorage.getItem("orcamento-session"); if (!raw) return; try { const saved = JSON.parse(raw) as LoginSession; if (new Date(saved.expiresAt) > new Date()) setSession(saved); else window.localStorage.removeItem("orcamento-session"); } catch { window.localStorage.removeItem("orcamento-session"); } }, []);
  useEffect(() => { if (!session) return; const originalFetch = window.fetch.bind(window); window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(); if (!url.startsWith(api)) return originalFetch(input, init); const headers = new Headers(init?.headers); headers.set("authorization", `Bearer ${session.token}`); return originalFetch(input, { ...init, headers }); }) as typeof window.fetch; return () => { window.fetch = originalFetch; }; }, [session]);
  useEffect(() => { if (!session) return; let alive = true; const noticeId = "ledger-import-status-notice"; fetch(`${api}/dashboard/ledger-import-status`, { headers: { authorization: `Bearer ${session.token}` } }).then((response) => response.ok ? response.json() : Promise.reject()).then((status: { status: "EM_DIA" | "PENDENTE"; deadline: string; uploadedToday: boolean; uploadedAt: string | null; expectedReferenceDate: string; latestLedgerDate: string | null }) => { if (!alive) return; const host = document.querySelector(".dashboard-heading"); if (!host) return; document.getElementById(noticeId)?.remove(); const notice = document.createElement("p"); notice.id = noticeId; notice.className = `ledger-import-notice ${status.status === "EM_DIA" ? "ok" : "pending"}`; const reference = status.latestLedgerDate ? dateText(status.latestLedgerDate) : "não encontrada"; notice.textContent = status.status === "EM_DIA" ? `Livro Razão recebido hoje. Referência contábil: ${reference}.` : `Livro Razão pendente: envie o arquivo até ${status.deadline}. Referência esperada: ${dateText(status.expectedReferenceDate)}; encontrada: ${reference}.`; host.prepend(notice); }).catch(() => undefined); return () => { alive = false; document.getElementById(noticeId)?.remove(); }; }, [session]);
  useEffect(() => { if (!session) return; fetch(`${api}/dashboard/filters?year=${year}&employee=${session.viewer.employeeCode}`).then(r => r.ok ? r.json() : Promise.reject()).then((next) => { if (!Array.isArray(next?.pas) || !Array.isArray(next?.sectors) || !Array.isArray(next?.years)) throw new Error("Opções inválidas"); setOptions(next); }).catch(() => { setError("Não foi possível carregar os filtros deste perfil."); setOptions({ years: [year], pas: [], sectors: [] }); }); }, [year, session]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let alive = true;
    clearDetails();
    setData(null);
    setOverviewError(null);
    setLoadingOverview(true);
    fetch(`${api}/dashboard/overview?${params({ dimension, ledgerOnly: isBudget ? "false" : "true" })}`, { signal: controller.signal })
      .then(response => readDashboardResponse<Dashboard>(response, "Não foi possível atualizar o painel agora."))
      .then(payload => { if (alive) setData(payload); })
      .catch((cause: unknown) => { if (alive && !controller.signal.aborted) setOverviewError(cause instanceof Error ? cause.message : "Não foi possível atualizar o painel agora."); })
      .finally(() => { if (alive) setLoadingOverview(false); });
    return () => { alive = false; controller.abort(); };
  }, [view, filters, year, session, overviewRequestKey]);
  useEffect(() => {
    if (!isBudget || !group || !accounts || !session) { setBudgetGroupPas({}); return; }
    setBudgetGroupPas({});
    setSubgroup(null);
    setGroupPa(null);
    setGroupPaAccounts(null);
  }, [isBudget, group, accounts, year, filters, session]);
  useEffect(() => {
    const selectors = ".monthly-table > tbody > tr:not(.inline-ledger-row) > td, .group-detail-table > tbody > tr > td:not(:first-child), .pa-leaf strong, .account-code strong, .pa-trigger strong, .inline-entries-scroll td:nth-last-child(-n + 3)";
    document.querySelectorAll<HTMLElement>(selectors).forEach((cell) => {
      if (cell.hasAttribute("data-variation-tone")) return;
      const raw = cell.textContent?.trim() ?? "";
      const numeric = Number(raw.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
      cell.classList.remove("positive-text", "negative-text");
      if (Number.isFinite(numeric) && numeric !== 0) cell.classList.add(numeric > 0 ? "positive-text" : "negative-text");
    });
  }, [data, accounts, subgroupAccounts, groupPaAccounts, ledger, entries, budgetSectorAccounts, budgetSectorEntries, ledgerSectorGroups, ledgerSectorSubgroups, ledgerSectorPasBySubgroup, ledgerSectorAccounts, ledgerSectorEntries, view]);
  useEffect(() => {
    const paSelect = document.querySelector<HTMLSelectElement>(".filters label:nth-child(2) select");
    paSelect?.querySelectorAll("option").forEach((option) => {
      const [code, ...description] = (option.textContent ?? "").split(" — ");
      if (/^\d+$/.test(code)) option.textContent = `${paText(code)} — ${description.join(" — ")}`;
    });
  }, [options]);
  const openGroup = (name: string) => {
    const requestVersion = beginDetailRequest();
    if (group === name) { clearDetails(); return; }
    setGroup(name); setAccounts(null); setSubgroup(null); setSubgroupAccounts(null); setLedgerGroupPasBySubgroup({}); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); resetDetailLoading(); setLoadingGroup(true);
    const detailDimension = "subgroup";
    fetch(`${api}/dashboard/overview?${params({ dimension: detailDimension, group: name, ledgerOnly: isBudget ? "false" : "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setAccounts(payload); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os subgrupos."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroup(false); });
  };
  const openSubgroup = (name: string) => { if (!group) return; if (subgroup === name) { setSubgroup(null); setSubgroupAccounts(null); setGroupPa(null); setGroupPaAccounts(null); return; } setSubgroup(name); setSubgroupAccounts(null); setGroupPa(null); setGroupPaAccounts(null); setLoadingSubgroup(true); fetch(`${api}/dashboard/overview?${params({ dimension: "pa", group, subgroup: name })}`).then(r => r.ok ? r.json() : Promise.reject()).then(setSubgroupAccounts).catch(() => setError("Não foi possível carregar as PAs do subgrupo.")).finally(() => setLoadingSubgroup(false)); };
  const openGroupPa = (pa: string) => { if (!group || !subgroup) return; if (groupPa === pa) { setGroupPa(null); setGroupPaAccounts(null); return; } setGroupPa(pa); setGroupPaAccounts(null); setLoadingGroupPa(true); fetch(`${api}/dashboard/overview?${params({ dimension: "account", group, subgroup, pa })}`).then(r => r.ok ? r.json() : Promise.reject()).then(setGroupPaAccounts).catch(() => setError("Não foi possível carregar as contas da PA.")).finally(() => setLoadingGroupPa(false)); };
  const openBudgetGroupSubgroup = (subgroupName: string) => {
    if (!group) return;
    const requestVersion = beginDetailRequest();
    if (subgroup === subgroupName) { setSubgroup(null); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); return; }
    setSubgroup(subgroupName); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]);
    if (budgetGroupPas[subgroupName]) return;
    setLoadingBudgetGroupPas(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "pa", group, subgroup: subgroupName })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setBudgetGroupPas(current => ({ ...current, [subgroupName]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as PAs do subgrupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetGroupPas(false); });
  };
  const openBudgetGroupPa = (subgroupName: string, pa: string) => {
    if (!group) return;
    const requestVersion = beginDetailRequest();
    if (subgroup === subgroupName && groupPa === pa) { setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); return; }
    setSubgroup(subgroupName); setGroupPa(pa); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); setLoadingGroupPa(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "account", group, subgroup: subgroupName, pa })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setGroupPaAccounts(payload); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as contas da PA."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroupPa(false); });
  };
  const resetLedgerGroupBranchLoading = () => { setLoadingSubgroup(false); setLoadingGroupPa(false); setLoadingGroupEntries(false); };
  const openLedgerGroupSubgroup = (subgroupName: string) => {
    if (!group) return;
    const requestVersion = beginDetailRequest();
    resetLedgerGroupBranchLoading();
    setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]);
    if (subgroup === subgroupName) { setSubgroup(null); return; }
    setSubgroup(subgroupName);
    if (ledgerGroupPasBySubgroup[subgroupName]) return;
    setLoadingSubgroup(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "pa", group, subgroup: subgroupName, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setLedgerGroupPasBySubgroup(current => ({ ...current, [subgroupName]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as PAs do subgrupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingSubgroup(false); });
  };
  const openLedgerGroupPa = (pa: string, subgroupName = subgroup) => {
    if (!group || !subgroupName) return;
    const requestVersion = beginDetailRequest();
    resetLedgerGroupBranchLoading();
    if (subgroup === subgroupName && groupPa === pa) { setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); return; }
    setSubgroup(subgroupName); setGroupPa(pa); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); setLoadingGroupPa(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "account", group, subgroup: subgroupName, pa, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setGroupPaAccounts(payload); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as contas da PA."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroupPa(false); });
  };
  const openLedgerGroupAccount = (code: string) => {
    if (!group || !groupPa || !subgroup) return;
    const requestVersion = beginDetailRequest();
    if (!isBudget) resetLedgerGroupBranchLoading();
    if (groupAccount === code) { setGroupAccount(null); setGroupEntries([]); return; }
    setGroupAccount(code); setGroupEntries([]); setLoadingGroupEntries(true);
    fetch(`${api}/dashboard/group-ledger?${params({ group, subgroup, pa: groupPa, account: code })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((result: { entries: Entry[] }) => { if (isCurrentDetailRequest(requestVersion)) setGroupEntries(result.entries); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os lançamentos da conta."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroupEntries(false); });
  };
  const consolidateDashboardRows = (dashboard: Dashboard): Dashboard => {
    const grouped = new Map<string, Row>();
    const ledgerOnly = Boolean(dashboard.filters?.ledgerOnly);
    dashboard.rows.forEach(sourceRow => {
      const key = sourceRow.label.trim();
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...sourceRow, label: key, values: sourceRow.values.map(value => ({ ...value })) });
        return;
      }
      const mergedValues = existing.values.map((value, index) => {
        const incoming = sourceRow.values.find(item => item.month === value.month);
        if (!incoming) return { ...value };
        const leftMetrics = ledgerOnly ? ledgerMetrics(value, index, existing.values) : budgetMetrics(value);
        const rightMetrics = ledgerOnly ? ledgerMetrics(incoming, index, sourceRow.values) : budgetMetrics(incoming);
        const previousActual = ledgerOnly ? ledgerMetrics(value, index, existing.values).previousActual + ledgerMetrics(incoming, index, sourceRow.values).previousActual : undefined;
        return { ...value, budget: value.budget + incoming.budget, actual: value.actual + incoming.actual, previousActual,
          variation: leftMetrics.variation + rightMetrics.variation, variationPercent: undefined,
          hasActual: value.hasActual !== false || incoming.hasActual !== false,
          hasBudget: value.hasBudget !== false || incoming.hasBudget !== false };
      });
      existing.values = mergedValues.map((value, index) => ({ ...value, variationPercent: (ledgerOnly ? ledgerMetrics(value, index, mergedValues) : budgetMetrics(value)).variationPercent }));
      existing.budget += sourceRow.budget;
      existing.actual += sourceRow.actual;
      existing.variation += sourceRow.variation;
      const previousActual = ledgerOnly ? existing.values.reduce((total, value, index) => total + ledgerMetrics(value, index, existing.values).previousActual, 0) : 0;
      existing.variationPercent = ledgerOnly ? (previousActual === 0 ? 0 : existing.variation / Math.abs(previousActual)) : existing.budget === 0 ? (existing.actual === 0 ? null : 0) : existing.actual / existing.budget;
    });
    return { ...dashboard, rows: [...grouped.values()] };
  };
  const openSector = (name: string) => {
    if (sector === name) { clearDetails(); return; }
    const requestVersion = beginDetailRequest();
    setSector(name); setLedger(null); setActivePa(null); setEntries([]); setAccounts(null);
    setBudgetSectorPas(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorGroup(null); setBudgetSectorSubgroup(null); setBudgetSectorSubgroups({}); setBudgetSectorPasBySubgroup({}); setBudgetSectorAccount(null); setBudgetSectorEntries([]);
    setLedgerSectorGroups(null); setLedgerSectorGroup(null); setLedgerSectorSubgroup(null); setLedgerSectorSubgroups({}); setLedgerSectorPasBySubgroup({}); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]);
    if (isBudget) {
      setLoadingBudgetSector(true);
      fetch(`${api}/dashboard/overview?${params({ dimension: "group", sector: name })}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(payload => { if (isCurrentDetailRequest(requestVersion)) setBudgetSectorPas(consolidateDashboardRows(payload)); })
        .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os grupos do setor."); })
        .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetSector(false); });
      return;
    }
    setLoadingLedger(true);
    Promise.all([
      fetch(`${api}/dashboard/ledger?${params({ sector: name })}`).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`${api}/dashboard/overview?${params({ dimension: "group", sector: name, ledgerOnly: "true" })}`).then(r => r.ok ? r.json() : Promise.reject())
    ]).then(([ledgerPayload, groupPayload]) => { if (isCurrentDetailRequest(requestVersion)) { setLedger(ledgerPayload); setLedgerSectorGroups(consolidateDashboardRows(groupPayload)); } }).catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os grupos do setor."); }).finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingLedger(false); });
  };
  const openPa = (pa: string) => { if (!sector) return; if (activePa === pa) { setActivePa(null); setEntries([]); return; } setActivePa(pa); setEntries([]); setLoadingPa(true); fetch(`${api}/dashboard/ledger?${params({ sector, pa })}`).then(r => r.ok ? r.json() : Promise.reject()).then((x: Ledger) => setEntries(x.entries)).catch(() => setError("Não foi possível carregar os lançamentos da PA.")).finally(() => setLoadingPa(false)); };
  const openBudgetSectorPa = (pa: string) => { if (!sector) return; if (budgetSectorPa === pa) { setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); return; } setBudgetSectorPa(pa); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); setLoadingBudgetSectorAccounts(true); fetch(`${api}/dashboard/overview?${params({ dimension: "account", sector, pa })}`).then(r => r.ok ? r.json() : Promise.reject()).then(setBudgetSectorAccounts).catch(() => setError("Não foi possível carregar as contas da PA.")).finally(() => setLoadingBudgetSectorAccounts(false)); };
  const openBudgetSectorGroup = (name: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    if (budgetSectorGroup === name) { setBudgetSectorGroup(null); setBudgetSectorSubgroup(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); return; }
    setBudgetSectorGroup(name); setBudgetSectorSubgroup(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]);
    if (budgetSectorSubgroups[name]) return;
    setLoadingBudgetSectorGroups(true);
    fetch(api + "/dashboard/overview?" + params({ dimension: "subgroup", sector, group: name }))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setBudgetSectorSubgroups(current => ({ ...current, [name]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os subgrupos do grupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetSectorGroups(false); });
  };
  const openBudgetSectorSubgroup = (groupName: string, name: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = groupName + "|" + name;
    if (budgetSectorSubgroup === key) { setBudgetSectorSubgroup(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); return; }
    setBudgetSectorSubgroup(key); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]);
    if (budgetSectorPasBySubgroup[key]) return;
    setLoadingBudgetSectorSubgroups(true);
    fetch(api + "/dashboard/overview?" + params({ dimension: "pa", sector, group: groupName, subgroup: name }))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setBudgetSectorPasBySubgroup(current => ({ ...current, [key]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as PAs do subgrupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetSectorSubgroups(false); });
  };
  const openBudgetSectorHierarchyPa = (groupName: string, subgroupName: string, pa: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = groupName + "|" + subgroupName + "|" + pa;
    if (budgetSectorPa === key) { setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); return; }
    setBudgetSectorPa(key); setBudgetSectorAccounts(null); setBudgetSectorAccount(null); setBudgetSectorEntries([]); setLoadingBudgetSectorAccounts(true);
    fetch(api + "/dashboard/overview?" + params({ dimension: "account", sector, group: groupName, subgroup: subgroupName, pa }))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setBudgetSectorAccounts(consolidateDashboardRows(payload)); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as contas da PA."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetSectorAccounts(false); });
  };
  const openBudgetSectorAccount = (groupName: string, subgroupName: string, pa: string, code: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = [groupName, subgroupName, pa, code].join("|");
    if (budgetSectorAccount === key) { setBudgetSectorAccount(null); setBudgetSectorEntries([]); return; }
    setBudgetSectorAccount(key); setBudgetSectorEntries([]); setLoadingBudgetSectorEntries(true);
    fetch(`${api}/dashboard/group-ledger?${params({ sector, group: groupName, subgroup: subgroupName, pa, account: code })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((result: { entries: Entry[] }) => { if (isCurrentDetailRequest(requestVersion)) setBudgetSectorEntries(result.entries); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os lançamentos da conta."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingBudgetSectorEntries(false); });
  };
  const openLedgerSectorGroup = (name: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    if (ledgerSectorGroup === name) { setLedgerSectorGroup(null); setLedgerSectorSubgroup(null); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); return; }
    setLedgerSectorGroup(name); setLedgerSectorSubgroup(null); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]);
    if (ledgerSectorSubgroups[name]) return;
    setLoadingLedgerSectorGroups(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "subgroup", sector, group: name, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setLedgerSectorSubgroups(current => ({ ...current, [name]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os subgrupos do grupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingLedgerSectorGroups(false); });
  };
  const openLedgerSectorSubgroup = (groupName: string, name: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = [groupName, name].join("|");
    if (ledgerSectorSubgroup === key) { setLedgerSectorSubgroup(null); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); return; }
    setLedgerSectorSubgroup(key); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]);
    if (ledgerSectorPasBySubgroup[key]) return;
    setLoadingLedgerSectorSubgroups(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "pa", sector, group: groupName, subgroup: name, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setLedgerSectorPasBySubgroup(current => ({ ...current, [key]: consolidateDashboardRows(payload) })); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as PAs do subgrupo."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingLedgerSectorSubgroups(false); });
  };
  const openLedgerSectorPa = (groupName: string, subgroupName: string, pa: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = [groupName, subgroupName, pa].join("|");
    if (ledgerSectorPa === key) { setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); return; }
    setLedgerSectorPa(key); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); setLoadingLedgerSectorAccounts(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "account", sector, group: groupName, subgroup: subgroupName, pa, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setLedgerSectorAccounts(consolidateDashboardRows(payload)); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as contas da PA."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingLedgerSectorAccounts(false); });
  };
  const openLedgerSectorAccount = (groupName: string, subgroupName: string, pa: string, code: string) => {
    if (!sector) return;
    const requestVersion = beginDetailRequest();
    const key = [groupName, subgroupName, pa, code].join("|");
    if (ledgerSectorAccount === key) { setLedgerSectorAccount(null); setLedgerSectorEntries([]); return; }
    setLedgerSectorAccount(key); setLedgerSectorEntries([]); setLoadingLedgerSectorEntries(true);
    fetch(`${api}/dashboard/group-ledger?${params({ sector, group: groupName, subgroup: subgroupName, pa, account: code })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((result: { entries: Entry[] }) => { if (isCurrentDetailRequest(requestVersion)) setLedgerSectorEntries(result.entries); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os lançamentos da conta."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingLedgerSectorEntries(false); });
  };
  function BudgetSectorDetail() {
    if (!budgetSectorPas) return <div className="inline-loading">Não foi possível carregar os grupos do setor.</div>;
    return <section className="inline-ledger-detail budget-sector-detail">
      <header className="inline-ledger-header"><div><p className="eyebrow">ORÇAMENTO — {sector}</p><h4>Detalhamento por conta e PA</h4></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <section className="budget-sector-tree">
        {budgetSectorPas.rows.map(groupRow => {
          const groupOpen = budgetSectorGroup === groupRow.label;
          const subgroupData = budgetSectorSubgroups[groupRow.label];
          return <div className="budget-tree-node budget-tree-group" key={groupRow.label}>
            <button className="budget-tree-trigger" onClick={() => openBudgetSectorGroup(groupRow.label)}><span><i>{groupOpen ? "−" : "+"}</i> {groupRow.label}</span><div className="budget-tree-values"><small>ORÇADO {money.format(groupRow.budget)}</small><small>REALIZADO {money.format(groupRow.actual)}</small><strong data-variation-tone="true" className={variationTone(groupRow.variation, groupRow.variationDirection)}>VARIAÇÃO {money.format(groupRow.variation)}</strong></div></button>
            {groupOpen ? <div className="budget-tree-children">{loadingBudgetSectorGroups && !subgroupData ? <div className="inline-loading">Carregando subgrupos…</div> : !subgroupData ? <div className="inline-loading">Não foi possível carregar os subgrupos.</div> : subgroupData.rows.map(subgroupRow => {
              const subgroupKey = groupRow.label + "|" + subgroupRow.label;
              const subgroupOpen = budgetSectorSubgroup === subgroupKey;
              const paData = budgetSectorPasBySubgroup[subgroupKey];
              return <div className="budget-tree-node budget-tree-subgroup" key={subgroupKey}>
                <button className="budget-tree-trigger" onClick={() => openBudgetSectorSubgroup(groupRow.label, subgroupRow.label)}><span><i>{subgroupOpen ? "−" : "+"}</i> {subgroupRow.label}</span><div className="budget-tree-values"><small>ORÇADO {money.format(subgroupRow.budget)}</small><small>REALIZADO {money.format(subgroupRow.actual)}</small><strong data-variation-tone="true" className={variationTone(subgroupRow.variation, subgroupRow.variationDirection)}>VARIAÇÃO {money.format(subgroupRow.variation)}</strong></div></button>
                {subgroupOpen ? <div className="budget-tree-children">{loadingBudgetSectorSubgroups && !paData ? <div className="inline-loading">Carregando PAs…</div> : !paData ? <div className="inline-loading">Não foi possível carregar as PAs.</div> : paData.rows.map(pa => {
                  const paKey = subgroupKey + "|" + pa.label;
                  const paOpen = budgetSectorPa === paKey;
                  return <div className="budget-tree-node budget-tree-pa" key={paKey}>
                    <button className="budget-tree-trigger" onClick={() => openBudgetSectorHierarchyPa(groupRow.label, subgroupRow.label, pa.label)}><span><i>{paOpen ? "−" : "+"}</i> PA {paText(pa.label)}</span><div className="budget-tree-values"><small>ORÇADO {money.format(pa.budget)}</small><small>REALIZADO {money.format(pa.actual)}</small><strong data-variation-tone="true" className={variationTone(pa.variation, pa.variationDirection)}>VARIAÇÃO {money.format(pa.variation)}</strong></div></button>
                    {paOpen ? <div className="budget-tree-children budget-account-list">{loadingBudgetSectorAccounts ? <div className="inline-loading">Carregando lançamentos e contas…</div> : !budgetSectorAccounts ? <div className="inline-loading">Não foi possível carregar as contas.</div> : budgetSectorAccounts.rows.map(account => { const [code, ...nameParts] = account.label.split(" — "); const name = nameParts.join(" — ") || code; return <div className="budget-account-row" key={account.label}><span><b>{name}</b><small>CONTA {code}</small></span><div className="budget-account-values"><small>Orçado {money.format(account.budget)}</small><small>Realizado {money.format(account.actual)}</small><strong data-variation-tone="true" className={variationTone(account.variation, account.variationDirection)}>Variação {money.format(account.variation)}</strong></div></div>; })}</div> : null}
                  </div>;
                })}</div> : null}
              </div>;
            })}</div> : null}
          </div>;
        })}
      </section>
    </section>;
  }
  function StandardBudgetSectorDetail() {
    if (!budgetSectorPas) return <div className="inline-loading">Não foi possível carregar os grupos do setor.</div>;
    const months = budgetSectorPas.months;
    const columnSpan = 1 + months.length * 4 + 4;
    const loadingRow = (key: string, message: string) => <tr className="account-leaf-row" key={key}><td colSpan={columnSpan}><div className="inline-loading">{message}</div></td></tr>;
    return <section className="group-detail budget-group-detail budget-sector-detail">
      <header><div><b>ORÇAMENTO — {sector}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <div className="group-detail-scroll"><table className="group-detail-table budget-detail-table">
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={4} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" colSpan={4}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title} title={title === "%" ? (isBudget ? "Execução: realizado dividido pelo orçado" : "Variação em relação ao mês anterior") : undefined}>{title}</th>))}<th className="month-start">ORÇADO</th><th>REALIZADO</th><th>VARIAÇÃO</th><th>%</th></tr></thead>
        <tbody>{budgetSectorPas.rows.flatMap(groupRow => {
          const groupOpen = budgetSectorGroup === groupRow.label;
          const subgroupData = budgetSectorSubgroups[groupRow.label];
          const subgroupRows = !groupOpen ? [] : loadingBudgetSectorGroups && !subgroupData ? [loadingRow(groupRow.label + "-loading", "Carregando subgrupos…")] : !subgroupData ? [loadingRow(groupRow.label + "-error", "Não foi possível carregar os subgrupos.")] : subgroupData.rows.flatMap(subgroupRow => {
            const subgroupKey = groupRow.label + "|" + subgroupRow.label;
            const subgroupOpen = budgetSectorSubgroup === subgroupKey;
            const paData = budgetSectorPasBySubgroup[subgroupKey];
            const paRows = !subgroupOpen ? [] : loadingBudgetSectorSubgroups && !paData ? [loadingRow(subgroupKey + "-loading", "Carregando PAs…")] : !paData ? [loadingRow(subgroupKey + "-error", "Não foi possível carregar as PAs.")] : paData.rows.flatMap(pa => {
              const paKey = subgroupKey + "|" + pa.label;
              const paOpen = budgetSectorPa === paKey;
              const accountRows = !paOpen ? [] : loadingBudgetSectorAccounts ? [loadingRow(paKey + "-loading", "Carregando lançamentos e contas…")] : !budgetSectorAccounts ? [loadingRow(paKey + "-error", "Não foi possível carregar as contas.")] : budgetSectorAccounts.rows.flatMap(account => {
                const [code, ...nameParts] = account.label.split(" — ");
                const accountKey = [groupRow.label, subgroupRow.label, pa.label, code].join("|");
                const accountOpen = budgetSectorAccount === accountKey;
                const entryRows = !accountOpen ? [] : [<tr className="account-leaf-row budget-account-detail-row" key={accountKey + "-entries"}><td colSpan={columnSpan}><div className="budget-account-entries">{loadingBudgetSectorEntries ? <div className="inline-loading">Carregando lançamentos…</div> : budgetSectorEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderEntriesByMonth(budgetSectorEntries)}</div></td></tr>];
                return [<tr className="account-budget-row" key={accountKey} onClick={() => openBudgetSectorAccount(groupRow.label, subgroupRow.label, pa.label, code)}><td><span className="sector-trigger-icon">{accountOpen ? "−" : "+"}</span>{nameParts.join(" — ") || code}<small className="account-inline-code">CONTA {code}</small></td>{budgetValueCells(account)}</tr>, ...entryRows];
              });
              return [<tr className="pa-budget-row" key={paKey} onClick={() => openBudgetSectorHierarchyPa(groupRow.label, subgroupRow.label, pa.label)}><td><span className="sector-trigger-icon">{paOpen ? "−" : "+"}</span>PA {paText(pa.label)}</td>{budgetValueCells(pa)}</tr>, ...accountRows];
            });
            return [<tr className="subgroup-row budget-subgroup-row" key={subgroupKey} onClick={() => openBudgetSectorSubgroup(groupRow.label, subgroupRow.label)}><td><span className="sector-trigger-icon">{subgroupOpen ? "−" : "+"}</span>{subgroupRow.label}</td>{budgetValueCells(subgroupRow)}</tr>, ...paRows];
          });
          return [<tr className="subgroup-row budget-subgroup-row" key={groupRow.label} onClick={() => openBudgetSectorGroup(groupRow.label)}><td><span className="sector-trigger-icon">{groupOpen ? "−" : "+"}</span>{groupRow.label}</td>{budgetValueCells(groupRow)}</tr>, ...subgroupRows];
        })}</tbody>
      </table></div>
    </section>;
  }
  const budgetSectorDetail = <StandardBudgetSectorDetail />;
  const renderEntriesByMonth = (sourceEntries: Entry[], extraMetadata: ExportMetadata = []) => {
    const paCode = dimension === "group" ? groupPa : (isBudget ? budgetSectorPa : ledgerSectorPa)?.split("|").at(-1);
    const groupName = dimension === "group" ? group : isBudget ? budgetSectorGroup : ledgerSectorGroup;
    const subgroupName = dimension === "group" ? subgroup : (isBudget ? budgetSectorSubgroup : ledgerSectorSubgroup)?.split("|").at(-1);
    const metadata: ExportMetadata = [...reportMetadata.filter(([name]) => name !== "PA" && name !== "Setor"), ["PA", paCode || filters.pa ? paText(paCode || filters.pa) : "Todos os PAs"], ["Setor", sector || filters.sector || "Todos os setores"], ["Grupo", groupName || "Todos os grupos"], ["Subgrupo", subgroupName || "Todos os subgrupos"]];
    return <EntryMonthList entries={sourceEntries} exportMetadata={[...metadata, ...extraMetadata]} />;
  };
  const renderLedgerEntriesByDescription = (sourceEntries: Entry[]) => {
    const entriesByDescription = new Map<string, Entry[]>();
    sourceEntries.forEach(entry => {
      const description = entry.history?.trim() || "Lançamento sem descrição";
      const entries = entriesByDescription.get(description) ?? [];
      entries.push(entry);
      entriesByDescription.set(description, entries);
    });
    return <div className="ledger-description-list">{Array.from(entriesByDescription.entries()).map(([description, descriptionEntries]) => {
      const realized = descriptionEntries.reduce((total, entry) => total + entry.realized, 0);
      const count = descriptionEntries.length;
      return <details className="ledger-description-node" key={description}>
        <summary title={description}><span><b>{description}</b><small>{count} lançamento{count === 1 ? "" : "s"}</small></span><strong className={realized >= 0 ? "positive-text" : "negative-text"}>{money.format(realized)}</strong></summary>
        <div className="ledger-description-content">{renderEntriesByMonth(descriptionEntries, [["Histórico", description]])}</div>
      </details>;
    })}</div>;
  };
  const renderBudgetGroupAccount = (account: Row) => {
    const [code, ...nameParts] = account.label.split(" — ");
    const opened = groupAccount === code;
    return <div className="account-branch account-branch-expandable" key={account.label}>
      <button className="budget-account-trigger" type="button" onClick={() => openLedgerGroupAccount(code)} aria-expanded={opened}>
        <span className="account-name"><i>{opened ? "−" : "+"}</i>{nameParts.join(" — ") || code}</span>
        <span className="account-code"><span>CONTA {code}</span><span>ORÇADO {money.format(account.budget)}</span><span>REALIZADO {money.format(account.actual)}</span><strong data-variation-tone="true" className={variationTone(account.variation, account.variationDirection)}>VARIAÇÃO {money.format(account.variation)}</strong></span>
      </button>
      {opened ? <div className="budget-account-entries">{loadingGroupEntries ? <div className="inline-loading">Carregando lançamentos…</div> : groupEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderEntriesByMonth(groupEntries)}</div> : null}
    </div>;
  };
const budgetValueCells = (row: Row) => <>{row.values.flatMap((value, index) => {
    const { variation: change, variationPercent } = budgetMetrics(value);
    const tone = variationTone(change, value.variationDirection ?? row.variationDirection);
    return [<td className={index ? "month-start" : ""} key={value.month + "-budget"}>{money.format(value.budget)}</td>, <td key={value.month + "-actual"}>{money.format(value.actual)}</td>, <td data-variation-tone="true" className={tone} key={value.month + "-variation"}>{money.format(change)}</td>, <td data-variation-tone="true" className={variationPercent === null ? "" : tone} key={value.month + "-percent"}>{pct(variationPercent)}</td>];
  })}<td className="total-cell month-start">{money.format(row.budget)}</td><td className="total-cell">{money.format(row.actual)}</td><td data-variation-tone="true" className={"total-cell " + variationTone(row.variation, row.variationDirection)}>{money.format(row.variation)}</td><td data-variation-tone="true" className={"total-cell " + (row.variationPercent === null ? "" : variationTone(row.variation, row.variationDirection))}>{pct(row.variationPercent)}</td></>; const budgetGroupDetail = !accounts ? <div className="inline-loading">Não foi possível carregar os subgrupos.</div> : <section className="group-detail budget-group-detail"><header><div><b>{group}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header><div className="group-detail-scroll"><table className="group-detail-table budget-detail-table"><thead><tr><th rowSpan={2}>Conta</th>{accounts.months.map(monthValue => <th colSpan={4} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" colSpan={4}>Acumulado</th></tr><tr>{accounts.months.flatMap((monthValue, index) => ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title} title={title === "%" ? (isBudget ? "Execução: realizado dividido pelo orçado" : "Variação em relação ao mês anterior") : undefined}>{title}</th>))}<th className="month-start">ORÇADO</th><th>REALIZADO</th><th>VARIAÇÃO</th><th>%</th></tr></thead><tbody>{accounts.rows.flatMap(row => { const expandedSubgroup = subgroup === row.label; const pas = budgetGroupPas[row.label]?.rows ?? []; const colspan = 1 + accounts.months.length * 4 + 4; const paRows = !expandedSubgroup ? [] : loadingBudgetGroupPas && !budgetGroupPas[row.label] ? [<tr className="account-leaf-row" key={row.label + "-loading"}><td colSpan={colspan}><div className="inline-loading">Carregando PAs…</div></td></tr>] : !budgetGroupPas[row.label] || pas.length === 0 ? [<tr className="account-leaf-row" key={row.label + "-empty"}><td colSpan={colspan}><span className="no-pa">Sem PA vinculada.</span></td></tr>] : pas.flatMap(pa => { const expanded = groupPa === pa.label; return [<tr className="pa-budget-row" key={row.label + "-" + pa.label} onClick={() => openBudgetGroupPa(row.label, pa.label)}><td><span className="sector-trigger-icon">{expanded ? "−" : "+"}</span>{paText(pa.label)}</td>{budgetValueCells(pa)}</tr>, expanded ? <tr className="account-leaf-row" key={row.label + "-" + pa.label + "-accounts"}><td colSpan={colspan}><div className="group-pa-accounts">{loadingGroupPa ? <div className="inline-loading">Carregando contas…</div> : !groupPaAccounts ? <div className="inline-loading">Não foi possível carregar as contas.</div> : groupPaAccounts.rows.map(renderBudgetGroupAccount)}</div></td></tr> : null].filter(Boolean); }); return [<tr className="subgroup-row budget-subgroup-row" key={row.label} onClick={() => openBudgetGroupSubgroup(row.label)}><td><span className="sector-trigger-icon">{expandedSubgroup ? "−" : "+"}</span>{row.label}</td>{budgetValueCells(row)}</tr>, ...paRows]; })}</tbody></table></div></section>;
  function StandardLedgerGroupDetail() {
    if (!accounts) return <div className="inline-loading">Não foi possível carregar os subgrupos do grupo.</div>;
    const months = accounts.months;
    const columnSpan = 1 + months.length * 3 + 1;
    const ledgerCells = (row: Row) => <>{row.values.flatMap((value, index) => {
      const { variation: change, variationPercent } = ledgerMetrics(value, index, row.values);
      const tone = variationTone(change, value.variationDirection ?? row.variationDirection);
      return [<td className={index ? "month-start" : ""} key={value.month + "-value"}>{money.format(value.actual)}</td>, <td data-variation-tone="true" className={tone} key={value.month + "-variation"}>{money.format(change)}</td>, <td data-variation-tone="true" className={variationPercent === null ? "" : tone} key={value.month + "-percent"}>{pct(variationPercent)}</td>];
    })}<td className="total-cell month-start">{money.format(row.actual)}</td></>;
    const loadingRow = (key: string, message: string) => <tr className="account-leaf-row" key={key}><td colSpan={columnSpan}><div className="inline-loading">{message}</div></td></tr>;
    return <section className="group-detail group-ledger-detail ledger-group-hierarchy">
      <header><div><b>LIVRO RAZÃO — {group}</b><p>Abra o subgrupo, a PA e a conta para consultar os históricos e as datas dos lançamentos.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <div className="group-detail-scroll"><table className="group-detail-table ledger-detail-table">
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={3} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" rowSpan={2}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["VALOR", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title} title={title === "%" ? (isBudget ? "Execução: realizado dividido pelo orçado" : "Variação em relação ao mês anterior") : undefined}>{title}</th>))}</tr></thead>
        <tbody>{accounts.rows.flatMap(subgroupRow => {
          const subgroupOpen = subgroup === subgroupRow.label;
          const paData = ledgerGroupPasBySubgroup[subgroupRow.label];
          const subgroupKey = "ledger-subgroup|" + subgroupRow.label;
          const paRows = !subgroupOpen ? [] : loadingSubgroup && !paData ? [loadingRow(subgroupKey + "-loading", "Carregando PAs…")] : !paData ? [loadingRow(subgroupKey + "-error", "Não foi possível carregar as PAs do subgrupo.")] : paData.rows.length === 0 ? [loadingRow(subgroupKey + "-empty", "Nenhuma PA encontrada para este subgrupo.")] : paData.rows.flatMap(pa => {
            const paKey = subgroupKey + "|" + pa.label;
            const paOpen = groupPa === pa.label;
            const accountRows = !paOpen ? [] : loadingGroupPa ? [loadingRow(paKey + "-loading", "Carregando contas…")] : !groupPaAccounts ? [loadingRow(paKey + "-error", "Não foi possível carregar as contas da PA.")] : groupPaAccounts.rows.length === 0 ? [loadingRow(paKey + "-empty", "Nenhuma conta encontrada para esta PA.")] : groupPaAccounts.rows.flatMap(account => {
              const [code, ...nameParts] = account.label.split(" — ");
              const accountKey = paKey + "|" + code;
              const accountOpen = groupAccount === code;
              const entryRows = !accountOpen ? [] : [<tr className="account-leaf-row budget-account-detail-row" key={accountKey + "-entries"}><td colSpan={columnSpan}><div className="budget-account-entries">{loadingGroupEntries ? <div className="inline-loading">Carregando lançamentos…</div> : groupEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderLedgerEntriesByDescription(groupEntries)}</div></td></tr>];
              return [<tr className="account-budget-row" key={accountKey} onClick={() => openLedgerGroupAccount(code)}><td><button type="button" className="detail-hierarchy-trigger" aria-expanded={accountOpen} aria-label={`${accountOpen ? "Fechar" : "Abrir"} históricos de ${nameParts.join(" — ") || code}`} onClick={event => { event.stopPropagation(); openLedgerGroupAccount(code); }}><span className="sector-trigger-icon" aria-hidden="true">{accountOpen ? "−" : "+"}</span><span className="detail-hierarchy-label">{nameParts.join(" — ") || code}<small className="account-inline-code">CONTA {code}</small></span></button></td>{ledgerCells(account)}</tr>, ...entryRows];
            });
            return [<tr className="pa-budget-row" key={paKey} onClick={() => openLedgerGroupPa(pa.label, subgroupRow.label)}><td><button type="button" className="detail-hierarchy-trigger" aria-expanded={paOpen} aria-label={`${paOpen ? "Fechar" : "Abrir"} contas da PA ${paText(pa.label)}`} onClick={event => { event.stopPropagation(); openLedgerGroupPa(pa.label, subgroupRow.label); }}><span className="sector-trigger-icon" aria-hidden="true">{paOpen ? "−" : "+"}</span><span className="detail-hierarchy-label">PA {paText(pa.label)}</span></button></td>{ledgerCells(pa)}</tr>, ...accountRows];
          });
          return [<tr className="subgroup-row budget-subgroup-row" key={subgroupKey} onClick={() => openLedgerGroupSubgroup(subgroupRow.label)}><td><button type="button" className="detail-hierarchy-trigger" aria-expanded={subgroupOpen} aria-label={`${subgroupOpen ? "Fechar" : "Abrir"} PAs de ${subgroupRow.label}`} onClick={event => { event.stopPropagation(); openLedgerGroupSubgroup(subgroupRow.label); }}><span className="sector-trigger-icon" aria-hidden="true">{subgroupOpen ? "−" : "+"}</span><span className="detail-hierarchy-label">{subgroupRow.label}</span></button></td>{ledgerCells(subgroupRow)}</tr>, ...paRows];
        })}</tbody>
      </table></div>
    </section>;
  }
  function StandardLedgerSectorDetail() {
    if (!ledger || !ledgerSectorGroups) return <div className="inline-loading">Não foi possível carregar os grupos do setor.</div>;
    const months = ledgerSectorGroups.months;
    const columnSpan = 1 + months.length * 3 + 1;
    const loadingRow = (key: string, message: string) => <tr className="account-leaf-row" key={key}><td colSpan={columnSpan}><div className="inline-loading">{message}</div></td></tr>;
    const ledgerCells = (row: Row) => <>{row.values.flatMap((value, index) => {
      const { variation: change, variationPercent } = ledgerMetrics(value, index, row.values);
      const tone = variationTone(change, value.variationDirection ?? row.variationDirection);
      return [<td className={index ? "month-start" : ""} key={value.month + "-value"}>{money.format(value.actual)}</td>, <td data-variation-tone="true" className={tone} key={value.month + "-variation"}>{money.format(change)}</td>, <td data-variation-tone="true" className={variationPercent === null ? "" : tone} key={value.month + "-percent"}>{pct(variationPercent)}</td>];
    })}<td className="total-cell month-start">{money.format(row.actual)}</td></>;
    return <section className="group-detail group-ledger-detail">
      <header><div><b>LIVRO RAZÃO — {ledger.sectorName}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <div className="group-detail-scroll"><table className="group-detail-table ledger-detail-table">
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={3} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" rowSpan={2}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["VALOR", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title} title={title === "%" ? (isBudget ? "Execução: realizado dividido pelo orçado" : "Variação em relação ao mês anterior") : undefined}>{title}</th>))}</tr></thead>
        <tbody>{ledgerSectorGroups.rows.flatMap(groupRow => {
          const groupOpen = ledgerSectorGroup === groupRow.label;
          const subgroupData = ledgerSectorSubgroups[groupRow.label];
          const subgroupRows = !groupOpen ? [] : loadingLedgerSectorGroups && !subgroupData ? [loadingRow(groupRow.label + "-loading", "Carregando subgrupos…")] : !subgroupData ? [loadingRow(groupRow.label + "-error", "Não foi possível carregar os subgrupos.")] : subgroupData.rows.flatMap(subgroupRow => {
            const subgroupKey = [groupRow.label, subgroupRow.label].join("|");
            const subgroupOpen = ledgerSectorSubgroup === subgroupKey;
            const paData = ledgerSectorPasBySubgroup[subgroupKey];
            const paRows = !subgroupOpen ? [] : loadingLedgerSectorSubgroups && !paData ? [loadingRow(subgroupKey + "-loading", "Carregando PAs…")] : !paData ? [loadingRow(subgroupKey + "-error", "Não foi possível carregar as PAs.")] : paData.rows.flatMap(pa => {
              const paKey = [groupRow.label, subgroupRow.label, pa.label].join("|");
              const paOpen = ledgerSectorPa === paKey;
              const accountRows = !paOpen ? [] : loadingLedgerSectorAccounts ? [loadingRow(paKey + "-loading", "Carregando lançamentos e contas…")] : !ledgerSectorAccounts ? [loadingRow(paKey + "-error", "Não foi possível carregar as contas.")] : ledgerSectorAccounts.rows.flatMap(account => {
                const [code, ...nameParts] = account.label.split(" — ");
                const accountKey = [groupRow.label, subgroupRow.label, pa.label, code].join("|");
                const accountOpen = ledgerSectorAccount === accountKey;
                const entryRows = !accountOpen ? [] : [<tr className="account-leaf-row budget-account-detail-row" key={accountKey + "-entries"}><td colSpan={columnSpan}><div className="budget-account-entries">{loadingLedgerSectorEntries ? <div className="inline-loading">Carregando lançamentos…</div> : ledgerSectorEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderLedgerEntriesByDescription(ledgerSectorEntries)}</div></td></tr>];
                return [<tr className="account-budget-row" key={accountKey} onClick={() => openLedgerSectorAccount(groupRow.label, subgroupRow.label, pa.label, code)}><td><span className="sector-trigger-icon">{accountOpen ? "−" : "+"}</span>{nameParts.join(" — ") || code}<small className="account-inline-code">CONTA {code}</small></td>{ledgerCells(account)}</tr>, ...entryRows];
              });
              return [<tr className="pa-budget-row" key={paKey} onClick={() => openLedgerSectorPa(groupRow.label, subgroupRow.label, pa.label)}><td><span className="sector-trigger-icon">{paOpen ? "−" : "+"}</span>PA {paText(pa.label)}</td>{ledgerCells(pa)}</tr>, ...accountRows];
            });
            return [<tr className="subgroup-row budget-subgroup-row" key={subgroupKey} onClick={() => openLedgerSectorSubgroup(groupRow.label, subgroupRow.label)}><td><span className="sector-trigger-icon">{subgroupOpen ? "−" : "+"}</span>{subgroupRow.label}</td>{ledgerCells(subgroupRow)}</tr>, ...paRows];
          });
          return [<tr className="subgroup-row budget-subgroup-row" key={groupRow.label} onClick={() => openLedgerSectorGroup(groupRow.label)}><td><span className="sector-trigger-icon">{groupOpen ? "−" : "+"}</span>{groupRow.label}</td>{ledgerCells(groupRow)}</tr>, ...subgroupRows];
        })}</tbody>
      </table></div>
    </section>;
  }
  if (!session) return <LoginScreen onAuthenticated={(next) => { window.localStorage.setItem("orcamento-session", JSON.stringify(next)); setSession(next); }} />;

  const renderDashboardFilters = () => <>
    <section className="filters"><label>Ano<select value={year} onChange={e => setYear(Number(e.target.value))}>{options.years.map(y => <option key={y}>{y}</option>)}</select></label><label>PA<select value={filters.pa} onChange={e => setFilters(x => ({ ...x, pa: e.target.value }))}><option value="">Todos</option>{options.pas.map(p => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}</select></label><label>Setor<select value={filters.sector} onChange={e => setFilters(x => ({ ...x, sector: e.target.value }))}><option value="">Todos</option>{options.sectors.map(s => <option key={s}>{s}</option>)}</select></label><label>Período<select value={filters.period} onChange={e => setFilters(x => ({ ...x, period: e.target.value }))}><option value="">Acumulado</option>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(m => <option key={m} value={`${year}-${m}`}>{month.format(new Date(`${year}-${m}-01T12:00:00Z`))}</option>)}</select></label><EntrySearchField value={{ term: filters.search, type: filters.searchType }} onSearch={search => setFilters(current => ({ ...current, search: search.term, searchType: search.type }))} /><button className="clear-filters" onClick={() => setFilters({ pa: "", sector: "", period: "", account: "", search: "", searchType: "history" })}>Limpar filtros</button></section>
    {filters.search ? <p className="entry-search-note" role="status">{searchLabels[filters.searchType]}: “{filters.search}”.{filters.searchType === "amount" ? " Busca no débito, crédito ou realizado, sem considerar o sinal." : ""}{isBudget ? " O orçado corresponde às contas dos lançamentos encontrados." : ""}</p> : null}
  </>;

  const renderOverviewStateShell = (content: ReactNode) => <><AppSideNavigation active="analysis" analysisView={isBudget ? "budget" : "ledger"} analysisDimension={dimension} /><main className="dashboard-shell app-with-top-navigation">
    <header className="topbar"><div className="topbar-title"><p>CONTROLE ORÇAMENTÁRIO</p><h1>Orçamento e Razão</h1></div></header>
    <section className="dashboard-heading"><div><p className="eyebrow">VISÃO CONSOLIDADA</p><h2>{views.find(v => v.id === view)?.label}</h2></div></section>
    <nav className="view-navigation">{views.map(v => <button key={v.id} className={view === v.id ? "selected" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}</nav>
    {renderDashboardFilters()}
    {error ? <section className="message error-message" role="alert">{error}</section> : null}
    {content}
  </main></>;

  if (loadingOverview || (!data && !overviewError)) return renderOverviewStateShell(<section className="dashboard-state dashboard-loading-state" aria-busy="true" aria-live="polite"><div><p className="eyebrow">ATUALIZANDO PAINEL</p><h3>Carregando informações</h3><p>Estamos atualizando os indicadores e o detalhamento para os filtros selecionados.</p></div><div className="dashboard-skeleton" aria-hidden="true"><i /><i /><i /><i /><b /><b /></div></section>);
  if (overviewError) return renderOverviewStateShell(<section className="dashboard-state dashboard-error-state" role="alert"><div><p className="eyebrow">ATUALIZAÇÃO INDISPONÍVEL</p><h3>Não foi possível carregar o painel</h3><p>{overviewError}</p></div><button type="button" className="state-action" onClick={() => setOverviewRequestKey(key => key + 1)}>Tentar novamente</button></section>);
  if (data && data.rows.length === 0) return renderOverviewStateShell(<section className="dashboard-state dashboard-empty-state"><div><p className="eyebrow">SEM RESULTADOS</p><h3>Nenhum dado encontrado</h3><p>Não há informações para os filtros selecionados. Ajuste os filtros ou volte para a visão completa.</p></div><button type="button" className="state-action" onClick={() => setFilters({ pa: "", sector: "", period: "", account: "", search: "", searchType: "history" })}>Limpar filtros</button></section>);
return <><AppSideNavigation active="analysis" analysisView={isBudget ? "budget" : "ledger"} analysisDimension={dimension} /><main className="dashboard-shell app-with-top-navigation"><header className="topbar"><div className="topbar-title"><p>CONTROLE ORÇAMENTÁRIO</p><h1>Orçamento e Razão</h1></div></header><section className="dashboard-heading"><div><p className="eyebrow">VISÃO CONSOLIDADA</p><h2>{views.find(v => v.id === view)?.label}</h2></div></section><nav className="view-navigation">{views.map(v => <button key={v.id} className={view === v.id ? "selected" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}</nav>{renderDashboardFilters()}{error ? <section className="message error-message">{error}</section> : null}{data ? <><section className="summary-grid"><article><p>{isBudget ? "ORÇADO ACUMULADO" : "VALOR ACUMULADO"}</p><strong>{money.format(isBudget ? data.totals.budget : data.totals.actual)}</strong></article><article><p>{isBudget ? "REALIZADO ACUMULADO" : "ÚLTIMO LANÇAMENTO"}</p><strong>{isBudget ? money.format(data.totals.actual) : dateText(data.latestLedgerDate)}</strong></article><article><p>{isBudget ? "VARIAÇÃO" : "REFERÊNCIA CONTÁBIL"}</p><strong>{isBudget ? money.format(data.totals.variation) : dateText(data.reportingDate)}</strong></article><article><p>DATA CONTÁBIL DE REFERÊNCIA</p><strong>{dateText(data.reportingDate)}</strong><span>Data de corte dos valores</span></article></section><section className="table-card"><div className="section-title"><div><p className="eyebrow">DETALHAMENTO</p><h3>{label} por mês</h3></div><ExportExcelButton disabled={!overviewMatchesFilters || loadingOverview || !data.rows.length} buildReport={() => buildDashboardReport(data, { title: exportTitle, year, isBudget, label, metadata: reportMetadata })} /></div><p className="main-table-scroll-hint">Role horizontalmente para ver todos os meses e o acumulado.</p><div className="table-scroll main-monthly-scroll" role="region" tabIndex={0} aria-label={`Tabela de ${label.toLowerCase()} por mês`}><table className={`monthly-table main-monthly-table ${isBudget ? "" : "ledger-table"}`}><caption className="sr-only">Detalhamento de {label.toLowerCase()} por mês. Use a rolagem horizontal para consultar todos os períodos e o acumulado.</caption><thead><tr><th rowSpan={2} scope="col">{label}</th>{data.months.map((m, i) => <th scope="colgroup" key={m} className={i ? "month-start" : ""} colSpan={isBudget ? 4 : 3}>{month.format(new Date(`${m}T12:00:00Z`)).replace(".", "")}/{m.slice(0, 4)}</th>)}<th scope="colgroup" className="month-start" colSpan={isBudget ? 4 : 1}>Acumulado</th></tr><tr>{data.months.flatMap((m, i) => (isBudget ? ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"] : ["VALOR", "VARIAÇÃO", "%"]).map((x, n) => <th scope="col" className={i && n === 0 ? "month-start" : ""} key={`${m}${x}`} title={x === "%" ? (isBudget ? "Execução: realizado dividido pelo orçado" : "Variação em relação ao mês anterior") : undefined}>{x}</th>))}<th scope="col" className="month-start">{isBudget ? "ORÇADO" : "VALOR"}</th>{isBudget ? <><th scope="col">REALIZADO</th><th scope="col">VARIAÇÃO</th><th scope="col">%</th></> : null}</tr></thead><tbody>{data.rows.flatMap((row, rowIndex) => { const opened = dimension === "group" ? group === row.label : sector === row.label; const cols = 1 + data.months.length * (isBudget ? 4 : 3) + (isBudget ? 4 : 1); return [<tr key={row.label}><th scope="row"><button type="button" className="sector-trigger main-sector-trigger" aria-expanded={opened} aria-controls={`monthly-detail-${dimension}-${rowIndex}`} aria-label={`${opened ? "Fechar" : "Abrir"} detalhamento de ${row.label}`} onClick={() => dimension === "group" ? openGroup(row.label) : openSector(row.label)}><span>{row.label}</span><span className="sector-trigger-icon" aria-hidden="true">{opened ? "−" : "+"}</span></button></th>{row.values.flatMap((v, i) => { const { variation: change, variationPercent: budgetPercent } = budgetMetrics(v), { variation: ledgerChange, variationPercent: ledgerPercent } = ledgerMetrics(v, i, row.values); return isBudget ? [<td className={i ? "month-start" : ""} key={`${v.month}b`}>{money.format(v.budget)}</td>, <td key={`${v.month}a`}>{money.format(v.actual)}</td>, <td data-variation-tone="true" className={variationTone(change, v.variationDirection ?? row.variationDirection)} key={`${v.month}v`}>{money.format(change)}</td>, <td data-variation-tone="true" className={budgetPercent === null ? "" : variationTone(change, v.variationDirection ?? row.variationDirection)} key={`${v.month}p`}>{pct(budgetPercent)}</td>] : [<td className={i ? "month-start" : ""} key={`${v.month}a`}>{money.format(v.actual)}</td>, <td data-variation-tone="true" className={variationTone(ledgerChange, v.variationDirection ?? row.variationDirection)} key={`${v.month}v`}>{money.format(ledgerChange)}</td>, <td data-variation-tone="true" className={ledgerPercent === null ? "" : variationTone(ledgerChange, v.variationDirection ?? row.variationDirection)} key={`${v.month}p`}>{pct(ledgerPercent)}</td>]; })}{isBudget ? <><td className="total-cell month-start">{money.format(row.budget)}</td><td className="total-cell">{money.format(row.actual)}</td><td data-variation-tone="true" className={"total-cell " + variationTone(row.variation, row.variationDirection)}>{money.format(row.variation)}</td><td data-variation-tone="true" className={"total-cell " + (row.variationPercent === null ? "" : variationTone(row.variation, row.variationDirection))}>{pct(row.variationPercent)}</td></> : <td className="total-cell month-start">{money.format(row.actual)}</td>}</tr>, opened ? <tr className="inline-ledger-row" key={`${row.label}detail`}><td id={`monthly-detail-${dimension}-${rowIndex}`} colSpan={cols}>{dimension === "group" ? (loadingGroup ? <div className="inline-loading">Carregando contas do grupo…</div> : (isBudget ? budgetGroupDetail : <StandardLedgerGroupDetail />)) : (isBudget ? (loadingBudgetSector ? <div className="inline-loading">Carregando grupos do setor…</div> : budgetSectorDetail) : (loadingLedger ? <div className="inline-loading">Carregando grupos do setor…</div> : <StandardLedgerSectorDetail />))}</td></tr> : null].filter(Boolean); })}</tbody></table></div></section></> : null}</main></>;
}
