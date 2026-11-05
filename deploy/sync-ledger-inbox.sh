#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/ledger-inbox.log"
LOCK_FILE="/tmp/controle-orcamentario-ledger-inbox.lock"
RUNNER="${LEDGER_INBOX_RUNNER:-docker}"

mkdir -p "${LOG_DIR}"
exec >> "${LOG_FILE}" 2>&1
printf '\n[%s] Iniciando coletor (runner=%s)\n' "$(date --iso-8601=seconds)" "${RUNNER}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Outra execução do coletor ainda está ativa; encerrando esta rodada."
  exit 0
fi

cd "${PROJECT_DIR}"
case "${RUNNER}" in
  docker)
    docker compose --env-file .env.production -f compose.production.yaml run --rm worker ledger:inbox
    ;;
  host)
    pnpm ledger:inbox
    ;;
  *)
    echo "LEDGER_INBOX_RUNNER deve ser 'docker' ou 'host'." >&2
    exit 2
    ;;
esac
