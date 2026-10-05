$projectPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectPath "logs"
$logFile = Join-Path $logPath "ledger-status.log"

New-Item -ItemType Directory -Force -Path $logPath | Out-Null
Set-Location -LiteralPath $projectPath

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Iniciando conferência diária do Livro Razão." | Add-Content -LiteralPath $logFile

& pnpm ledger:status *>&1 | Tee-Object -FilePath $logFile -Append
if ($LASTEXITCODE -ne 0) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Status pendente. Verifique o envio da Contabilidade." | Add-Content -LiteralPath $logFile
  exit $LASTEXITCODE
}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Livro Razão em dia." | Add-Content -LiteralPath $logFile
exit 0
