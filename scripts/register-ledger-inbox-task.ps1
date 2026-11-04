$projectPath = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot "sync-ledger-inbox.ps1"
$taskName = "Controle Orçamentário - Importação automática do Livro Razão"
$start = (Get-Date).Date.AddHours(6)
$trigger = New-ScheduledTaskTrigger -Daily -At $start -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 14)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$syncScript`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Importa os arquivos .xlsx estáveis da pasta configurada para o Livro Razão." -Force | Out-Null
Write-Host "Agendamento criado: $taskName"
Write-Host "Projeto: $projectPath"
Write-Host "Execução a cada 5 minutos entre 06:00 e 20:00."
Write-Host "Log: $(Join-Path $projectPath 'logs\ledger-inbox.log')"
