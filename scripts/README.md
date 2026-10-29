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

## Conciliação das versões do Livro Razão

`pnpm ledger:reconcile --dry-run` simula a migração 010 em uma transação que termina com `ROLLBACK`. O relatório informa quantos registros originais serão mantidos, quantas cópias idênticas entre versões serão desativadas e os totais previstos. A rotina testa todas as identidades SQL/Node, reimportação com agrupador alterado, preservação das revisões e repetição idempotente da migração.

`pnpm ledger:reconcile --dry-run --verify-rollback` também testa a reversão e a reaplicação completas em um savepoint descartado. Essa verificação adicional atualiza temporariamente todas as chaves e pode levar mais tempo; nada é confirmado no banco.

Depois de revisar o relatório e gerar um backup, `pnpm ledger:reconcile --apply` executa a mesma conciliação e confirma a transação. Nenhum lançamento original é apagado: cópias antigas ficam em `ledger_entry` com `superseded_at`, a visão `ledger_entry_current` mostra os registros vigentes e `ledger_entry_revision` preserva os dados anteriores quando um lançamento é corrigido. A chave atual usa data, conta, PA normalizada, lote e número do lançamento; o agrupador da exportação não define uma nova operação. Identidades ambíguas com conteúdos diferentes cancelam a migração.

O importador CLI e a API precisam ser implantados junto com a migração, pois ambos usam a nova identidade. Registros antigos sem contraparte comprovada na versão nova permanecem inalterados; esta rotina não substitui uma competência inteira por um arquivo possivelmente parcial.

Recuperação, se necessária: interrompa as importações, restaure o código anterior e revise `scripts/rollback-ledger-current-versions.sql`. Ele restaura as chaves originais e reativa apenas as cópias desativadas pela migração, mantendo os arquivos de auditoria. O script recusa executar caso existam importações ou alterações posteriores; nesse caso a recuperação exige conciliar as revisões/backup para não perder dados novos. Não executar esse rollback enquanto o importador novo estiver ativo.

## Substituição do escopo declarado pela exportação

A exportação SISBR pode renumerar os lançamentos entre versões, além de alterar o agrupador. Portanto, a chave de data, conta, PA, lote e número identifica uma linha dentro da exportação; ela não comprova que duas versões representam operações diferentes. A migração `011_ledger_snapshot_scopes.sql` complementa a conciliação 010 com o escopo de cada arquivo publicado, sem deduplicar lançamentos por valor ou histórico.

O importador valida o período e o intervalo de contas declarados no cabeçalho da aba `CTBLivroRazaoAnalitico`, a cooperativa 4598, a pesquisa por Conta Contábil sem totalização e a data/hora de emissão. Todos os lançamentos devem estar dentro desses limites. O período declarado é preservado inclusive quando o último dia não tem movimento; os limites não são inferidos da primeira e da última linha encontradas.

Para cada arquivo são registrados apenas os PAs observados, normalizados para tratar `0`/`00` e `1`/`01` como o mesmo PA. Um arquivo parcial de PAs substitui o intervalo declarado somente para os PAs presentes nele; outros PAs continuam com a versão anterior. Dentro desses PAs e do intervalo declarado de datas e contas, a versão publicada mais recente passa a fornecer os lançamentos, inclusive quando uma conta do intervalo ficou sem movimento. Datas e contas fora do escopo continuam preservadas.

A gravação de linhas, a conferência da quantidade e o registro do escopo/publicação ocorrem na mesma transação e sob o mesmo bloqueio dos importadores CLI/API. Uma sequência de publicação ordena os escopos para que o horário de início de transações concorrentes não inverta versões. A visão `ledger_entry_current` escolhe o escopo vigente; os registros de origem, arquivos e revisões de conteúdo permanecem guardados. Isso permite corrigir valores ou números renumerados pela versão nova sem inventar uma correspondência entre duas linhas antigas e novas.

Um arquivo com emissão anterior a um escopo já publicado que sobreponha datas, contas e PAs é recusado, inclusive no reprocessamento. Uma correção retroativa precisa de nova exportação emitida mais recentemente. Um cabeçalho ambíguo ou incompatível também cancela a importação, em vez de publicar um escopo inferido.

Implante API e worker com a migração 011 antes de receber novos arquivos; os importadores recusam importar se essa estrutura estiver ausente. A migração genérica cria somente a estrutura e mantém a visão compatível com a 010 enquanto nenhum escopo estiver registrado. Arquivos já importados exigem uma rotina separada e revisada de registro de escopo, com releitura do original e conferência da quantidade e do lote de importação. Não registre escopos de lotes históricos em massa apenas por suas datas mínimas/máximas.

Antes de ativar o primeiro escopo, interrompa as importações concorrentes, faça backup completo e execute a simulação da rotina de conciliação. Reverter somente a visão não desfaz importações posteriores que já atualizaram a procedência das linhas. Após novas importações, a recuperação requer conciliação das revisões/arquivos ou restauração de backup; não há promessa de restaurar uma versão antiga apenas removendo seu escopo.

Para registrar o arquivo publicado mais recente, depois de compilar a API, use `node scripts/reconcile-ledger-snapshot.mjs --batch UUID --dry-run --verify-rollback`. A rotina relê o original preservado, confere checksum, cabeçalho, quantidade e cobertura, simula a reversão e recusa um lote que já tenha uma publicação posterior. Depois de revisar a simulação e o backup, use o mesmo comando com `--apply` no lugar de `--dry-run --verify-rollback`. `--output CAMINHO` permite salvar o relatório; por padrão fica em `logs/`. Preserve o relatório aplicado com o checkpoint de recuperação.

`node scripts/test-ledger-snapshot-integration.mjs` verifica a substituição e os limites em uma transação integralmente descartada. `scripts/rollback-ledger-snapshot-scopes.sql` só permite a recuperação da primeira ativação com o checkpoint exato, sem importações/alterações posteriores. O código novo exige também o marcador ativo da migração 011, portanto não aceita importações após restaurar a visão 010 até reaplicar a migração.

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
