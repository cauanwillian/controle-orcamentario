#!/usr/bin/env bash
set -euo pipefail

INBOX_DIR="${LEDGER_INBOX_HOST_DIR:-/srv/samba/livro-razao}"
SHARE_NAME="livro-razao"
GROUP_NAME="contabilidade-razao"
SAMBA_CONFIG="/etc/samba/smb.conf"
BEGIN_MARKER="# BEGIN controle-orcamentario ${SHARE_NAME}"
END_MARKER="# END controle-orcamentario ${SHARE_NAME}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo bash $0" >&2
  exit 1
fi
if [[ "${INBOX_DIR}" != /* || "${INBOX_DIR}" == *$'\n'* || "${INBOX_DIR}" == *$'\r'* ]]; then
  echo "LEDGER_INBOX_HOST_DIR deve ser um caminho absoluto sem quebras de linha." >&2
  exit 2
fi

if ! getent group "${GROUP_NAME}" >/dev/null; then
  groupadd --system "${GROUP_NAME}"
fi

install -d -o root -g "${GROUP_NAME}" -m 2775 \
  "${INBOX_DIR}" "${INBOX_DIR}/processados" "${INBOX_DIR}/rejeitados"
chgrp "${GROUP_NAME}" "${INBOX_DIR}" "${INBOX_DIR}/processados" "${INBOX_DIR}/rejeitados"
chmod 2775 "${INBOX_DIR}" "${INBOX_DIR}/processados" "${INBOX_DIR}/rejeitados"

if ! command -v testparm >/dev/null 2>&1 || ! command -v smbd >/dev/null 2>&1; then
  echo "Pasta pronta em ${INBOX_DIR}. Samba não está instalado; instale-o com: sudo apt update && sudo apt install samba"
  exit 0
fi

if [[ ! -f "${SAMBA_CONFIG}" ]]; then
  echo "Configuração do Samba não encontrada em ${SAMBA_CONFIG}." >&2
  exit 1
fi

temporary_config="$(mktemp "${SAMBA_CONFIG}.XXXXXX")"
trap 'rm -f "${temporary_config}"' EXIT

awk -v begin="${BEGIN_MARKER}" -v end="${END_MARKER}" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "${SAMBA_CONFIG}" > "${temporary_config}"
cat >> "${temporary_config}" <<EOF

${BEGIN_MARKER}
[${SHARE_NAME}]
   path = ${INBOX_DIR}
   read only = no
   create mask = 0664
   directory mask = 2775
   force group = ${GROUP_NAME}
${END_MARKER}
EOF

testparm -s "${temporary_config}" >/dev/null
install -o root -g root -m 0644 "${temporary_config}" "${SAMBA_CONFIG}"
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now smbd
  systemctl reload smbd
elif command -v service >/dev/null 2>&1; then
  service smbd reload || service smbd start
else
  echo "Configuração salva; recarregue o serviço smbd manualmente." >&2
  exit 1
fi

echo "Compartilhamento [${SHARE_NAME}] configurado em ${INBOX_DIR}."
echo "Adicione os usuários autorizados ao grupo ${GROUP_NAME} e cadastre suas senhas Samba com smbpasswd -a USUARIO."
