# FCGS four-worker systemd build - 10 October 2026

## Scope completed

### Phase 1 - multi-worker application safety

- PostgreSQL advisory locking for Transport Compliance, school termination cleanup and Access Control scheduler ticks.
- PostgreSQL-backed cross-worker assessment mutation locking while preserving the existing local queue.
- Explicit per-worker PostgreSQL pool sizing and worker-specific `application_name` for production diagnostics.
- Cross-worker PDF rendering semaphore so four workers do not multiply the previous PDF concurrency ceiling.
- Only worker 1 prewarms Chromium by default; all workers can still render on demand.
- Academic report cache cleanup is distributed-lock protected.
- Health endpoints: `/api/health/live` and `/api/health/ready`.
- Worker/release response headers for load-balancer verification.
- Existing login/API rate-limit budgets are divided by configured worker count so the old limits are not multiplied by four.
- Graceful SIGTERM drain closes HTTP, application timers, Chromium and PostgreSQL pool cleanly.
- Worker bind address is configurable; production worker files use loopback only.

### Phase 2 - four systemd workers behind Nginx

- `fcgs-worker@.service` template.
- `fcgs-workers.target` containing four workers.
- Ports 5001-5004 on `127.0.0.1`.
- Nginx `fcgs_backend` upstream with passive failure detection/retry.
- Safe first-cutover installer that starts and validates all four workers before touching Nginx, validates public HTTPS after cutover, and only then disables `fcgs.service`.
- Rolling restart script for future zero/full-downtime deployments.
- Runtime rollback script back to `fcgs.service` / port 5000.

### Phase 3 - verification/load-testing package

- Worker-distribution-aware HTTP load tester.
- Runtime benchmark captures CPU/memory, listeners and PostgreSQL worker connection counts.
- Lightweight liveness load test across all four workers.
- Readiness/DB load test across all four workers.
- Optional controlled one-worker failover test with automatic restoration.

## Historical double-check

See `HISTORICAL_CHECK.md`. Current repo history has no surviving PM2 ecosystem file; the August 2026 production documents record the post-removal baseline as systemd + one Node process at `127.0.0.1:5000`. This build does not restore PM2.

## Database/schema

No schema migration is required for this build. PostgreSQL advisory locks are session-level runtime primitives and require no new table.

## Validation completed in build sandbox

- Multi-worker source validator: **41/41 passed**.
- `git diff --check`: passed.
- All deployment shell scripts: `bash -n` passed.
- Nginx upstream snippet: `nginx -t` passed in an isolated test configuration.
- Changed/new TypeScript files: TypeScript syntax transpilation passed.
- Load-test script executed successfully against a local test HTTP server.

Full project `npm run check` / production build could not be rerun in the sandbox because npm registry package downloads repeatedly failed with `EAI_AGAIN`; the supplied source archive intentionally excludes `node_modules`. Run the normal full checks on the FCGS workstation/server where dependencies are already available before production cutover.

## Production sequence

1. Apply replacement files and commit/push normally.
2. On production: backup -> pull -> `npm run multiworker:source-check` -> existing Access Control validators -> `npm run check` -> `npm run gate:bridge:prepare-windows-runtime` -> `npm run build`.
3. Run `sudo /opt/fcgs_repo/deployment/fcgs-multiworker/install.sh`.
4. Verify all four direct readiness endpoints and public readiness.
5. Run `sudo /opt/fcgs_repo/deployment/fcgs-multiworker/benchmark.sh`.
6. If the basic benchmark passes, run `sudo /opt/fcgs_repo/deployment/fcgs-multiworker/benchmark.sh --failover`.
