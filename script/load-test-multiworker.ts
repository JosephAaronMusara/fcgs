import { performance } from "perf_hooks";

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function intArg(name: string, fallback: number) {
  const parsed = Number.parseInt(String(arg(name, String(fallback))), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const baseUrl = String(arg("url", "http://127.0.0.1:5000")).replace(/\/$/, "");
const requestPath = String(arg("path", "/api/health/live"));
const concurrency = intArg("concurrency", 40);
const durationSeconds = intArg("duration", 30);
const timeoutMs = intArg("timeout-ms", 10_000);
const expectedWorkers = intArg("expect-workers", 1);
const cookie = arg("cookie", process.env.FCGS_LOAD_TEST_COOKIE || "");
const endpoint = `${baseUrl}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`;

const latencies: number[] = [];
const statusCounts = new Map<number, number>();
const workerCounts = new Map<string, number>();
let networkErrors = 0;
let completed = 0;
const stopAt = performance.now() + durationSeconds * 1000;

async function issueRequest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      headers: cookie ? { cookie } : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    completed += 1;
    statusCounts.set(response.status, (statusCounts.get(response.status) || 0) + 1);
    const worker = response.headers.get("x-fcgs-worker") || "unknown";
    workerCounts.set(worker, (workerCounts.get(worker) || 0) + 1);
    await response.arrayBuffer().catch(() => undefined);
  } catch {
    networkErrors += 1;
  } finally {
    clearTimeout(timer);
  }
}

async function runLane() {
  while (performance.now() < stopAt) await issueRequest();
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

console.log(`[multiworker-load-test] target=${endpoint}`);
console.log(`[multiworker-load-test] concurrency=${concurrency} duration=${durationSeconds}s expectedWorkers=${expectedWorkers}`);
const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => runLane()));
const elapsedSeconds = (performance.now() - startedAt) / 1000;

const nonSuccess = Array.from(statusCounts.entries())
  .filter(([status]) => status < 200 || status >= 400)
  .reduce((sum, [, count]) => sum + count, 0);
const totalAttempts = completed + networkErrors;
const observedWorkers = Array.from(workerCounts.keys()).filter((value) => value !== "unknown");

console.log("\n=== FCGS multi-worker load-test result ===");
console.log(`Completed responses : ${completed}`);
console.log(`Network errors      : ${networkErrors}`);
console.log(`Non-success HTTP    : ${nonSuccess}`);
console.log(`Throughput          : ${(completed / Math.max(elapsedSeconds, 0.001)).toFixed(1)} req/s`);
console.log(`Latency p50         : ${percentile(latencies, 50).toFixed(1)} ms`);
console.log(`Latency p95         : ${percentile(latencies, 95).toFixed(1)} ms`);
console.log(`Latency p99         : ${percentile(latencies, 99).toFixed(1)} ms`);
console.log(`Latency max         : ${Math.max(0, ...latencies).toFixed(1)} ms`);
console.log(`Status counts       : ${JSON.stringify(Object.fromEntries([...statusCounts].sort((a, b) => a[0] - b[0])))}`);
console.log(`Worker distribution : ${JSON.stringify(Object.fromEntries([...workerCounts].sort()))}`);

let failed = false;
if (totalAttempts === 0) {
  console.error("[FAIL] No requests completed.");
  failed = true;
}
if (networkErrors > 0 || nonSuccess > 0) {
  console.error("[FAIL] The run contained network or HTTP failures.");
  failed = true;
}
if (observedWorkers.length < expectedWorkers) {
  console.error(`[FAIL] Expected at least ${expectedWorkers} workers but observed ${observedWorkers.length}.`);
  failed = true;
}
if (!failed) console.log("[PASS] No request failures and the expected workers were observed.");
process.exitCode = failed ? 1 : 0;
