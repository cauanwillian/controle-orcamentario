"use client";

import { useEffect, useState } from "react";
import "./app-side-navigation.css";
import "./sidebar-layout.css";
import { LoginSession } from "./login-screen";

type Section = "overview" | "analysis" | "import" | "admin";
type AnalysisView = "budget" | "ledger";
type IconName = "overview" | "budget" | "ledger" | "import" | "admin" | "chevron";

function Icon({ name }: { name: IconName }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "overview") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  if (name === "budget") return <svg {...common}><path d="M4 5h16v14H4z" /><path d="M4 9h16M8 13h4" /></svg>;
  if (name === "ledger") return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8" /></svg>;
  if (name === "import") return <svg {...common}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v5h14v-5" /></svg>;
  if (name === "admin") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.08h-3v-.08A1.7 1.7 0 0 0 10.66 18.7a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15.04a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.96a1.7 1.7 0 0 0-.34-1.88L6.6 8.02 8.72 5.9l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.74v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15z" /></svg>;
  return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "US";

export function AppSideNavigation({ active, analysisView }: { active: Section; analysisView?: AnalysisView }) {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [expanded, setExpanded] = useState<AnalysisView | null>(active === "analysis" ? analysisView ?? "budget" : null);

  useEffect(() => {
    const raw = window.localStorage.getItem("orcamento-session");
    if (!raw) return;
    try { const saved = JSON.parse(raw) as LoginSession; if (new Date(saved.expiresAt) > new Date()) setSession(saved); }
    catch { window.localStorage.removeItem("orcamento-session"); }
  }, []);
  useEffect(() => { if (active === "analysis" && analysisView) setExpanded(analysisView); }, [active, analysisView]);

  const logout = async () => {
    const token = session?.token;
    try { if (token) await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); }
    finally { window.localStorage.removeItem("orcamento-session"); window.location.assign("/"); }
  };
  const userName = session?.viewer.employeeName ?? "Usuário conectado";
  const roleName = session?.viewer.fullAccess ? "Acesso total" : session?.viewer.roles[0] ?? "Perfil de acesso";

  return <aside className="app-side-navigation">
    <a className="app-side-logo" href="/visao-geral" aria-label="Ir para Visão geral"><img src="/brand/sicoob-norte-mt.png" alt="Sicoob Norte MT" /></a>
    <nav aria-label="Áreas principais">
      <a className={`side-link ${active === "overview" ? "active" : ""}`} href="/visao-geral"><Icon name="overview" /><span>Visão geral</span></a>
      <div className={`side-group ${active === "analysis" && analysisView === "budget" ? "active" : ""}`}><button type="button" className="side-link side-group-trigger" onClick={() => setExpanded(expanded === "budget" ? null : "budget")}><Icon name="budget" /><span>Orçamento</span><i className={expanded === "budget" ? "open" : ""}><Icon name="chevron" /></i></button>{expanded === "budget" ? <div className="side-children"><a className={active === "analysis" && analysisView === "budget" ? "selected" : ""} href="/?view=budget-group">Grupos</a><a href="/?view=budget-sector">Setores</a></div> : null}</div>
      <div className={`side-group ${active === "analysis" && analysisView === "ledger" ? "active" : ""}`}><button type="button" className="side-link side-group-trigger" onClick={() => setExpanded(expanded === "ledger" ? null : "ledger")}><Icon name="ledger" /><span>Razão</span><i className={expanded === "ledger" ? "open" : ""}><Icon name="chevron" /></i></button>{expanded === "ledger" ? <div className="side-children"><a className={active === "analysis" && analysisView === "ledger" ? "selected" : ""} href="/?view=ledger-group">Grupos</a><a href="/?view=ledger-sector">Setores</a></div> : null}</div>
      <a className={`side-link ${active === "import" ? "active" : ""}`} href="/envio-razao"><Icon name="import" /><span>Importações</span></a>
      <a className={`side-link ${active === "admin" ? "active" : ""}`} href="/admin"><Icon name="admin" /><span>Administração</span></a>
    </nav>
    <footer className="app-side-footer"><div className="side-profile"><span className="profile-avatar">{initials(userName)}</span><div><strong>{userName}</strong><small>{roleName}</small></div></div><button type="button" onClick={logout}>Sair do sistema</button></footer>
  </aside>;
}
