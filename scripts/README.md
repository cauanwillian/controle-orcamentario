# Rotina diária do Livro Razão

O script `check-ledger-9am.ps1` executa `pnpm ledger:status`, grava o resultado em `logs/ledger-status.log` e retorna falha ao Windows quando o arquivo do dia não foi recebido ou a referência contábil está pendente.

Para criar o agendamento diário às 09:00 no Windows, execute uma vez no PowerShell, dentro da pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-ledger-check-task.ps1
```

O resultado pode ser consultado em **Agendador de Tarefas > Controle Orçamentário - Conferência Livro Razão**. Para testar imediatamente, execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-ledger-9am.ps1
```

## Alerta para a Contabilidade

Se a variável `TEAMS_WEBHOOK_URL` estiver configurada no arquivo `.env`, a conferência envia uma mensagem ao canal do Teams quando o Livro Razão estiver pendente após as 09:00. Sem essa variável, a conferência continua funcionando e registra somente o status no log.

## Backup diário do banco

O script `backup-database.ps1` gera um arquivo `.dump` usando `pg_dump`, guarda-o em `backups/` e remove cópias com mais de 30 dias. O diretório não é enviado ao Git.

Para testar, o PostgreSQL precisa disponibilizar o comando `pg_dump` no PATH:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1
```

Para agendar o backup às 19:00 diariamente:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1
```
