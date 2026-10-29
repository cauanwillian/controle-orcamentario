"use client";

import { useEffect, useRef, useState } from "react";
import "./app-side-navigation.css";
import "./sidebar-layout.css";
import { LoginSession } from "./login-screen";

type Section = "overview" | "analysis" | "import" | "admin";
type AnalysisView = "budget" | "ledger";
type AnalysisDimension = "group" | "sector";
type IconName = "overview" | "budget" | "ledger" | "import" | "admin" | "chevron" | "menu" | "close";

function Icon({ name }: { name: IconName }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const, focusable: false as const };
  if (name === "menu") return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "overview") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  if (name === "budget") return <svg {...common}><path d="M4 5h16v14H4z" /><path d="M4 9h16M8 13h4" /></svg>;
  if (name === "ledger") return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8" /></svg>;
  if (name === "import") return <svg {...common}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v5h14v-5" /></svg>;
  if (name === "admin") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.08h-3v-.08A1.7 1.7 0 0 0 10.66 18.7a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15.04a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.96a1.7 1.7 0 0 0-.34-1.88L6.6 8.02 8.72 5.9l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.74v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15z" /></svg>;
  return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "US";

export function AppSideNavigation({ active, analysisView, analysisDimension }: { active: Section; analysisView?: AnalysisView; analysisDimension?: AnalysisDimension }) {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [expanded, setExpanded] = useState<AnalysisView | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const groupRefs = useRef<Record<AnalysisView, HTMLButtonElement | null>>({ budget: null, ledger: null });

  useEffect(() => {
    const raw = window.localStorage.getItem("orcamento-session");
    if (!raw) return;
    try { const saved = JSON.parse(raw) as LoginSession; if (new Date(saved.expiresAt) > new Date()) setSession(saved); }
    catch { window.localStorage.removeItem("orcamento-session"); }
  }, []);
  useEffect(() => { setExpanded(null); setMobileOpen(false); }, [active, analysisView, analysisDimension]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) { setExpanded(null); setMobileOpen(false); }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const logout = async () => {
    const token = session?.token;
    try { if (token) await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); }
    finally { window.localStorage.removeItem("orcamento-session"); window.location.assign("/"); }
  };
  const userName = session?.viewer.employeeName ?? "Usuário conectado";
  const roleName = session?.viewer.fullAccess ? "Acesso total" : session?.viewer.roles[0] ?? "Perfil de acesso";

  const analysisMenu = (view: AnalysisView, text: string) => {
    const selected = active === "analysis" && analysisView === view;
    const opened = expanded === view;
    return <div className={`side-group ${selected ? "active" : ""}`}>
      <button ref={element => { groupRefs.current[view] = element; }} type="button" className="side-link side-group-trigger" aria-expanded={opened} aria-controls={opened ? `navigation-${view}-children` : undefined} onClick={() => setExpanded(opened ? null : view)}>
        <Icon name={view} /><span>{text}</span><i className={opened ? "open" : ""}><Icon name="chevron" /></i>
      </button>
      {opened ? <div className="side-children" id={`navigation-${view}-children`}>
        {(["group", "sector"] as const).map(dimension => <a key={dimension} aria-current={selected && analysisDimension === dimension ? "page" : undefined} className={selected && analysisDimension === dimension ? "selected" : ""} href={`/?view=${view}-${dimension}`}>{dimension === "group" ? "Grupos" : "Setores"}</a>)}
      </div> : null}
    </div>;
  };

  return <header ref={headerRef} className="app-side-navigation" onKeyDown={event => {
    if (event.key !== "Escape") return;
    if (expanded) { event.preventDefault(); groupRefs.current[expanded]?.focus(); setExpanded(null); }
    else if (mobileOpen) { event.preventDefault(); menuRef.current?.focus(); setMobileOpen(false); }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setExpanded(null); setMobileOpen(false); }
  }}>
    <div className="app-navigation-inner">
      <a className="app-side-logo" href="/visao-geral" aria-label="Ir para Visão geral"><img src="/brand/sicoob-norte-mt.png" alt="Sicoob Norte MT" /></a>
      <button ref={menuRef} type="button" className="app-navigation-toggle" aria-expanded={mobileOpen} aria-controls="app-primary-navigation" onClick={() => { setMobileOpen(!mobileOpen); setExpanded(null); }}><Icon name={mobileOpen ? "close" : "menu"} /><span>Menu</span></button>
      <div id="app-primary-navigation" className={`app-navigation-content ${mobileOpen ? "is-open" : ""}`}>
        <nav aria-label="Áreas principais">
          <a aria-current={active === "overview" ? "page" : undefined} className={`side-link ${active === "overview" ? "active" : ""}`} href="/visao-geral"><Icon name="overview" /><span>Visão geral</span></a>
          {analysisMenu("budget", "Orçamento")}
          {analysisMenu("ledger", "Razão")}
          <a aria-current={active === "import" ? "page" : undefined} className={`side-link ${active === "import" ? "active" : ""}`} href="/envio-razao"><Icon name="import" /><span>Importações</span></a>
          <a aria-current={active === "admin" ? "page" : undefined} className={`side-link ${active === "admin" ? "active" : ""}`} href="/admin"><Icon name="admin" /><span>Administração</span></a>
        </nav>
        <div className="app-side-footer">
          <div className="side-profile"><span className="profile-avatar" aria-hidden="true">{initials(userName)}</span><div><strong title={userName}>{userName}</strong><small>{roleName}</small></div></div>
          <button type="button" onClick={logout} aria-label="Sair do sistema">Sair</button>
        </div>
      </div>
    </div>
  </header>;
}
