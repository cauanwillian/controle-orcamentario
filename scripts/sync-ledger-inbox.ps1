$projectPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectPath "logs"
$logFile = Join-Path $logPath "ledger-inbox.log"

New-Item -ItemType Directory -Force -Path $logPath | Out-Null
Set-Location -LiteralPath $projectPath

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Iniciando leitura da pasta de entrada do Livro Razão." | Add-Content -LiteralPath $logFile
& pnpm.cmd ledger:inbox *>&1 | Tee-Object -FilePath $logFile -Append
$result = $LASTEXITCODE
if ($result -ne 0) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] A execução da inbox terminou com erro $result." | Add-Content -LiteralPath $logFile
  exit $result
}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Leitura da inbox concluída." | Add-Content -LiteralPath $logFile
exit 0
