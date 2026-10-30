# FCGS systemd multi-worker production runtime

This replaces the old single `fcgs.service` runtime with four independent systemd workers behind the existing Nginx TLS endpoint. It intentionally does not reintroduce PM2.

## Runtime

- `fcgs-worker@1.service` -> `127.0.0.1:5001`
- `fcgs-worker@2.service` -> `127.0.0.1:5002`
- `fcgs-worker@3.service` -> `127.0.0.1:5003`
- `fcgs-worker@4.service` -> `127.0.0.1:5004`
- Nginx upstream: `fcgs_backend`
- PostgreSQL sessions remain shared through `connect-pg-simple`.
- Local EC2 object storage remains shared because all workers run on the same host.

## Multi-worker safety included in this build

- PostgreSQL advisory locks ensure Transport Compliance, school-termination cleanup and Access Control scheduled jobs run on one worker per scheduler tick.
- Assessment mutation locking now spans workers using PostgreSQL advisory locks while retaining the existing in-process queue.
- The PostgreSQL pool is explicitly bounded per worker with `FCGS_DB_POOL_MAX`.
- PDF rendering preserves a global cross-worker concurrency ceiling using a PostgreSQL advisory-lock semaphore; only worker 1 prewarms Chromium by default.
- Login/API rate-limit budgets are divided across the configured worker count so four processes do not silently multiply the existing limits.
- `/api/health/live` and `/api/health/ready` expose worker/release identity and readiness without authentication.
- SIGTERM drains HTTP, stops application timers, closes Chromium and closes the PostgreSQL pool before exit.
- Nginx uses passive worker failure detection and upstream retry for safe/idempotent failures.

## First cutover

Build and validate the release first, then:

```bash
sudo /opt/fcgs_repo/deployment/fcgs-multiworker/install.sh
```

The installer starts all four workers while `fcgs.service` remains live, validates direct readiness, switches Nginx only after all workers are ready, validates public HTTPS, and only then disables the old single service.

## Future deployments

After pull, validation and `npm run build`, use a rolling restart:

```bash
sudo /opt/fcgs_repo/deployment/fcgs-multiworker/rolling-restart.sh
```

## Phase 3 load test

```bash
sudo /opt/fcgs_repo/deployment/fcgs-multiworker/benchmark.sh
```

To also prove that Nginx continues serving while one worker is deliberately stopped:

```bash
sudo /opt/fcgs_repo/deployment/fcgs-multiworker/benchmark.sh --failover
```

## Runtime rollback

```bash
sudo /opt/fcgs_repo/deployment/fcgs-multiworker/rollback.sh
```

This restores Nginx to `127.0.0.1:5000`, starts/enables `fcgs.service`, then stops/disables the four worker services.
