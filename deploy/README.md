# Publicação em servidor

Esta configuração executa o frontend, API, PostgreSQL e Redis em containers separados. Para ambiente corporativo, prefira banco gerenciado ou realize backup externo do volume PostgreSQL.

## Antes de publicar

1. Escolha os domínios público do sistema e da API.
2. Copie `deploy/.env.production.example` para `.env.production` na raiz do projeto e preencha senhas e URLs reais.
3. Garanta HTTPS por um proxy reverso (Nginx, Caddy ou serviço de hospedagem). O domínio do frontend deve constar em `WEB_ORIGIN`.

## Subida inicial

```powershell
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml exec api pnpm --filter @orcamento/worker db:migrate
```

## Operação

```powershell
# Ver status e logs
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f api

# Conferência diária do Livro Razão
docker compose --env-file .env.production -f compose.production.yaml run --rm worker ledger:status
```

Agende o último comando às 09:00 no servidor. Se `TEAMS_WEBHOOK_URL` estiver preenchida, o worker envia o alerta quando a importação estiver pendente.
