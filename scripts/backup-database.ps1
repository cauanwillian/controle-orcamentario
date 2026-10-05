$projectPath = Split-Path -Parent $PSScriptRoot
$backupPath = Join-Path $projectPath "backups"
$retentionDays = 30

if (-not $env:DATABASE_URL) {
  $envFile = Join-Path $projectPath ".env"
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line) { $env:DATABASE_URL = $line.Substring("DATABASE_URL=".Length) }
  }
}

if (-not $env:DATABASE_URL) { throw "DATABASE_URL não foi definida. Configure o arquivo .env antes de executar o backup." }

New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupFile = Join-Path $backupPath "controle-orcamentario_$timestamp.dump"

& pg_dump --dbname=$env:DATABASE_URL --format=custom --file=$backupFile
if ($LASTEXITCODE -ne 0) { throw "O pg_dump retornou erro ao gerar o backup." }

$expiredBackups = Get-ChildItem -LiteralPath $backupPath -Filter "controle-orcamentario_*.dump" -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) }
foreach ($expiredBackup in $expiredBackups) {
  Remove-Item -LiteralPath $expiredBackup.FullName -Force
}

Write-Host "Backup criado: $backupFile"
