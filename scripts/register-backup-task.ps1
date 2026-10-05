$projectPath = Split-Path -Parent $PSScriptRoot
$backupScript = Join-Path $PSScriptRoot "backup-database.ps1"
$taskName = "Controle Orçamentário - Backup do Banco"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00PM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Gera backup diário do banco Controle Orçamentário e mantém 30 dias." -Force | Out-Null
Write-Host "Agendamento criado: $taskName"
Write-Host "Backups: $(Join-Path $projectPath 'backups')"
