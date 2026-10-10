#!/usr/bin/env bash
set -Eeuo pipefail

NGINX_SITE="${FCGS_NGINX_SITE:-/etc/nginx/sites-available/fcgs}"
UPSTREAM_CONF="/etc/nginx/conf.d/fcgs-multiworker.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

# Start the legacy service first so the rollback target is healthy before Nginx moves.
systemctl enable fcgs.service >/dev/null 2>&1 || true
systemctl start fcgs.service
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:5000/api/health/ready >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:5000/api/health/ready >/dev/null || {
  echo "Legacy fcgs.service did not become ready; Nginx was not changed." >&2
  exit 1
}

sed -Ei 's#proxy_pass[[:space:]]+http://fcgs_backend/?;#proxy_pass http://127.0.0.1:5000;#g' "${NGINX_SITE}"
nginx -t
systemctl reload nginx
systemctl disable fcgs-workers.target >/dev/null 2>&1 || true
for worker in 1 2 3 4; do
  systemctl disable --now "fcgs-worker@${worker}.service" >/dev/null 2>&1 || true
done
rm -f "${UPSTREAM_CONF}"
nginx -t

echo "Runtime rolled back to fcgs.service on 127.0.0.1:5000."
