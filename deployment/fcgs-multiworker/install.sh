#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${FCGS_REPO_ROOT:-/opt/fcgs_repo}"
NGINX_SITE="${FCGS_NGINX_SITE:-/etc/nginx/sites-available/fcgs}"
PUBLIC_URL="${FCGS_PUBLIC_URL:-https://portal.firstchoicegroup.co.zw}"
POOL_MAX="${FCGS_DB_POOL_MAX:-6}"
BACKUP_ROOT="${FCGS_MULTIWORKER_BACKUP_ROOT:-/var/backups/fcgs}"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/multiworker_${STAMP}"
UPSTREAM_CONF="/etc/nginx/conf.d/fcgs-multiworker.conf"
WORKER_ENV_DIR="/etc/fcgs/workers"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo/root." >&2
  exit 1
fi

for command in systemctl nginx curl grep sed install node; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done

[[ -d "${REPO_ROOT}" ]] || { echo "Repository not found: ${REPO_ROOT}" >&2; exit 1; }
[[ -f "${REPO_ROOT}/dist/index.cjs" ]] || { echo "Build missing: ${REPO_ROOT}/dist/index.cjs. Run npm run build first." >&2; exit 1; }
[[ -f "${REPO_ROOT}/dist/public/index.html" ]] || { echo "Client build missing: ${REPO_ROOT}/dist/public/index.html" >&2; exit 1; }
[[ -f "${REPO_ROOT}/.env" ]] || { echo "Production .env is missing." >&2; exit 1; }
[[ -f "${NGINX_SITE}" ]] || { echo "Nginx site not found: ${NGINX_SITE}" >&2; exit 1; }
[[ "$(command -v node)" == "/usr/bin/node" ]] || { echo "Expected production Node at /usr/bin/node but found $(command -v node). Update the service template before proceeding." >&2; exit 1; }

mkdir -p "${BACKUP_DIR}"
cp -a "${NGINX_SITE}" "${BACKUP_DIR}/nginx-fcgs.before"
[[ -f /etc/systemd/system/fcgs.service ]] && cp -a /etc/systemd/system/fcgs.service "${BACKUP_DIR}/fcgs.service.before"
[[ -f "${UPSTREAM_CONF}" ]] && cp -a "${UPSTREAM_CONF}" "${BACKUP_DIR}/fcgs-multiworker.conf.before"
(cd "${REPO_ROOT}" && git rev-parse HEAD > "${BACKUP_DIR}/git-revision.txt" 2>/dev/null || true)
systemctl status fcgs.service --no-pager -l > "${BACKUP_DIR}/fcgs.service.status.before.txt" 2>&1 || true
nginx -T > "${BACKUP_DIR}/nginx.full.before.txt" 2>&1 || true

echo "[1/7] Installing systemd multi-worker units..."
install -m 0644 "${REPO_ROOT}/deployment/fcgs-multiworker/fcgs-worker@.service" /etc/systemd/system/fcgs-worker@.service
install -m 0644 "${REPO_ROOT}/deployment/fcgs-multiworker/fcgs-workers.target" /etc/systemd/system/fcgs-workers.target
install -d -m 0750 -o root -g ubuntu "${WORKER_ENV_DIR}"

for worker in 1 2 3 4; do
  port=$((5000 + worker))
  prewarm="false"
  [[ "${worker}" -eq 1 ]] && prewarm="true"
  cat > "${WORKER_ENV_DIR}/${worker}.env" <<ENV
PORT=${port}
HOST=127.0.0.1
FCGS_WORKER_ID=fcgs-worker-${worker}
FCGS_WORKER_COUNT=4
FCGS_DB_POOL_MAX=${POOL_MAX}
FCGS_PDF_GLOBAL_CONCURRENCY=2
FCGS_PDF_PREWARM=${prewarm}
ENV
  chown root:ubuntu "${WORKER_ENV_DIR}/${worker}.env"
  chmod 0640 "${WORKER_ENV_DIR}/${worker}.env"
done

systemctl daemon-reload

