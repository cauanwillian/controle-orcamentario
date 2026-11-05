#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SYNC_SCRIPT="${SCRIPT_DIR}/sync-ledger-inbox.sh"
STATUS_LOG="${PROJECT_DIR}/logs/ledger-status.log"
CRON_MARKER="# controle-orcamentario-ledger-inbox"
RUNNER="${LEDGER_INBOX_RUNNER:-docker}"
if [[ "${RUNNER}" != "docker" && "${RUNNER}" != "host" ]]; then
  echo "LEDGER_INBOX_RUNNER deve ser 'docker' ou 'host'." >&2
  exit 2
fi
CRON_FILE="$(mktemp)"
trap 'rm -f "${CRON_FILE}"' EXIT

mkdir -p "${PROJECT_DIR}/logs"
crontab -l 2>/dev/null | grep -Fv "${CRON_MARKER}" > "${CRON_FILE}" || true
cat >> "${CRON_FILE}" <<EOF
LEDGER_INBOX_RUNNER=${RUNNER}
*/5 6-19 * * 1-6 bash '${SYNC_SCRIPT}' ${CRON_MARKER} inbox
0 20 * * 1-6 bash '${SYNC_SCRIPT}' ${CRON_MARKER} inbox
0 9 * * 1-5 cd '${PROJECT_DIR}' && docker compose --env-file .env.production -f compose.production.yaml run --rm worker ledger:status >> '${STATUS_LOG}' 2>&1 ${CRON_MARKER} status
EOF
crontab "${CRON_FILE}"
echo "Agendamentos instalados no crontab de $(id -un)."
