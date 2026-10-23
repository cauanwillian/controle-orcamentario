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
import { LoginScreen, LoginSession } from "./login-screen";
import { AppSideNavigation } from "./app-side-navigation";

type Value = { month: string; budget: number; actual: number };
type Row = { label: string; values: Value[]; budget: number; actual: number; variation: number; variationPercent: number | null };
type Dashboard = { reportingDate: string; latestLedgerDate: string | null; totals: { budget: number; actual: number; variation: number; variationPercent: number | null }; months: string[]; rows: Row[]; viewer: { employeeName: string; roles: string[]; fullAccess: boolean } };
type Filters = { pa: string; sector: string; period: string; account: string };
type Options = { years: number[]; pas: { code: string; label: string }[]; sectors: string[] };
type Entry = { posting_date: string; account_code: string; account_name: string; history: string | null; lot_code: string; entry_number: string; debitAmount: number; creditAmount: number; realized: number };
type Ledger = { sectorName: string; reportingDate: string; total: number; pas: { paCode: string; total: number; realized: number }[]; entries: Entry[] };
type View = "budget-group" | "budget-sector" | "ledger-group" | "ledger-sector";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const dateText = (v: string | null) => v ? date.format(new Date(`${v}T12:00:00Z`)) : "—";
const pct = (v: number | null) => v === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(v);
const ratio = (base: number, value: number) => base === 0 ? null : (value - base) / Math.abs(base);
const paText = (value: string) => /^\d+$/.test(value) ? value.padStart(2, "0") : value;
const views: { id: View; label: string }[] = [{ id: "budget-group", label: "GRUPOS - ORÇAMENTOS" }, { id: "budget-sector", label: "SETORES - ORÇAMENTOS" }, { id: "ledger-group", label: "GRUPOS - RAZÃO" }, { id: "ledger-sector", label: "SETORES - RAZÃO" }];

