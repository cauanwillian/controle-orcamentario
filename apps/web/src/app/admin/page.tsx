"use client";

import { useEffect, useState } from "react";
import "./users.css";
import { LoginSession } from "../login-screen";
import { AppSideNavigation } from "../app-side-navigation";

type User = { employeeCode: string; employeeName: string; active: boolean; roles: string[]; sectors: string[]; passwordConfigured: boolean };
type Role = { name: string; sectors: string[] };
type Audit = { createdAt: string; actorName: string; targetName: string; action: string; details: { roles?: string[] } };
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function UserAdministration() {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [sectorFilter, setSectorFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const headers = session ? { authorization: `Bearer ${session.token}`, "content-type": "application/json" } : undefined;

  const load = async (current = session) => {
    if (!current) return;
    setError(null);
    try {
      const auth = { authorization: `Bearer ${current.token}` };
      const [usersResponse, rolesResponse, auditResponse] = await Promise.all([
        fetch(`${api}/admin/users`, { headers: auth }), fetch(`${api}/admin/roles`, { headers: auth }), fetch(`${api}/admin/audit`, { headers: auth }),
      ]);
      if (!usersResponse.ok || !rolesResponse.ok || !auditResponse.ok) throw new Error("Você não possui permissão para administrar usuários.");
      setUsers(await usersResponse.json()); setRoles(await rolesResponse.json()); setAudit(await auditResponse.json());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar os usuários."); }
  };

  useEffect(() => {
    const raw = window.localStorage.getItem("orcamento-session");
    if (!raw) return;
    try { const saved = JSON.parse(raw) as LoginSession; if (new Date(saved.expiresAt) > new Date()) { setSession(saved); void load(saved); } }
    catch { window.localStorage.removeItem("orcamento-session"); }
  }, []);

  const updateUser = (employeeCode: string, patch: Partial<User>) => setUsers((current) => current.map((user) => user.employeeCode === employeeCode ? { ...user, ...patch } : user));
  const save = async (url: string, body: unknown, success: string) => {
    setError(null); setMessage(null);
    const response = await fetch(`${api}${url}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!response.ok) { const result = await response.json().catch(() => ({})); setError(result.message ?? "Não foi possível salvar a alteração."); return; }
    setMessage(success); await load();
  };

  const sectors = [...new Set(users.flatMap((user) => user.sectors).filter((sector) => sector && sector !== "TUDO"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const visibleUsers = users.filter((user) => sectorFilter === "all" ? true : sectorFilter === "full" ? user.sectors.includes("TUDO") : sectorFilter === "unassigned" ? user.sectors.length === 0 : user.sectors.includes(sectorFilter));
  const countFor = (filter: string) => users.filter((user) => filter === "full" ? user.sectors.includes("TUDO") : filter === "unassigned" ? user.sectors.length === 0 : user.sectors.includes(filter)).length;
  const selectedName = sectorFilter === "all" ? "Todos os colaboradores" : sectorFilter === "full" ? "Acesso total" : sectorFilter === "unassigned" ? "Sem setor" : sectorFilter;
  const activeUsers = users.filter((user) => user.active).length;
  const pendingPasswords = users.filter((user) => !user.passwordConfigured).length;
  const fullAccessUsers = users.filter((user) => user.sectors.includes("TUDO")).length;

  if (!session) return <main className="admin-shell"><section className="empty-admin"><h1>Sessão não encontrada</h1><p>Entre no dashboard antes de acessar a administração.</p><a href="/">Ir para login</a></section></main>;
  if (!session.viewer.fullAccess) return <main className="admin-shell"><section className="empty-admin"><h1>Acesso restrito</h1><p>Seu perfil não possui acesso total para administrar usuários.</p><a href="/">Voltar ao dashboard</a></section></main>;

  return <><AppSideNavigation active="admin" /><main className="admin-shell app-with-sidebar"><div className="admin-page">
    <header className="admin-header"><div><p className="admin-eyebrow">ADMINISTRAÇÃO</p><h1>Colaboradores e permissões</h1><p>Organize acessos por setor, cargos e níveis de responsabilidade.</p></div><a href="/">Voltar ao dashboard</a></header>
    <section className="admin-metrics"><article><span>Colaboradores ativos</span><strong>{activeUsers}</strong><small>de {users.length} cadastrados</small></article><article><span>Acesso total</span><strong>{fullAccessUsers}</strong><small>perfis sem restrição por setor</small></article><article className={pendingPasswords ? "attention" : ""}><span>Senhas pendentes</span><strong>{pendingPasswords}</strong><small>colaboradores sem senha definida</small></article><article><span>Setores disponíveis</span><strong>{sectors.length}</strong><small>para organização dos acessos</small></article></section>
    {error ? <p className="notice error">{error}</p> : null}{message ? <p className="notice success">{message}</p> : null}
    <section className="filter-section"><div><strong>Filtrar por setor</strong><span>Selecione uma categoria para ajustar os colaboradores.</span></div><div className="filter-chips"><button className={sectorFilter === "all" ? "selected" : ""} onClick={() => setSectorFilter("all")}>Todos <b>{users.length}</b></button><button className={sectorFilter === "full" ? "selected" : ""} onClick={() => setSectorFilter("full")}>Acesso total <b>{countFor("full")}</b></button>{sectors.map((sector) => <button key={sector} className={sectorFilter === sector ? "selected" : ""} onClick={() => setSectorFilter(sector)}>{sector} <b>{countFor(sector)}</b></button>)}{users.some((user) => user.sectors.length === 0) ? <button className={sectorFilter === "unassigned" ? "selected" : ""} onClick={() => setSectorFilter("unassigned")}>Sem setor <b>{countFor("unassigned")}</b></button> : null}</div></section>
    <section className="admin-table-card"><header><div><p className="admin-eyebrow">{selectedName}</p><h2>{visibleUsers.length} colaborador{visibleUsers.length === 1 ? "" : "es"}</h2></div><span>Alterações de permissão encerram sessões anteriores.</span></header><div className="admin-table-scroll"><table><thead><tr><th>Colaborador</th><th>Status</th><th>Senha</th><th>Cargos e setores</th><th>Ações</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.employeeCode}><td><strong>{user.employeeName}</strong><small>Código {user.employeeCode}</small></td><td><button className={`status ${user.active ? "active" : "inactive"}`} onClick={() => save(`/admin/users/${encodeURIComponent(user.employeeCode)}/active`, { active: !user.active }, user.active ? "Colaborador desativado." : "Colaborador ativado.")}>{user.active ? "Ativo" : "Inativo"}</button></td><td><span className={`password-state ${user.passwordConfigured ? "configured" : "pending"}`}>{user.passwordConfigured ? "Definida" : "Pendente"}</span><button className="text-action" onClick={() => { const password = window.prompt(`Nova senha para ${user.employeeName} (mínimo de 8 caracteres):`); if (password) void save(`/admin/users/${encodeURIComponent(user.employeeCode)}/password`, { password }, "Senha redefinida. O colaborador deverá criar uma nova senha no próximo acesso."); }}>Redefinir senha</button></td><td><select multiple value={user.roles} onChange={(event) => updateUser(user.employeeCode, { roles: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{roles.map((role) => <option key={role.name} value={role.name}>{role.name} — {role.sectors.join(", ") || "Sem setores"}</option>)}</select><div className="sector-tags">{user.sectors.includes("TUDO") ? <span>Acesso total</span> : user.sectors.length ? user.sectors.map((sector) => <span key={sector}>{sector}</span>) : <em>Sem setor permitido</em>}</div></td><td><button className="save-action" onClick={() => void save(`/admin/users/${encodeURIComponent(user.employeeCode)}/roles`, { roles: user.roles }, "Permissões atualizadas. As sessões anteriores foram encerradas.")}>Salvar permissões</button></td></tr>)}{visibleUsers.length === 0 ? <tr><td colSpan={5} className="empty-row">Não há colaboradores neste filtro.</td></tr> : null}</tbody></table></div></section>
    <section className="audit-card"><header><div><p className="admin-eyebrow">AUDITORIA</p><h2>Histórico de alterações</h2></div><span>Últimos {audit.length} registros</span></header><div className="admin-table-scroll"><table><thead><tr><th>Data e hora</th><th>Responsável</th><th>Colaborador</th><th>Alteração</th></tr></thead><tbody>{audit.map((item, index) => <tr key={`${item.createdAt}-${index}`}><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</td><td>{item.actorName}</td><td>{item.targetName}</td><td>{item.action}{item.details.roles?.length ? `: ${item.details.roles.join(", ")}` : ""}</td></tr>)}{audit.length === 0 ? <tr><td colSpan={4} className="empty-row">As próximas alterações aparecerão aqui.</td></tr> : null}</tbody></table></div></section>
  </div></main></>;
}
