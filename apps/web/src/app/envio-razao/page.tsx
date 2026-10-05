"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import "./upload.css";
import { LoginSession } from "../login-screen";
import { AppSideNavigation } from "../app-side-navigation";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const shortDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
type Result = { recordCount: number; referenceDate: string; uploadedAt: string };
type HistoryItem = { id: string; originalFilename: string; recordCount: number; referenceDate: string; uploadedAt: string; employeeName: string };

export default function EnvioRazao() {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canUpload = Boolean(session?.viewer.fullAccess || session?.viewer.roles.some((role) => role.toUpperCase().includes("CONTABILIDADE")));
  const lastImport = history[0];

  useEffect(() => {
    const raw = window.localStorage.getItem("orcamento-session");
    if (!raw) return;
    try { const saved = JSON.parse(raw) as LoginSession; if (new Date(saved.expiresAt) > new Date()) setSession(saved); }
    catch { window.localStorage.removeItem("orcamento-session"); }
  }, []);

  const loadHistory = async (activeSession: LoginSession) => {
    try {
      const response = await fetch(`${api}/ledger-upload/history`, { headers: { authorization: `Bearer ${activeSession.token}` } });
      if (!response.ok) throw new Error();
      setHistory(await response.json()); setHistoryError(null);
    } catch { setHistoryError("Não foi possível carregar o histórico de importações."); }
  };
  useEffect(() => { if (session && canUpload) void loadHistory(session); }, [session, canUpload]);

  const selectFile = (candidate: File | null) => {
    setError(null); setResult(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) { setFile(null); setError("Formato inválido. Envie o Livro Razão em .xlsx."); return; }
    setFile(candidate);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0] ?? null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!file || !session) return;
    setSending(true); setError(null); setResult(null);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${api}/ledger-upload`, { method: "POST", headers: { authorization: `Bearer ${session.token}` }, body });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Não foi possível importar o arquivo.");
      setResult(data); setFile(null); if (input.current) input.current.value = ""; await loadHistory(session);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível importar o arquivo."); }
    finally { setSending(false); }
  };
  const reprocess = async (item: HistoryItem) => {
    if (!session || !window.confirm(`Reprocessar ${item.originalFilename}? Uma nova carga auditável será criada.`)) return;
    setReprocessingId(item.id); setError(null);
    try {
      const response = await fetch(`${api}/ledger-upload/${encodeURIComponent(item.id)}/reprocess`, { method: "POST", headers: { authorization: `Bearer ${session.token}` } });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Não foi possível reprocessar o arquivo.");
      setResult(data); await loadHistory(session);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível reprocessar o arquivo."); }
    finally { setReprocessingId(null); }
  };

  if (!session) return <main className="upload-shell"><section className="upload-card"><h1>Sessão não encontrada</h1><p>Entre no dashboard antes de enviar o Livro Razão.</p><a href="/">Ir para login</a></section></main>;
  if (!canUpload) return <main className="upload-shell"><section className="upload-card"><p className="upload-eyebrow">LIVRO RAZÃO</p><h1>Acesso restrito</h1><p>Somente perfis da Contabilidade podem enviar o arquivo diário.</p><a href="/">Voltar ao dashboard</a></section></main>;

  return <><AppSideNavigation active="import" /><main className="upload-shell app-with-sidebar"><section className="upload-page">
    <header className="upload-header"><div><p className="upload-eyebrow">IMPORTAÇÕES</p><h1>Livro Razão</h1><p>Envio, validação e histórico dos arquivos contábeis diários.</p></div><a href="/">Abrir análises</a></header>
    <section className="import-status"><strong>◷ Envio diário até as 09:00</strong><span>O arquivo deve conter a aba <b>CTBLivroRazaoAnalitico</b> e será validado antes da atualização dos dados.</span></section>
    <section className="import-metrics"><article><span>Responsável pelo envio</span><strong>Contabilidade</strong><small>perfis autorizados</small></article><article><span>Última referência</span><strong>{lastImport ? shortDate.format(new Date(`${lastImport.referenceDate}T12:00:00Z`)) : "—"}</strong><small>{lastImport ? lastImport.employeeName : "sem importações"}</small></article><article><span>Último envio</span><strong>{lastImport ? dateTime.format(new Date(lastImport.uploadedAt)) : "—"}</strong><small>{lastImport ? `${lastImport.recordCount.toLocaleString("pt-BR")} lançamentos` : "aguardando arquivo"}</small></article></section>
    <section className="upload-workspace"><form onSubmit={submit} className="upload-panel"><header><p className="upload-eyebrow">NOVA CARGA</p><h2>Enviar arquivo</h2><span>O arquivo original permanece guardado para rastreabilidade e reprocessamento.</span></header><div className={`dropzone ${dragging ? "dragging" : ""} ${file ? "selected" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="upload-icon">⇧</span><strong>{file ? file.name : "Arraste o arquivo .xlsx aqui"}</strong><p>{file ? `${(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB selecionados` : "ou selecione o Livro Razão no computador"}</p><input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /><button type="button" className="secondary-button" onClick={() => input.current?.click()} disabled={sending}>Selecionar arquivo</button></div><button className="primary-button" disabled={!file || sending}>{sending ? "Validando e importando…" : "Enviar e atualizar dados"}</button></form><aside className="upload-guide"><p className="upload-eyebrow">PROCESSO</p><h2>Como funciona</h2><ol><li><b>Seleção</b><span>A Contabilidade escolhe o Livro Razão gerado pelo sistema terceiro.</span></li><li><b>Validação</b><span>O sistema confere a estrutura do arquivo e identifica os lançamentos.</span></li><li><b>Atualização</b><span>Os dados do dashboard são atualizados com a referência contábil do arquivo.</span></li></ol></aside></section>
    {error ? <p className="upload-message error">{error}</p> : null}{result ? <section className="upload-message success"><strong>✓ Livro Razão importado com sucesso</strong><div><span><small>Lançamentos</small>{result.recordCount.toLocaleString("pt-BR")}</span><span><small>Data contábil</small>{shortDate.format(new Date(`${result.referenceDate}T12:00:00Z`))}</span><span><small>Enviado em</small>{dateTime.format(new Date(result.uploadedAt))}</span></div></section> : null}
    <section className="upload-history"><header><div><p className="upload-eyebrow">RASTREABILIDADE</p><h2>Histórico de importações</h2><span>Últimos 20 arquivos processados pelo sistema.</span></div></header>{historyError ? <p className="history-error">{historyError}</p> : history.length ? <div className="history-scroll"><table><thead><tr><th>Arquivo</th><th>Referência contábil</th><th>Lançamentos</th><th>Enviado por</th><th>Data e hora</th><th></th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.originalFilename}</td><td>{shortDate.format(new Date(`${item.referenceDate}T12:00:00Z`))}</td><td>{item.recordCount.toLocaleString("pt-BR")}</td><td>{item.employeeName}</td><td>{dateTime.format(new Date(item.uploadedAt))}</td><td><button type="button" className="reprocess-action" disabled={reprocessingId === item.id} onClick={() => void reprocess(item)}>{reprocessingId === item.id ? "Reprocessando…" : "Reprocessar"}</button></td></tr>)}</tbody></table></div> : <p className="history-empty">Nenhuma importação de Livro Razão registrada ainda.</p>}</section>
  </section></main></>;
}
