"use client";

import { FormEvent, useEffect, useState } from "react";
import "./login.css";

type Profile = { employeeCode: string; employeeName: string; roles: string[] };
export type LoginSession = { token: string; expiresAt: string; mustChangePassword?: boolean; viewer: { employeeCode: string; employeeName: string; roles: string[]; fullAccess: boolean } };

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: LoginSession) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [pendingSession, setPendingSession] = useState<LoginSession | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [firstAccess, setFirstAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetch(`${api}/access/profiles`).then((response) => response.ok ? response.json() : []).then(setProfiles).catch(() => setProfiles([])); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${api}/auth/${firstAccess ? "bootstrap" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeCode, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Não foi possível entrar.");
      if (body.mustChangePassword) { setPendingSession(body); setPassword(""); }
      else onAuthenticated(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!pendingSession) return;
    setError(null); setLoading(true);
    try {
      const response = await fetch(`${api}/auth/change-password`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${pendingSession.token}` }, body: JSON.stringify({ password: newPassword }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Não foi possível alterar a senha.");
      onAuthenticated(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha."); } finally { setLoading(false); }
  }

  if (pendingSession) return <main className="login-shell"><section className="login-card"><div className="login-brand"><span>◢</span><div><strong>SICOOB</strong><small>Norte MT</small></div></div><p className="eyebrow">SEGURANÇA DA CONTA</p><h1>Crie uma nova senha</h1><p className="login-copy">A senha temporária foi validada. Para continuar, defina uma senha pessoal com no mínimo 8 caracteres.</p><form onSubmit={changePassword}><label>Nova senha<input type="password" value={newPassword} minLength={8} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required /></label>{error ? <p className="login-error">{error}</p> : null}<button disabled={loading}>{loading ? "Aguarde…" : "Salvar e entrar"}</button></form></section></main>;

  return <main className="login-shell"><section className="login-card"><div className="login-brand"><span>◢</span><div><strong>SICOOB</strong><small>Norte MT</small></div></div><p className="eyebrow">CONTROLE ORÇAMENTÁRIO</p><h1>{firstAccess ? "Configurar primeiro acesso" : "Entrar no dashboard"}</h1><p className="login-copy">Use seu perfil e senha para acessar os dados permitidos.</p><form onSubmit={submit}><label>Colaborador<select value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} required><option value="">Selecione seu nome</option>{profiles.map((profile) => <option key={profile.employeeCode} value={profile.employeeCode}>{profile.employeeName}</option>)}</select></label><label>Senha<input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} autoComplete={firstAccess ? "new-password" : "current-password"} required /></label>{error ? <p className="login-error">{error}</p> : null}<button disabled={loading}>{loading ? "Aguarde…" : firstAccess ? "Criar acesso" : "Entrar"}</button></form><button className="first-access-link" type="button" onClick={() => { setFirstAccess((value) => !value); setError(null); setPassword(""); }}>{firstAccess ? "Já tenho senha" : "Primeiro acesso"}</button><p className="login-note">No primeiro acesso, escolha uma senha com no mínimo 8 caracteres.</p></section></main>;
}
