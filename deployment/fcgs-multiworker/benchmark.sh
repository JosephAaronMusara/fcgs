#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${FCGS_REPO_ROOT:-/opt/fcgs_repo}"
PUBLIC_URL="${FCGS_PUBLIC_URL:-https://portal.firstchoicegroup.co.zw}"
RUN_FAILOVER="false"
[[ "${1:-}" == "--failover" ]] && RUN_FAILOVER="true"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root so service and PostgreSQL diagnostics are available." >&2
  exit 1
fi

cd "${REPO_ROOT}"
DATABASE_URL="$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"

snapshot() {
  echo
  echo "=== Runtime snapshot ==="
  date -Is
  uptime
  echo
  echo "-- FCGS workers --"
  for worker in 1 2 3 4; do
    systemctl --no-pager --quiet is-active "fcgs-worker@${worker}.service" && printf 'worker-%s active\n' "${worker}" || printf 'worker-%s NOT ACTIVE\n' "${worker}"
  done
  echo
  echo "-- Node CPU/memory --"
  ps -eo pid,ppid,%cpu,%mem,rss,etimes,cmd --sort=-%cpu | grep '/opt/fcgs_repo/dist/index.cjs' | grep -v grep || true
  echo
  echo "-- Worker listeners --"
  ss -ltnp | grep -E '127\.0\.0\.1:500[1-4]' || true
  echo
  echo "-- PostgreSQL FCGS worker connections --"
  if [[ -n "${DATABASE_URL}" ]]; then
    psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -c "
      SELECT application_name, state, count(*) AS connections
      FROM pg_stat_activity
      WHERE application_name LIKE 'fcgs-worker-%'
      GROUP BY application_name, state
      ORDER BY application_name, state;
      SHOW max_connections;
    " || true
  fi
}

wait_ready() {
  local worker="$1" port="$2"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/api/health/ready" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

echo "=== Phase 3: FCGS four-worker acceptance benchmark ==="
nginx -t

for worker in 1 2 3 4; do
  port=$((5000 + worker))
  echo "worker-${worker}: $(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health/ready")"
done

echo "public: $(curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready")"
snapshot

echo
echo "=== Load test A: Nginx -> lightweight liveness endpoint ==="
npx tsx script/load-test-multiworker.ts \
  --url "${PUBLIC_URL}" \
  --path /api/health/live \
  --duration 30 \
  --concurrency 40 \
  --expect-workers 4

echo
echo "=== Load test B: Nginx -> readiness endpoint with PostgreSQL check ==="
npx tsx script/load-test-multiworker.ts \
  --url "${PUBLIC_URL}" \
  --path /api/health/ready \
  --duration 20 \
  --concurrency 20 \
  --expect-workers 4

snapshot

if [[ "${RUN_FAILOVER}" == "true" ]]; then
  echo
  echo "=== Failover probe: temporarily stop worker 4 ==="
  systemctl stop fcgs-worker@4.service
  trap 'systemctl start fcgs-worker@4.service >/dev/null 2>&1 || true' EXIT
  sleep 2
  npx tsx script/load-test-multiworker.ts \
    --url "${PUBLIC_URL}" \
    --path /api/health/live \
    --duration 10 \
    --concurrency 20 \
    --expect-workers 3
  systemctl start fcgs-worker@4.service
  wait_ready 4 5004
  trap - EXIT
  echo "worker 4 restored and ready."
  curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready"
  echo
fi

echo
echo "[PASS] Phase 3 benchmark completed without request failures."
