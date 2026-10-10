#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL="${FCGS_PUBLIC_URL:-https://portal.firstchoicegroup.co.zw}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

wait_ready() {
  local worker="$1" port="$2"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/api/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  journalctl -u "fcgs-worker@${worker}.service" -n 100 --no-pager >&2 || true
  return 1
}

for worker in 1 2 3 4; do
  port=$((5000 + worker))
  echo "Restarting fcgs-worker@${worker}..."
  systemctl restart "fcgs-worker@${worker}.service"
  wait_ready "${worker}" "${port}"
  echo "  worker ${worker} ready"
done

curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready"
echo
echo "Rolling restart completed successfully."