wait_ready() {
  local worker="$1" port="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if curl --silent --show-error --fail --max-time 3 "http://127.0.0.1:${port}/api/health/ready" >/tmp/fcgs-worker-ready.json 2>/dev/null; then
      echo "  worker ${worker} ready on 127.0.0.1:${port}"
      return 0
    fi
    sleep 1
  done
  echo "Worker ${worker} failed readiness on port ${port}." >&2
  journalctl -u "fcgs-worker@${worker}.service" -n 80 --no-pager >&2 || true
  return 1
}

echo "[2/7] Starting four workers alongside the existing single-worker service..."
for worker in 1 2 3 4; do
  systemctl start "fcgs-worker@${worker}.service"
done

for worker in 1 2 3 4; do
  if ! wait_ready "${worker}" "$((5000 + worker))"; then
    systemctl stop fcgs-workers.target fcgs-worker@1.service fcgs-worker@2.service fcgs-worker@3.service fcgs-worker@4.service 2>/dev/null || true
    echo "Cutover aborted. Nginx and fcgs.service were not changed." >&2
    exit 1
  fi
done

echo "[3/7] Installing Nginx upstream definition..."
install -m 0644 "${REPO_ROOT}/deployment/fcgs-multiworker/nginx-fcgs-upstream.conf" "${UPSTREAM_CONF}"

if ! grep -Eq 'proxy_pass[[:space:]]+http://127\.0\.0\.1:5000/?;' "${NGINX_SITE}"; then
  echo "Expected production proxy_pass to 127.0.0.1:5000 was not found. Cutover aborted before changing Nginx." >&2
  rm -f "${UPSTREAM_CONF}"
  systemctl stop fcgs-worker@1.service fcgs-worker@2.service fcgs-worker@3.service fcgs-worker@4.service 2>/dev/null || true
  exit 1
fi

sed -Ei 's#proxy_pass[[:space:]]+http://127\.0\.0\.1:5000/?;#proxy_pass http://fcgs_backend;#g' "${NGINX_SITE}"

if ! nginx -t; then
  cp -a "${BACKUP_DIR}/nginx-fcgs.before" "${NGINX_SITE}"
  rm -f "${UPSTREAM_CONF}"
  nginx -t || true
  systemctl stop fcgs-worker@1.service fcgs-worker@2.service fcgs-worker@3.service fcgs-worker@4.service 2>/dev/null || true
  echo "Nginx validation failed; original configuration was restored." >&2
  exit 1
fi

echo "[4/7] Reloading Nginx onto the four-worker upstream..."
systemctl reload nginx
sleep 2

if ! curl --silent --show-error --fail --max-time 10 "${PUBLIC_URL}/api/health/ready" >/tmp/fcgs-public-ready.json; then
  echo "Public readiness failed after Nginx cutover. Restoring the original upstream." >&2
  cp -a "${BACKUP_DIR}/nginx-fcgs.before" "${NGINX_SITE}"
  rm -f "${UPSTREAM_CONF}"
  nginx -t && systemctl reload nginx
  systemctl stop fcgs-worker@1.service fcgs-worker@2.service fcgs-worker@3.service fcgs-worker@4.service 2>/dev/null || true
  exit 1
fi
cat /tmp/fcgs-public-ready.json
echo

echo "[5/7] Enabling multi-worker target and retiring the old single worker..."
systemctl enable fcgs-workers.target >/dev/null
for worker in 1 2 3 4; do systemctl enable "fcgs-worker@${worker}.service" >/dev/null; done
systemctl disable --now fcgs.service >/dev/null 2>&1 || true

echo "[6/7] Verifying worker services and Nginx after retirement of fcgs.service..."
for worker in 1 2 3 4; do
  systemctl is-active --quiet "fcgs-worker@${worker}.service" || { echo "fcgs-worker@${worker} is not active" >&2; exit 1; }
  wait_ready "${worker}" "$((5000 + worker))"
done
curl --silent --show-error --fail --max-time 10 "${PUBLIC_URL}/api/health/ready"
echo

echo "[7/7] Multi-worker cutover complete."
echo "Backup/config snapshot: ${BACKUP_DIR}"
echo "Run: sudo ${REPO_ROOT}/deployment/fcgs-multiworker/benchmark.sh"
