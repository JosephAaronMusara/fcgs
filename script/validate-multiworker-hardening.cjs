const fs = require('fs');

const files = {
  index: fs.readFileSync('server/index.ts', 'utf8'),
  db: fs.readFileSync('server/db.ts', 'utf8'),
  distributedLock: fs.readFileSync('server/distributed-lock.ts', 'utf8'),
  assessmentLock: fs.readFileSync('server/assessment-mutation-lock.ts', 'utf8'),
  pdf: fs.readFileSync('server/pdf-renderer.ts', 'utf8'),
  academicCache: fs.readFileSync('server/academic-report-cache.ts', 'utf8'),
  health: fs.readFileSync('server/health.ts', 'utf8'),
  service: fs.readFileSync('deployment/fcgs-multiworker/fcgs-worker@.service', 'utf8'),
  target: fs.readFileSync('deployment/fcgs-multiworker/fcgs-workers.target', 'utf8'),
  nginx: fs.readFileSync('deployment/fcgs-multiworker/nginx-fcgs-upstream.conf', 'utf8'),
  install: fs.readFileSync('deployment/fcgs-multiworker/install.sh', 'utf8'),
  rolling: fs.readFileSync('deployment/fcgs-multiworker/rolling-restart.sh', 'utf8'),
  rollback: fs.readFileSync('deployment/fcgs-multiworker/rollback.sh', 'utf8'),
  benchmark: fs.readFileSync('deployment/fcgs-multiworker/benchmark.sh', 'utf8'),
  loadTest: fs.readFileSync('script/load-test-multiworker.ts', 'utf8'),
};

const checks = [
  ['Shared distributed-lock helper exists', files.distributedLock.includes('pg_try_advisory_lock') && files.distributedLock.includes('pg_advisory_unlock')],
  ['Transport scheduler uses distributed lock', /FCGS_LOCK_KEYS\.transportCompliance/.test(files.index)],
  ['School cleanup uses distributed lock', /FCGS_LOCK_KEYS\.schoolTerminationCleanup/.test(files.index)],
  ['Access Control scheduler uses distributed lock', /FCGS_LOCK_KEYS\.accessControlScheduler/.test(files.index)],
  ['Academic report cache cleanup uses distributed lock', /FCGS_LOCK_KEYS\.academicReportCacheCleanup/.test(files.academicCache)],
  ['RBAC startup is serialized across workers', /FCGS_LOCK_KEYS\.rbacBaseline/.test(files.index) && /wait:\s*true/.test(files.index)],
  ['Assessment mutations use PostgreSQL advisory lock', /pg_advisory_lock/.test(files.assessmentLock) && /ASSESSMENT_LOCK_NAMESPACE/.test(files.assessmentLock)],
  ['Assessment lock release is asynchronous', /Promise<\(\) => Promise<void>>/.test(files.assessmentLock)],
  ['DB pool max is configurable per worker', /FCGS_DB_POOL_MAX/.test(files.db)],
  ['DB connections identify their FCGS worker', /application_name/.test(files.db) && /FCGS_WORKER_ID/.test(files.db)],
  ['Unexpected idle PostgreSQL errors are logged', /pool\.on\("error"/.test(files.db)],
  ['Liveness endpoint exists', files.health.includes('/api/health/live')],
  ['Readiness endpoint exists', files.health.includes('/api/health/ready')],
  ['Readiness checks PostgreSQL', /pool\.query\("SELECT 1 AS ok"\)/.test(files.health)],
  ['Readiness verifies production client assets', /dist.*public.*index\.html/s.test(files.health)],
  ['Worker identity response header exists', /X-FCGS-Worker/.test(files.health)],
  ['Release identity response header exists', /X-FCGS-Release/.test(files.health)],
  ['Health routes bypass normal API limiter ordering', files.index.indexOf('registerHealthRoutes(app)') < files.index.indexOf('app.use("/api/", apiLimiter)')],
  ['Existing rate limits are divided across workers', /Math\.ceil\(loginGlobalMax \/ configuredWorkerCount\)/.test(files.index) && /Math\.ceil\(apiGlobalMax \/ configuredWorkerCount\)/.test(files.index)],
  ['SIGTERM graceful shutdown exists', /SIGTERM/.test(files.index) && /httpServer\.close/.test(files.index) && /pool\.end/.test(files.index)],
  ['Application schedulers are cleared during shutdown', /schedulerHandles\.splice/.test(files.index)],
  ['PDF renderer has shutdown hook', /shutdownPdfRenderer/.test(files.pdf) && /browser\.close/.test(files.pdf)],
  ['PDF global concurrency is cross-worker', /FCGS_PDF_GLOBAL_CONCURRENCY/.test(files.pdf) && /acquireDistributedSemaphore/.test(files.pdf)],
  ['PDF prewarm can be restricted to one worker', /FCGS_PDF_PREWARM/.test(files.index)],
  ['Worker listen host is configurable', /process\.env\.HOST/.test(files.index)],
  ['systemd worker template uses production build', /dist\/index\.cjs/.test(files.service)],
  ['systemd worker template loads per-worker env', /\/etc\/fcgs\/workers\/%i\.env/.test(files.service)],
  ['systemd worker template sends SIGTERM with drain window', /KillSignal=SIGTERM/.test(files.service) && /TimeoutStopSec=40/.test(files.service)],
  ['systemd target declares four workers', ['@1.service','@2.service','@3.service','@4.service'].every(v => files.target.includes(v))],
  ['Nginx upstream declares four loopback workers', ['5001','5002','5003','5004'].every(v => files.nginx.includes(`127.0.0.1:${v}`))],
  ['Nginx passive failure handling is configured', /max_fails=2/.test(files.nginx) && /proxy_next_upstream/.test(files.nginx)],
  ['Installer validates four workers before Nginx cutover', /for worker in 1 2 3 4/.test(files.install) && /wait_ready/.test(files.install)],
  ['Installer keeps old service until public readiness succeeds', files.install.indexOf('PUBLIC_URL}/api/health/ready') < files.install.indexOf('disable --now fcgs.service')],
  ['Installer binds worker ports to loopback', /HOST=127\.0\.0\.1/.test(files.install)],
  ['Installer preserves global PDF concurrency of two', /FCGS_PDF_GLOBAL_CONCURRENCY=2/.test(files.install)],
  ['Rolling restart validates each worker before continuing', /systemctl restart/.test(files.rolling) && /wait_ready/.test(files.rolling)],
  ['Rollback restores legacy port 5000', /127\.0\.0\.1:5000/.test(files.rollback) && /fcgs\.service/.test(files.rollback)],
  ['Load tester records worker distribution', /x-fcgs-worker/i.test(files.loadTest) && /Worker distribution/.test(files.loadTest)],
  ['Phase 3 benchmark expects four workers', /expect-workers 4/.test(files.benchmark)],
  ['Phase 3 benchmark captures PostgreSQL worker connections', /pg_stat_activity/.test(files.benchmark)],
  ['Optional single-worker failure test exists', /--failover/.test(files.benchmark) && /systemctl stop fcgs-worker@4/.test(files.benchmark)],
];

let passed = 0;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`[PASS] ${name}`);
    passed += 1;
  } else {
    console.error(`[FAIL] ${name}`);
  }
}
console.log(`\n${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exit(1);
