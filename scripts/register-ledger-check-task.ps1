$projectPath = Split-Path -Parent $PSScriptRoot
$checkScript = Join-Path $PSScriptRoot "check-ledger-9am.ps1"
$taskName = "Controle Orçamentário - Conferência Livro Razão"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$checkScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Confere diariamente se a Contabilidade importou o Livro Razão e se a referência está em dia." -Force | Out-Null
Write-Host "Agendamento criado: $taskName"
Write-Host "Projeto: $projectPath"
Write-Host "Log diário: $(Join-Path $projectPath 'logs\ledger-status.log')"