export default function Home() {
  const [view, setView] = useState<View>("budget-group"), [year, setYear] = useState(2026);
  const [session, setSession] = useState<LoginSession | null>(null);
  const [options, setOptions] = useState<Options>({ years: [2026], pas: [], sectors: [] });
  const [filters, setFilters] = useState<Filters>({ pa: "", sector: "", period: "", account: "" }), [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState<string | null>(null);
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
  const detailRequestVersion = useRef(0);
  const beginDetailRequest = () => ++detailRequestVersion.current;
  const isCurrentDetailRequest = (version: number) => version === detailRequestVersion.current;
  const resetDetailLoading = () => { setLoadingLedger(false); setLoadingPa(false); setLoadingBudgetSector(false); setLoadingBudgetSectorAccounts(false); setLoadingBudgetSectorGroups(false); setLoadingBudgetSectorSubgroups(false); setLoadingGroup(false); setLoadingSubgroup(false); setLoadingGroupPa(false); setLoadingGroupEntries(false); setLoadingBudgetGroupPas(false); setLoadingLedgerSectorGroups(false); setLoadingLedgerSectorSubgroups(false); setLoadingLedgerSectorAccounts(false); setLoadingLedgerSectorEntries(false); };
  const [group, setGroup] = useState<string | null>(null), [accounts, setAccounts] = useState<Dashboard | null>(null), [loadingGroup, setLoadingGroup] = useState(false), [subgroup, setSubgroup] = useState<string | null>(null), [subgroupAccounts, setSubgroupAccounts] = useState<Dashboard | null>(null), [loadingSubgroup, setLoadingSubgroup] = useState(false), [groupPa, setGroupPa] = useState<string | null>(null), [groupPaAccounts, setGroupPaAccounts] = useState<Dashboard | null>(null), [loadingGroupPa, setLoadingGroupPa] = useState(false), [groupAccount, setGroupAccount] = useState<string | null>(null), [groupEntries, setGroupEntries] = useState<Entry[]>([]), [loadingGroupEntries, setLoadingGroupEntries] = useState(false), [budgetGroupPas, setBudgetGroupPas] = useState<Record<string, Dashboard>>({}), [loadingBudgetGroupPas, setLoadingBudgetGroupPas] = useState(false);
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("view"); if (requested === "budget-group" || requested === "budget-sector" || requested === "ledger-group" || requested === "ledger-sector") setView(requested); }, []);
  const isBudget = view.startsWith("budget"), dimension = view.endsWith("group") ? "group" : "sector", label = dimension === "group" ? "Grupo contábil" : "Setor";
  const clearDetails = () => { beginDetailRequest(); resetDetailLoading(); setSector(null); setLedger(null); setActivePa(null); setEntries([]); setBudgetSectorPas(null); setBudgetSectorPa(null); setBudgetSectorAccounts(null); setBudgetSectorGroup(null); setBudgetSectorSubgroup(null); setBudgetSectorSubgroups({}); setBudgetSectorPasBySubgroup({}); setBudgetSectorAccount(null); setBudgetSectorEntries([]); setLedgerSectorGroups(null); setLedgerSectorGroup(null); setLedgerSectorSubgroup(null); setLedgerSectorSubgroups({}); setLedgerSectorPasBySubgroup({}); setLedgerSectorPa(null); setLedgerSectorAccounts(null); setLedgerSectorAccount(null); setLedgerSectorEntries([]); setGroup(null); setAccounts(null); setSubgroup(null); setSubgroupAccounts(null); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); };
  const params = (extra: Record<string, string> = {}) => { const q = new URLSearchParams({ year: String(year), employee: session?.viewer.employeeCode ?? "", ...extra }); if (filters.pa && !q.has("pa")) q.set("pa", filters.pa); if (filters.sector && !q.has("sector")) q.set("sector", filters.sector); if (filters.period && !q.has("period")) q.set("period", filters.period); if (filters.account && !q.has("account")) q.set("account", filters.account); return q; };
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
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(payload => { if (alive) setData(payload); })
      .catch(() => { if (alive && !controller.signal.aborted) setOverviewError("Não foi possível atualizar o painel agora."); })
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
    setGroup(name); setAccounts(null); setSubgroup(null); setSubgroupAccounts(null); setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); setLoadingGroup(true);
    const detailDimension = isBudget ? "subgroup" : "pa";
    fetch(`${api}/dashboard/overview?${params({ dimension: detailDimension, group: name, ledgerOnly: isBudget ? "false" : "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setAccounts(payload); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError(isBudget ? "Não foi possível carregar os subgrupos." : "Não foi possível carregar as PAs do grupo."); })
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
  const openLedgerGroupPa = (pa: string) => {
    if (!group) return;
    const requestVersion = beginDetailRequest();
    if (groupPa === pa) { setGroupPa(null); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); return; }
    setGroupPa(pa); setGroupPaAccounts(null); setGroupAccount(null); setGroupEntries([]); setLoadingGroupPa(true);
    fetch(`${api}/dashboard/overview?${params({ dimension: "account", group, pa, ledgerOnly: "true" })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(payload => { if (isCurrentDetailRequest(requestVersion)) setGroupPaAccounts(payload); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar as contas da PA."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroupPa(false); });
  };
  const openLedgerGroupAccount = (code: string) => {
    if (!group || !groupPa) return;
    const requestVersion = beginDetailRequest();
    if (groupAccount === code) { setGroupAccount(null); setGroupEntries([]); return; }
    setGroupAccount(code); setGroupEntries([]); setLoadingGroupEntries(true);
    fetch(`${api}/dashboard/group-ledger?${params({ group, pa: groupPa, account: code })}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((result: { entries: Entry[] }) => { if (isCurrentDetailRequest(requestVersion)) setGroupEntries(result.entries); })
      .catch(() => { if (isCurrentDetailRequest(requestVersion)) setError("Não foi possível carregar os lançamentos da conta."); })
      .finally(() => { if (isCurrentDetailRequest(requestVersion)) setLoadingGroupEntries(false); });
  };
  const consolidateDashboardRows = (dashboard: Dashboard): Dashboard => { const grouped = new Map<string, Row>(); dashboard.rows.forEach(sourceRow => { const key = sourceRow.label.trim(); const existing = grouped.get(key); if (!existing) { grouped.set(key, { ...sourceRow, label: key, values: sourceRow.values.map(value => ({ ...value })) }); return; } existing.values = existing.values.map((value, index) => ({ ...value, budget: value.budget + (sourceRow.values[index]?.budget ?? 0), actual: value.actual + (sourceRow.values[index]?.actual ?? 0) })); existing.budget += sourceRow.budget; existing.actual += sourceRow.actual; existing.variation = existing.actual - existing.budget; existing.variationPercent = ratio(existing.budget, existing.actual); }); return { ...dashboard, rows: [...grouped.values()].map(row => ({ ...row, variation: row.actual - row.budget, variationPercent: ratio(row.budget, row.actual) })) }; };
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
            <button className="budget-tree-trigger" onClick={() => openBudgetSectorGroup(groupRow.label)}><span><i>{groupOpen ? "−" : "+"}</i> {groupRow.label}</span><div className="budget-tree-values"><small>ORÇADO {money.format(groupRow.budget)}</small><small>REALIZADO {money.format(groupRow.actual)}</small><strong className={groupRow.variation >= 0 ? "positive-text" : "negative-text"}>VARIAÇÃO {money.format(groupRow.variation)}</strong></div></button>
            {groupOpen ? <div className="budget-tree-children">{loadingBudgetSectorGroups && !subgroupData ? <div className="inline-loading">Carregando subgrupos…</div> : !subgroupData ? <div className="inline-loading">Não foi possível carregar os subgrupos.</div> : subgroupData.rows.map(subgroupRow => {
              const subgroupKey = groupRow.label + "|" + subgroupRow.label;
              const subgroupOpen = budgetSectorSubgroup === subgroupKey;
              const paData = budgetSectorPasBySubgroup[subgroupKey];
              return <div className="budget-tree-node budget-tree-subgroup" key={subgroupKey}>
                <button className="budget-tree-trigger" onClick={() => openBudgetSectorSubgroup(groupRow.label, subgroupRow.label)}><span><i>{subgroupOpen ? "−" : "+"}</i> {subgroupRow.label}</span><div className="budget-tree-values"><small>ORÇADO {money.format(subgroupRow.budget)}</small><small>REALIZADO {money.format(subgroupRow.actual)}</small><strong className={subgroupRow.variation >= 0 ? "positive-text" : "negative-text"}>VARIAÇÃO {money.format(subgroupRow.variation)}</strong></div></button>
                {subgroupOpen ? <div className="budget-tree-children">{loadingBudgetSectorSubgroups && !paData ? <div className="inline-loading">Carregando PAs…</div> : !paData ? <div className="inline-loading">Não foi possível carregar as PAs.</div> : paData.rows.map(pa => {
                  const paKey = subgroupKey + "|" + pa.label;
                  const paOpen = budgetSectorPa === paKey;
                  return <div className="budget-tree-node budget-tree-pa" key={paKey}>
                    <button className="budget-tree-trigger" onClick={() => openBudgetSectorHierarchyPa(groupRow.label, subgroupRow.label, pa.label)}><span><i>{paOpen ? "−" : "+"}</i> PA {paText(pa.label)}</span><div className="budget-tree-values"><small>ORÇADO {money.format(pa.budget)}</small><small>REALIZADO {money.format(pa.actual)}</small><strong className={pa.variation >= 0 ? "positive-text" : "negative-text"}>VARIAÇÃO {money.format(pa.variation)}</strong></div></button>
                    {paOpen ? <div className="budget-tree-children budget-account-list">{loadingBudgetSectorAccounts ? <div className="inline-loading">Carregando lançamentos e contas…</div> : !budgetSectorAccounts ? <div className="inline-loading">Não foi possível carregar as contas.</div> : budgetSectorAccounts.rows.map(account => { const [code, ...nameParts] = account.label.split(" — "); const name = nameParts.join(" — ") || code; return <div className="budget-account-row" key={account.label}><span><b>{name}</b><small>CONTA {code}</small></span><div className="budget-account-values"><small>Orçado {money.format(account.budget)}</small><small>Realizado {money.format(account.actual)}</small><strong className={account.variation >= 0 ? "positive-text" : "negative-text"}>Variação {money.format(account.variation)}</strong></div></div>; })}</div> : null}
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
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={4} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" colSpan={4}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title}>{title}</th>))}<th className="month-start">ORÇADO</th><th>REALIZADO</th><th>VARIAÇÃO</th><th>%</th></tr></thead>
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
  const renderEntriesByMonth = (sourceEntries: Entry[]) => {
    const entriesByMonth = sourceEntries.reduce<Record<string, Record<string, Entry[]>>>((result, entry) => {
      const monthKey = entry.posting_date.slice(0, 7);
      (result[monthKey] ??= {});
      (result[monthKey][entry.posting_date] ??= []).push(entry);
      return result;
    }, {});
    return <div className="ledger-date-list budget-ledger-date-list">{Object.entries(entriesByMonth).sort(([left], [right]) => right.localeCompare(left)).map(([monthKey, dates]) => <details className="ledger-month-node" key={monthKey}><summary><span>{month.format(new Date(`${monthKey}-01T12:00:00Z`)).replace(".", "").toUpperCase()}/{monthKey.slice(0, 4)}</span><small>{Object.values(dates).reduce((total, dateEntries) => total + dateEntries.length, 0)} lançamentos</small></summary><div className="ledger-month-dates">{Object.entries(dates).sort(([left], [right]) => right.localeCompare(left)).map(([postingDate, dateEntries]) => <details className="ledger-date-node" key={postingDate}><summary><span>{dateText(postingDate)}</span><small>{dateEntries.length} lançamento{dateEntries.length === 1 ? "" : "s"}</small></summary><div className="inline-entries-scroll"><table><thead><tr><th>Lançamento</th><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Realizado</th></tr></thead><tbody>{dateEntries.map((entry, index) => <tr key={`${entry.posting_date}-${entry.entry_number}-${entry.lot_code}-${entry.history ?? ""}-${index}`}><td>{entry.entry_number || entry.lot_code || "—"}</td><td className="entry-history">{entry.history ?? "—"}</td><td>{money.format(entry.debitAmount)}</td><td>{money.format(entry.creditAmount)}</td><td className={entry.realized >= 0 ? "positive-text" : "negative-text"}>{money.format(entry.realized)}</td></tr>)}</tbody></table></div></details>)}</div></details>)}</div>;
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
        <div className="ledger-description-content">{renderEntriesByMonth(descriptionEntries)}</div>
      </details>;
    })}</div>;
  };
  const renderBudgetGroupAccount = (account: Row) => {
    const [code, ...nameParts] = account.label.split(" — ");
    const opened = groupAccount === code;
    return <div className="account-branch account-branch-expandable" key={account.label}>
      <button className="budget-account-trigger" type="button" onClick={() => openLedgerGroupAccount(code)} aria-expanded={opened}>
        <span className="account-name"><i>{opened ? "−" : "+"}</i>{nameParts.join(" — ") || code}</span>
        <span className="account-code"><span>CONTA {code}</span><span>ORÇADO {money.format(account.budget)}</span><span>REALIZADO {money.format(account.actual)}</span><strong className={account.variation >= 0 ? "positive-text" : "negative-text"}>VARIAÇÃO {money.format(account.variation)}</strong></span>
      </button>
      {opened ? <div className="budget-account-entries">{loadingGroupEntries ? <div className="inline-loading">Carregando lançamentos…</div> : groupEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderEntriesByMonth(groupEntries)}</div> : null}
    </div>;
  };
const budgetValueCells = (row: Row) => <>{row.values.flatMap((value, index) => { const change = value.actual - value.budget; return [<td className={index ? "month-start" : ""} key={value.month + "-budget"}>{money.format(value.budget)}</td>, <td key={value.month + "-actual"}>{money.format(value.actual)}</td>, <td className={change >= 0 ? "positive-text" : "negative-text"} key={value.month + "-variation"}>{money.format(change)}</td>, <td key={value.month + "-percent"}>{pct(ratio(value.budget, value.actual))}</td>]; })}<td className="total-cell month-start">{money.format(row.budget)}</td><td className="total-cell">{money.format(row.actual)}</td><td className={row.variation >= 0 ? "positive-text total-cell" : "negative-text total-cell"}>{money.format(row.variation)}</td><td className="total-cell">{pct(row.variationPercent)}</td></>; const budgetGroupDetail = !accounts ? <div className="inline-loading">Não foi possível carregar os subgrupos.</div> : <section className="group-detail budget-group-detail"><header><div><b>{group}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header><div className="group-detail-scroll"><table className="group-detail-table budget-detail-table"><thead><tr><th rowSpan={2}>Conta</th>{accounts.months.map(monthValue => <th colSpan={4} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" colSpan={4}>Acumulado</th></tr><tr>{accounts.months.flatMap((monthValue, index) => ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title}>{title}</th>))}<th className="month-start">ORÇADO</th><th>REALIZADO</th><th>VARIAÇÃO</th><th>%</th></tr></thead><tbody>{accounts.rows.flatMap(row => { const expandedSubgroup = subgroup === row.label; const pas = budgetGroupPas[row.label]?.rows ?? []; const colspan = 1 + accounts.months.length * 4 + 4; const paRows = !expandedSubgroup ? [] : loadingBudgetGroupPas && !budgetGroupPas[row.label] ? [<tr className="account-leaf-row" key={row.label + "-loading"}><td colSpan={colspan}><div className="inline-loading">Carregando PAs…</div></td></tr>] : !budgetGroupPas[row.label] || pas.length === 0 ? [<tr className="account-leaf-row" key={row.label + "-empty"}><td colSpan={colspan}><span className="no-pa">Sem PA vinculada.</span></td></tr>] : pas.flatMap(pa => { const expanded = groupPa === pa.label; return [<tr className="pa-budget-row" key={row.label + "-" + pa.label} onClick={() => openBudgetGroupPa(row.label, pa.label)}><td><span className="sector-trigger-icon">{expanded ? "−" : "+"}</span>{paText(pa.label)}</td>{budgetValueCells(pa)}</tr>, expanded ? <tr className="account-leaf-row" key={row.label + "-" + pa.label + "-accounts"}><td colSpan={colspan}><div className="group-pa-accounts">{loadingGroupPa ? <div className="inline-loading">Carregando contas…</div> : !groupPaAccounts ? <div className="inline-loading">Não foi possível carregar as contas.</div> : groupPaAccounts.rows.map(renderBudgetGroupAccount)}</div></td></tr> : null].filter(Boolean); }); return [<tr className="subgroup-row budget-subgroup-row" key={row.label} onClick={() => openBudgetGroupSubgroup(row.label)}><td><span className="sector-trigger-icon">{expandedSubgroup ? "−" : "+"}</span>{row.label}</td>{budgetValueCells(row)}</tr>, ...paRows]; })}</tbody></table></div></section>;
  const ledgerGroupDetail = !accounts ? <div className="inline-loading">Não foi possível carregar as PAs do grupo.</div> : <section className="group-detail group-ledger-detail"><header><div><b>PAs — {group}</b><p>Abra a PA, depois a conta, o mês e a data para visualizar os lançamentos.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header><section className="group-ledger-tree">{accounts.rows.map(pa => <div className="pa-node" key={pa.label}><button className="pa-trigger" onClick={() => openLedgerGroupPa(pa.label)}><span><i>{groupPa === pa.label ? "−" : "+"}</i>{paText(pa.label)}</span><strong className={pa.actual >= 0 ? "positive-text" : "negative-text"}>{money.format(pa.actual)}</strong></button>{groupPa === pa.label ? <div className="group-ledger-accounts">{loadingGroupPa ? <div className="inline-loading">Carregando contas…</div> : !groupPaAccounts ? <div className="inline-loading">Não foi possível carregar as contas da PA.</div> : groupPaAccounts.rows.map(account => { const [code, ...nameParts] = account.label.split(" — "); const title = nameParts.join(" — ") || code; const isOpen = groupAccount === code; const entriesByMonth = groupEntries.reduce<Record<string, Record<string, Entry[]>>>((result, entry) => { const monthKey = entry.posting_date.slice(0, 7); (result[monthKey] ??= {}); (result[monthKey][entry.posting_date] ??= []).push(entry); return result; }, {}); return <div className="ledger-account-node" key={account.label}><button className="ledger-account-trigger" onClick={() => openLedgerGroupAccount(code)}><span><i>{isOpen ? "−" : "+"}</i><b>{code}</b><small>{title}</small></span><strong className={account.actual >= 0 ? "positive-text" : "negative-text"}>{money.format(account.actual)}</strong></button>{isOpen ? <div className="ledger-date-list">{loadingGroupEntries ? <div className="inline-loading">Carregando lançamentos…</div> : Object.keys(entriesByMonth).length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : Object.entries(entriesByMonth).map(([monthKey, dates]) => <details className="ledger-month-node" key={monthKey}><summary><span>{month.format(new Date(`${monthKey}-01T12:00:00Z`)).replace(".", "").toUpperCase()}/{monthKey.slice(0, 4)}</span><small>{Object.values(dates).reduce((total, dateEntries) => total + dateEntries.length, 0)} lançamentos</small></summary><div className="ledger-month-dates">{Object.entries(dates).map(([postingDate, dateEntries]) => <details className="ledger-date-node" key={postingDate}><summary><span>{dateText(postingDate)}</span><small>{dateEntries.length} lançamento{dateEntries.length === 1 ? "" : "s"}</small></summary><div className="inline-entries-scroll"><table><thead><tr><th>Lançamento</th><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Realizado</th></tr></thead><tbody>{dateEntries.map(entry => <tr key={`${entry.entry_number}-${entry.lot_code}-${entry.history ?? ""}`}><td>{entry.entry_number || entry.lot_code || "—"}</td><td className="entry-history">{entry.history ?? "—"}</td><td>{money.format(entry.debitAmount)}</td><td>{money.format(entry.creditAmount)}</td><td className={entry.realized >= 0 ? "positive-text" : "negative-text"}>{money.format(entry.realized)}</td></tr>)}</tbody></table></div></details>)}</div></details>)}</div> : null}</div>; })}</div> : null}</div>)}</section></section>;
  function StandardLedgerGroupDetail() {
    if (!accounts) return <div className="inline-loading">Não foi possível carregar as PAs do grupo.</div>;
    const months = accounts.months;
    const columnSpan = 1 + months.length * 3 + 1;
    const ledgerCells = (row: Row) => <>{row.values.flatMap((value, index) => { const prior = index ? row.values[index - 1].actual : 0; const change = index ? value.actual - prior : value.actual; return [<td className={index ? "month-start" : ""} key={value.month + "-value"}>{money.format(value.actual)}</td>, <td className={change >= 0 ? "positive-text" : "negative-text"} key={value.month + "-variation"}>{money.format(change)}</td>, <td key={value.month + "-percent"}>{index ? pct(ratio(prior, value.actual)) : "0,0%"}</td>]; })}<td className="total-cell month-start">{money.format(row.actual)}</td></>;
    return <section className="group-detail group-ledger-detail">
      <header><div><b>LIVRO RAZÃO — {group}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <div className="group-detail-scroll"><table className="group-detail-table ledger-detail-table">
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={3} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" rowSpan={2}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["VALOR", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title}>{title}</th>))}</tr></thead>
        <tbody>{accounts.rows.flatMap(pa => {
          const paOpen = groupPa === pa.label;
          const accountRows = !paOpen ? [] : loadingGroupPa ? [<tr className="account-leaf-row" key={pa.label + "-loading"}><td colSpan={columnSpan}><div className="inline-loading">Carregando contas…</div></td></tr>] : !groupPaAccounts ? [<tr className="account-leaf-row" key={pa.label + "-error"}><td colSpan={columnSpan}><div className="inline-loading">Não foi possível carregar as contas.</div></td></tr>] : groupPaAccounts.rows.flatMap(account => {
            const [code, ...nameParts] = account.label.split(" — ");
            const accountOpen = groupAccount === code;
            const entryRows = !accountOpen ? [] : [<tr className="account-leaf-row budget-account-detail-row" key={pa.label + "-" + code + "-entries"}><td colSpan={columnSpan}><div className="budget-account-entries">{loadingGroupEntries ? <div className="inline-loading">Carregando lançamentos…</div> : groupEntries.length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta conta.</div> : renderLedgerEntriesByDescription(groupEntries)}</div></td></tr>];
            return [<tr className="account-budget-row" key={pa.label + "-" + account.label} onClick={() => openLedgerGroupAccount(code)}><td><span className="sector-trigger-icon">{accountOpen ? "−" : "+"}</span>{nameParts.join(" — ") || code}<small className="account-inline-code">CONTA {code}</small></td>{ledgerCells(account)}</tr>, ...entryRows];
          });
          return [<tr className="pa-budget-row" key={pa.label} onClick={() => openLedgerGroupPa(pa.label)}><td><span className="sector-trigger-icon">{paOpen ? "−" : "+"}</span>PA {paText(pa.label)}</td>{ledgerCells(pa)}</tr>, ...accountRows];
        })}</tbody>
      </table></div>
    </section>;
  }
  const accountDetail = !accounts ? <div className="inline-loading">Não foi possível carregar os subgrupos.</div> : <section className="group-detail"><header><b>SUBGRUPOS — {group}</b><button onClick={() => { setGroup(null); setAccounts(null); setSubgroup(null); setSubgroupAccounts(null); setGroupPa(null); setGroupPaAccounts(null); }}>Fechar detalhes</button></header><div className="group-detail-scroll"><table className="group-detail-table"><thead><tr><th>Subgrupo</th>{isBudget ? <><th>Orçado acumulado</th><th>Realizado acumulado</th><th>Variação</th></> : <th>Valor acumulado</th>}</tr></thead><tbody>{accounts.rows.map(row => <><tr className="subgroup-row" key={row.label}><td onClick={() => openSubgroup(row.label)} title="Clique para abrir as PAs"><span className="sector-trigger-icon">{subgroup === row.label ? "−" : "+"}</span>{row.label}</td>{isBudget ? <><td>{money.format(row.budget)}</td><td>{money.format(row.actual)}</td><td className={row.variation >= 0 ? "positive-text" : "negative-text"}>{money.format(row.variation)}</td></> : <td>{money.format(row.actual)}</td>}</tr>{subgroup === row.label ? <tr className="account-leaf-row" key={`${row.label}-pas`}><td colSpan={isBudget ? 4 : 2}>{loadingSubgroup ? <div className="inline-loading">Carregando PAs…</div> : !subgroupAccounts ? <div className="inline-loading">Não foi possível carregar as PAs.</div> : <div className="account-leaves">{subgroupAccounts.rows.map(pa => <><div className="pa-leaf" key={pa.label} onClick={() => openGroupPa(pa.label)}><span><i>{groupPa === pa.label ? "−" : "+"}</i>{String(Number(pa.label)).padStart(2, "0")}</span><strong className={isBudget && pa.variation < 0 ? "negative-text" : "positive-text"}>{money.format(isBudget ? pa.variation : pa.actual)}</strong></div>{groupPa === pa.label ? <div className="group-pa-accounts">{loadingGroupPa ? <div className="inline-loading">Carregando contas…</div> : !groupPaAccounts ? <div className="inline-loading">Não foi possível carregar as contas.</div> : groupPaAccounts.rows.map(account => { const [code, ...nameParts] = account.label.split(" — "); const name = nameParts.join(" — ") || code; return <div className="account-branch" key={account.label}><span className="account-name">{name}</span><div className="account-code"><span>CONTA {code}</span><span>ORÇADO {money.format(account.budget)}</span><span>REALIZADO {money.format(account.actual)}</span><strong className={account.variation >= 0 ? "positive-text" : "negative-text"}>VARIAÇÃO {money.format(account.variation)}</strong></div></div>; })}</div> : null}</>)}</div>}</td></tr> : null}</>)}</tbody></table></div></section>;
  const sectorDetail = !ledger ? <div className="inline-loading">Não foi possível carregar as PAs.</div> : <section className="inline-ledger-detail"><header className="inline-ledger-header"><div><p className="eyebrow">LIVRO RAZÃO — {ledger.sectorName}</p><h4>{ledger.total.toLocaleString("pt-BR")} lançamentos até {dateText(ledger.reportingDate)}</h4></div><button onClick={clearDetails}>Fechar detalhes</button></header><section className="pa-hierarchy"><p className="pa-hierarchy-note">Abra uma PA, escolha o mês e depois a conta para ver os lançamentos.</p>{ledger.pas.map(pa => { const entriesByMonth = entries.reduce<Record<string, Entry[]>>((result, entry) => { const monthKey = entry.posting_date.slice(0, 7); (result[monthKey] ??= []).push(entry); return result; }, {}); return <div className="pa-node" key={pa.paCode}><button className="pa-trigger" onClick={() => openPa(pa.paCode)}><span><i>{activePa === pa.paCode ? "−" : "+"}</i> PA {paText(pa.paCode)}</span><small>{pa.total.toLocaleString("pt-BR")} lançamentos</small><strong className={pa.realized >= 0 ? "positive-text" : "negative-text"}>{money.format(pa.realized)}</strong></button>{activePa === pa.paCode ? <div className="pa-entries">{loadingPa ? <div className="inline-loading">Carregando lançamentos…</div> : Object.keys(entriesByMonth).length === 0 ? <div className="inline-loading">Nenhum lançamento encontrado para esta PA.</div> : <div className="ledger-month-list">{Object.entries(entriesByMonth).map(([monthKey, monthEntries]) => { const accountsByCode = monthEntries.reduce<Record<string, Entry[]>>((result, entry) => { (result[entry.account_code] ??= []).push(entry); return result; }, {}); return <details className="ledger-month-node" key={monthKey}><summary><span>{month.format(new Date(`${monthKey}-01T12:00:00Z`)).replace(".", "").toUpperCase()}/{monthKey.slice(0, 4)}</span><small>{monthEntries.length} lançamentos</small></summary><div className="ledger-month-accounts">{Object.entries(accountsByCode).map(([accountCode, accountEntries]) => <details className="ledger-entry-account-node" key={accountCode}><summary><span><b>{accountCode}</b><small>{accountEntries[0]?.account_name ?? ""}</small></span><em>{accountEntries.length} lançamento{accountEntries.length === 1 ? "" : "s"}</em></summary><div className="inline-entries-scroll"><table><thead><tr><th>Data</th><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Realizado</th></tr></thead><tbody>{accountEntries.map(entry => <tr key={`${entry.posting_date}-${entry.entry_number}-${entry.lot_code}`}><td>{dateText(entry.posting_date)}</td><td className="entry-history">{entry.history ?? "—"}</td><td>{money.format(entry.debitAmount)}</td><td>{money.format(entry.creditAmount)}</td><td className={entry.realized >= 0 ? "positive-text" : "negative-text"}>{money.format(entry.realized)}</td></tr>)}</tbody></table></div></details>)}</div></details>; })}</div>}</div> : null}</div>; })}</section></section>;
  function StandardLedgerSectorDetail() {
    if (!ledger || !ledgerSectorGroups) return <div className="inline-loading">Não foi possível carregar os grupos do setor.</div>;
    const months = ledgerSectorGroups.months;
    const columnSpan = 1 + months.length * 3 + 1;
    const loadingRow = (key: string, message: string) => <tr className="account-leaf-row" key={key}><td colSpan={columnSpan}><div className="inline-loading">{message}</div></td></tr>;
    const ledgerCells = (row: Row) => <>{row.values.flatMap((value, index) => { const prior = index ? row.values[index - 1].actual : 0; const change = index ? value.actual - prior : value.actual; return [<td className={index ? "month-start" : ""} key={value.month + "-value"}>{money.format(value.actual)}</td>, <td className={change >= 0 ? "positive-text" : "negative-text"} key={value.month + "-variation"}>{money.format(change)}</td>, <td key={value.month + "-percent"}>{index ? pct(ratio(prior, value.actual)) : "0,0%"}</td>]; })}<td className="total-cell month-start">{money.format(row.actual)}</td></>;
    return <section className="group-detail group-ledger-detail">
      <header><div><b>LIVRO RAZÃO — {ledger.sectorName}</b><p>Detalhamento por conta, PA, mês e data, com valores por mês e acumulado.</p></div><button onClick={clearDetails}>Fechar detalhes</button></header>
      <div className="group-detail-scroll"><table className="group-detail-table ledger-detail-table">
        <thead><tr><th rowSpan={2}>Conta</th>{months.map(monthValue => <th colSpan={3} key={monthValue}>{month.format(new Date(monthValue + "T12:00:00Z")).replace(".", "")}/{monthValue.slice(0, 4)}</th>)}<th className="month-start" rowSpan={2}>Acumulado</th></tr><tr>{months.flatMap((monthValue, index) => ["VALOR", "VARIAÇÃO", "%"].map((title, itemIndex) => <th className={index && itemIndex === 0 ? "month-start" : ""} key={monthValue + title}>{title}</th>))}</tr></thead>
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
  const max = data ? Math.max(...data.rows.map(r => Math.abs(isBudget ? r.variation : r.actual)), 1) : 1;
  if (!session) return <LoginScreen onAuthenticated={(next) => { window.localStorage.setItem("orcamento-session", JSON.stringify(next)); setSession(next); }} />;

  const renderOverviewStateShell = (content: ReactNode) => <main className="dashboard-shell app-with-sidebar">
    <AppSideNavigation active="analysis" analysisView={isBudget ? "budget" : "ledger"} analysisDimension={dimension} />
    <header className="topbar"><div className="topbar-title"><p>CONTROLE ORÇAMENTÁRIO</p><h1>Orçamento e Razão</h1></div><div className="connected-user"><span>Usuário conectado</span><strong>{session.viewer.employeeName}</strong></div></header>
    <section className="dashboard-heading"><div><p className="eyebrow">VISÃO CONSOLIDADA</p><h2>{views.find(v => v.id === view)?.label}</h2></div></section>
    <nav className="view-navigation">{views.map(v => <button key={v.id} className={view === v.id ? "selected" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}</nav>
    <section className="filters"><label>Ano<select value={year} onChange={e => setYear(Number(e.target.value))}>{options.years.map(y => <option key={y}>{y}</option>)}</select></label><label>PA<select value={filters.pa} onChange={e => setFilters(x => ({ ...x, pa: e.target.value }))}><option value="">Todos</option>{options.pas.map(p => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}</select></label><label>Setor<select value={filters.sector} onChange={e => setFilters(x => ({ ...x, sector: e.target.value }))}><option value="">Todos</option>{options.sectors.map(s => <option key={s}>{s}</option>)}</select></label><label>Período<select value={filters.period} onChange={e => setFilters(x => ({ ...x, period: e.target.value }))}><option value="">Acumulado</option>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(m => <option key={m} value={`${year}-${m}`}>{month.format(new Date(`${year}-${m}-01T12:00:00Z`))}</option>)}</select></label><button className="clear-filters" onClick={() => setFilters({ pa: "", sector: "", period: "", account: "" })}>Limpar filtros</button></section>
    {error ? <section className="message error-message" role="alert">{error}</section> : null}
    {content}
  </main>;

  if (loadingOverview || (!data && !overviewError)) return renderOverviewStateShell(<section className="dashboard-state dashboard-loading-state" aria-busy="true" aria-live="polite"><div><p className="eyebrow">ATUALIZANDO PAINEL</p><h3>Carregando informações</h3><p>Estamos atualizando os indicadores e o detalhamento para os filtros selecionados.</p></div><div className="dashboard-skeleton" aria-hidden="true"><i /><i /><i /><i /><b /><b /></div></section>);
  if (overviewError) return renderOverviewStateShell(<section className="dashboard-state dashboard-error-state" role="alert"><div><p className="eyebrow">ATUALIZAÇÃO INDISPONÍVEL</p><h3>Não foi possível carregar o painel</h3><p>{overviewError}</p></div><button type="button" className="state-action" onClick={() => setOverviewRequestKey(key => key + 1)}>Tentar novamente</button></section>);
  if (data && data.rows.length === 0) return renderOverviewStateShell(<section className="dashboard-state dashboard-empty-state"><div><p className="eyebrow">SEM RESULTADOS</p><h3>Nenhum dado encontrado</h3><p>Não há informações para os filtros selecionados. Ajuste os filtros ou volte para a visão completa.</p></div><button type="button" className="state-action" onClick={() => setFilters({ pa: "", sector: "", period: "", account: "" })}>Limpar filtros</button></section>);
return <main className="dashboard-shell app-with-sidebar"><AppSideNavigation active="analysis" analysisView={isBudget ? "budget" : "ledger"} analysisDimension={dimension} /><header className="topbar"><div className="topbar-title"><p>CONTROLE ORÇAMENTÁRIO</p><h1>Orçamento e Razão</h1></div><div className="connected-user"><span>Usuário conectado</span><strong>{session.viewer.employeeName}</strong></div></header><section className="dashboard-heading"><div><p className="eyebrow">VISÃO CONSOLIDADA</p><h2>{views.find(v => v.id === view)?.label}</h2></div></section><nav className="view-navigation">{views.map(v => <button key={v.id} className={view === v.id ? "selected" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}</nav><section className="filters"><label>Ano<select value={year} onChange={e => setYear(Number(e.target.value))}>{options.years.map(y => <option key={y}>{y}</option>)}</select></label><label>PA<select value={filters.pa} onChange={e => setFilters(x => ({ ...x, pa: e.target.value }))}><option value="">Todos</option>{options.pas.map(p => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}</select></label><label>Setor<select value={filters.sector} onChange={e => setFilters(x => ({ ...x, sector: e.target.value }))}><option value="">Todos</option>{options.sectors.map(s => <option key={s}>{s}</option>)}</select></label><label>Período<select value={filters.period} onChange={e => setFilters(x => ({ ...x, period: e.target.value }))}><option value="">Acumulado</option>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(m => <option key={m} value={`${year}-${m}`}>{month.format(new Date(`${year}-${m}-01T12:00:00Z`))}</option>)}</select></label><button className="clear-filters" onClick={() => setFilters({ pa: "", sector: "", period: "", account: "" })}>Limpar filtros</button></section>{error ? <section className="message error-message">{error}</section> : null}{data ? <><section className="summary-grid"><article><p>{isBudget ? "ORÇADO ACUMULADO" : "VALOR ACUMULADO"}</p><strong>{money.format(isBudget ? data.totals.budget : data.totals.actual)}</strong></article><article><p>{isBudget ? "REALIZADO ACUMULADO" : "ÚLTIMO LANÇAMENTO"}</p><strong>{isBudget ? money.format(data.totals.actual) : dateText(data.latestLedgerDate)}</strong></article><article><p>{isBudget ? "VARIAÇÃO" : "REFERÊNCIA CONTÁBIL"}</p><strong>{isBudget ? money.format(data.totals.variation) : dateText(data.reportingDate)}</strong></article><article><p>DATA CONTÁBIL DE REFERÊNCIA</p><strong>{dateText(data.reportingDate)}</strong><span>Última referência processada</span></article></section><section className="content-grid"><article className="chart-card"><div className="section-title"><h3>{isBudget ? "Maior desvio" : "Maior movimentação"}</h3></div>{data.rows.slice(0, 8).map(r => { const value = isBudget ? r.variation : r.actual; return <div className="bar-row" key={r.label}><div className="bar-label"><span>{r.label}</span><strong>{money.format(value)}</strong></div><div className="bar-track"><i className="actual-bar" style={{ width: `${Math.max(2, Math.abs(value) / max * 100)}%` }} /></div></div>; })}</article></section><section className="table-card"><div className="section-title"><div><p className="eyebrow">DETALHAMENTO</p><h3>{label} por mês</h3></div></div><p className="main-table-scroll-hint">Role horizontalmente para ver todos os meses e o acumulado.</p><div className="table-scroll main-monthly-scroll" role="region" tabIndex={0} aria-label={`Tabela de ${label.toLowerCase()} por mês`}><table className={`monthly-table main-monthly-table ${isBudget ? "" : "ledger-table"}`}><caption className="sr-only">Detalhamento de {label.toLowerCase()} por mês. Use a rolagem horizontal para consultar todos os períodos e o acumulado.</caption><thead><tr><th rowSpan={2} scope="col">{label}</th>{data.months.map((m, i) => <th scope="colgroup" key={m} className={i ? "month-start" : ""} colSpan={isBudget ? 4 : 3}>{month.format(new Date(`${m}T12:00:00Z`)).replace(".", "")}/{m.slice(0, 4)}</th>)}<th scope="colgroup" className="month-start" colSpan={isBudget ? 4 : 1}>Acumulado</th></tr><tr>{data.months.flatMap((m, i) => (isBudget ? ["ORÇADO", "REALIZADO", "VARIAÇÃO", "%"] : ["VALOR", "VARIAÇÃO", "%"]).map((x, n) => <th scope="col" className={i && n === 0 ? "month-start" : ""} key={`${m}${x}`}>{x}</th>))}<th scope="col" className="month-start">{isBudget ? "ORÇADO" : "VALOR"}</th>{isBudget ? <><th scope="col">REALIZADO</th><th scope="col">VARIAÇÃO</th><th scope="col">%</th></> : null}</tr></thead><tbody>{data.rows.flatMap((row, rowIndex) => { const opened = dimension === "group" ? group === row.label : sector === row.label; const cols = 1 + data.months.length * (isBudget ? 4 : 3) + (isBudget ? 4 : 1); return [<tr key={row.label}><th scope="row"><button type="button" className="sector-trigger main-sector-trigger" aria-expanded={opened} aria-controls={`monthly-detail-${dimension}-${rowIndex}`} aria-label={`${opened ? "Fechar" : "Abrir"} detalhamento de ${row.label}`} onClick={() => dimension === "group" ? openGroup(row.label) : openSector(row.label)}><span>{row.label}</span><span className="sector-trigger-icon" aria-hidden="true">{opened ? "−" : "+"}</span></button></th>{row.values.flatMap((v, i) => { const change = v.actual - v.budget, prior = i ? row.values[i - 1].actual : 0, ledgerChange = i ? v.actual - prior : v.actual; return isBudget ? [<td className={i ? "month-start" : ""} key={`${v.month}b`}>{money.format(v.budget)}</td>, <td key={`${v.month}a`}>{money.format(v.actual)}</td>, <td key={`${v.month}v`}>{money.format(change)}</td>, <td key={`${v.month}p`}>{pct(ratio(v.budget, v.actual))}</td>] : [<td className={i ? "month-start" : ""} key={`${v.month}a`}>{money.format(v.actual)}</td>, <td key={`${v.month}v`}>{money.format(ledgerChange)}</td>, <td key={`${v.month}p`}>{i ? pct(ratio(prior, v.actual)) : "0,0%"}</td>]; })}{isBudget ? <><td className="total-cell month-start">{money.format(row.budget)}</td><td className="total-cell">{money.format(row.actual)}</td><td className="total-cell">{money.format(row.variation)}</td><td className="total-cell">{pct(row.variationPercent)}</td></> : <td className="total-cell month-start">{money.format(row.actual)}</td>}</tr>, opened ? <tr className="inline-ledger-row" key={`${row.label}detail`}><td id={`monthly-detail-${dimension}-${rowIndex}`} colSpan={cols}>{dimension === "group" ? (loadingGroup ? <div className="inline-loading">Carregando contas do grupo…</div> : (isBudget ? budgetGroupDetail : <StandardLedgerGroupDetail />)) : (isBudget ? (loadingBudgetSector ? <div className="inline-loading">Carregando grupos do setor…</div> : budgetSectorDetail) : (loadingLedger ? <div className="inline-loading">Carregando grupos do setor…</div> : <StandardLedgerSectorDetail />))}</td></tr> : null].filter(Boolean); })}</tbody></table></div></section></> : null}</main>;
}
