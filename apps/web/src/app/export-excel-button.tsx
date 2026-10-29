"use client";

import { useRef, useState } from "react";
import { downloadExcelReport } from "./export-report";
import type { ExportReport } from "./export-report";
import "./export-excel-button.css";

export function ExportExcelButton({ buildReport, disabled = false, label = "Exportar Excel" }: { buildReport: () => ExportReport; disabled?: boolean; label?: string }) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const report = buildReport();
      await downloadExcelReport(report);
      setMessage("Arquivo Excel gerado.");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error && /Não há dados|valor inválido|colunas/.test(error.message) ? error.message : "Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return <div className="excel-export-control">
    <button className="excel-export-button" type="button" disabled={disabled || busy} aria-busy={busy} onClick={download} title="Exportar os dados com os filtros aplicados">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></svg><span>{busy ? "Gerando Excel…" : label}</span>
    </button>
    {message ? <span className={`excel-export-feedback${failed ? " is-error" : ""}`} role={failed ? "alert" : "status"}>{message}</span> : null}
  </div>;
}
