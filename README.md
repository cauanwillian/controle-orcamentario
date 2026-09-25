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
