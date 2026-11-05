# Controle de Orçamento e Contas Contábeis

Base local do sistema de orçamento, realizado e permissões.

## Pré-requisitos

- Docker Desktop em execução
- Node.js 24 LTS ou posterior
- pnpm 11

## Primeira execução

1. Altere as senhas locais no arquivo `.env` se desejar.
2. Execute `pnpm install`.
3. Execute `pnpm infra:up` para iniciar PostgreSQL e Redis.
4. Execute `pnpm dev` para iniciar interface e API.

Endereços locais:

- Interface: `http://localhost:3000`
- API: `http://localhost:3001/health`

## Organização

- `apps/web`: interface do usuário
- `apps/api`: regras de negócio e APIs
- `apps/worker`: importações assíncronas; inicialmente, os arquivos ficam em armazenamento local
- `packages/shared`: tipos e validações reutilizáveis

## Primeira carga: Plano de Contas

Com os containers ativos, execute `pnpm db:migrate` uma vez. Em seguida, importe o arquivo original:

```powershell
pnpm import:plan -- "C:\Users\cauan.admin\Downloads\PLANO DE CONTA.xlsx"
```

O importador lê somente a aba `DRE`, valida os campos necessários e atualiza contas pelo código contábil.

## Segunda carga: Controle de Acessos

```powershell
pnpm db:migrate
pnpm import:access -- "C:\Users\cauan.admin\Downloads\CONTROLE DE ACESSOS.xlsx"
```

O sistema importa colaboradores por matrícula, catálogo de cargos, permissões por setor e PAs. CPF não é importado.

## Data contábil do Razão

O sistema guarda separadamente a data e horário de carga e a data de referência contábil. A configuração inicial considera defasagem de 3 dias e prazo diário de atualização até 09:00 no fuso de Cuiabá. O dashboard mostrará essa data de referência em vez de sugerir que os lançamentos estão atualizados até o dia corrente.

## Terceira carga: Orçamento

```powershell
pnpm db:migrate
pnpm import:budget -- "C:\Users\cauan.admin\Downloads\ORÇAMENTO 2026 1.xlsx"
```

O arquivo mensal é convertido em registros por competência. O campo `ACUMULADO` é validado contra a soma dos doze meses e não é gravado como valor independente.

## Livro Razão e dashboard

```powershell
pnpm import:ledger -- "C:\Users\cauan.admin\Downloads\LIVRO_RAZAO 2026-1.xlsx"
pnpm import:ledger -- "C:\Users\cauan.admin\Downloads\LIVRO_RAZAO 2026-2.xlsx"
pnpm ledger:status
```

O dashboard consulta a API em `http://localhost:3001`. A rotina local usa a data de referência de três dias úteis anteriores ao dia atual e o prazo configurado de 09:00.

## Importação automática do Livro Razão

Configure `LEDGER_INBOX_DIR` para a pasta local do servidor compartilhada com a Contabilidade. O padrão é `./data/inbox/livro-razao`; o coletor lê apenas arquivos `.xlsx` diretamente nessa pasta e cria `processados/` e `rejeitados/` nela. `LEDGER_INBOX_MIN_AGE_MS` (padrão `15000`) e `LEDGER_INBOX_STABILITY_WAIT_MS` (padrão `2000`) controlam a proteção contra arquivos ainda sendo copiados. `LEDGER_STORAGE_DIR` define onde ficam as cópias rastreáveis; o padrão é `./data/uploads`.

Execute uma leitura manual com `pnpm ledger:inbox` (alias: `pnpm ledger:watch-inbox`). No Windows, registre a execução periódica a cada cinco minutos entre 06:00 e 20:00 usando `powershell -ExecutionPolicy Bypass -File .\scripts\register-ledger-inbox-task.ps1`. Arquivos importados e duplicados por checksum publicado vão para `processados/`; arquivos inválidos vão para `rejeitados/` com um arquivo `.erro.txt` explicando a validação recusada. Falhas operacionais que não sejam validação deixam o arquivo na inbox para nova tentativa.
