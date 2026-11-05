# Publicação em servidor

Esta configuração executa frontend, API, PostgreSQL e Redis em containers separados. O worker é um comando sob demanda (perfil `jobs`), usado para migrações, conferência diária e importação automática. Para ambiente corporativo, prefira banco gerenciado ou realize backup externo do volume PostgreSQL.

## Antes de publicar

1. Escolha os domínios públicos do sistema e da API.
2. Copie `deploy/.env.production.example` para `.env.production` na raiz do projeto e preencha senhas e URLs reais.
3. No Ubuntu, mantenha `LEDGER_INBOX_HOST_DIR=/srv/samba/livro-razao`; esse caminho do host é montado no worker em `/app/data/inbox/livro-razao`. O volume `uploaded_ledger_files` é compartilhado pela API e pelo worker.
4. Garanta HTTPS por um proxy reverso (Nginx, Caddy ou serviço de hospedagem). O domínio do frontend deve constar em `WEB_ORIGIN`.

## Subida inicial

```powershell
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml exec api pnpm --filter @orcamento/worker db:migrate
```

## Servidor Ubuntu com Samba

No servidor Ubuntu, clone/atualize o repositório e entre na pasta do projeto. Prepare o diretório e o compartilhamento como administrador:

```bash
sudo bash deploy/setup-ubuntu-samba-inbox.sh
```

O script cria `/srv/samba/livro-razao`, `processados/` e `rejeitados/`, prepara permissões de grupo `2775` e configura `[livro-razao]` no Samba quando ele está instalado. Instale-o antes, se necessário, com `sudo apt update && sudo apt install samba`. Para cada pessoa, garanta que exista uma conta Unix, adicione-a ao grupo e cadastre a senha Samba:

```bash
sudo usermod -aG contabilidade-razao <usuario>
sudo smbpasswd -a <usuario>
```

No Windows, a Contabilidade abre `\\<IP-DO-SERVIDOR-UBUNTU>\livro-razao` e copia o `.xlsx` para a raiz. O coletor ignora os temporários `~$` do Excel enquanto a cópia está em andamento.

Após configurar `.env.production`, instalar Docker Compose e subir a aplicação, registre o coletor a cada cinco minutos entre 06:00 e 20:00 (segunda a sábado) e a conferência diária às 09:00 (segunda a sexta):

```bash
bash deploy/register-ubuntu-cron.sh
crontab -l
```

O agendamento executa `deploy/sync-ledger-inbox.sh`, usa `flock` para impedir sobreposição e grava em `logs/ledger-inbox.log`. O padrão é Docker Compose. Para execução do coletor no host, registre o cron com `LEDGER_INBOX_RUNNER=host bash deploy/register-ubuntu-cron.sh` e garanta Node.js/pnpm e as variáveis de conexão disponíveis; o comando será `pnpm ledger:inbox`. O check das 09:00 continua sendo executado pelo worker no Docker Compose.

## Operação

```powershell
# Ver status e logs
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f api

# Conferência diária do Livro Razão
docker compose --env-file .env.production -f compose.production.yaml run --rm worker ledger:status
docker compose --env-file .env.production -f compose.production.yaml run --rm worker ledger:inbox
```

Se `TEAMS_WEBHOOK_URL` estiver preenchida, o worker envia alertas de rejeição e de importação pendente.
