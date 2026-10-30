/** Offline regression tests for Sage reconciliation's one-click bulk approval. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "client/src/lib/sage-bulk-approval.ts");
const componentPath = path.join(root, "client/src/components/sage-reconciliation-workspace.tsx");
const output = ts.transpileModule(fs.readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
  reportDiagnostics: true,
});
const errors = (output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, `Helper TypeScript errors: ${errors.map(d => d.messageText).join("; ")}`);
const compiled = { exports: {} };
new Function("module", "exports", "require", output.outputText)(compiled, compiled.exports, require);
const {
  SAGE_APPROVAL_CHUNK_SIZE,
  SageBulkApprovalError,
  normalizeSageApprovalCode,
  approveSageSelectionsInBatches,
} = compiled.exports;

const picks = n => Array.from({ length: n }, (_, i) => ({
  itemId: i + 1,
  studentId: i + 10000,
  customerCode: `SAGE-${i+1}`,
}));
let passed = 0;
async function test(label, run) {
  await run();
  console.log(`PASS ${label}`);
  passed++;
}

async function main() {
  await test("exactly 500 selections are one request, preserving the backend transaction cap", async () => {
    const chunks = [];
    const result = await approveSageSelectionsInBatches(picks(500), async chunk => {
      chunks.push(chunk.length);
      return { approved: chunk.length };
    }, () => {});
    assert.deepEqual(chunks, [500]);
    assert.equal(result.approved, 500);
    assert.equal(SAGE_APPROVAL_CHUNK_SIZE, 500);
  });

  await test("844 selections complete in two sequential requests (500 + 344)", async () => {
    const chunks = [], progress = [];
    const result = await approveSageSelectionsInBatches(picks(844), async chunk => {
      assert.equal(Object.keys(chunk[0]).sort().join(","), "itemId,studentId");
      chunks.push(chunk.length);
      return { approved: chunk.length };
    }, (_, state) => progress.push({ ...state }));
    assert.deepEqual(chunks, [500, 344]);
    assert.deepEqual(progress.map(p => p.approved), [500, 844]);
    assert.equal(result.approved, 844);
    assert.equal(result.completedBatches, 2);
  });

  await test("2,001 selections complete without an arbitrary user-facing 500 limit", async () => {
    const chunks = [];
    const result = await approveSageSelectionsInBatches(picks(2001), async chunk => {
      chunks.push(chunk.length);
      return { approved: chunk.length };
    }, () => {});
    assert.deepEqual(chunks, [500, 500, 500, 500, 1]);
    assert.equal(result.approved, 2001);
  });

  await test("second-chunk failure stops new requests and reports 500 confirmed / remainder pending", async () => {
    let calls=0; const finished=[];
    await assert.rejects(
      approveSageSelectionsInBatches(picks(1230), async chunk => {
        calls++;
        if(calls===2)throw new Error("School link conflict");
        return { approved: chunk.length };
      }, (chunk, progress) => finished.push([chunk.length, progress.approved])),
      err => {
        assert.ok(err instanceof SageBulkApprovalError);
        assert.equal(err.progress.approved, 500);
        assert.equal(err.progress.total, 1230);
        assert.equal(err.failedBatchNumber, 2);
        assert.match(err.message, /School link conflict/);
        return true;
      },
    );
    assert.equal(calls, 2);
    assert.deepEqual(finished, [[500, 500]]);
  });

  await test("duplicate FCGS students across chunks are blocked before the first request", async () => {
    const chosen = picks(844); chosen[700].studentId = chosen[0].studentId;
    let calls = 0;
    await assert.rejects(approveSageSelectionsInBatches(chosen, async () => { calls++; return {approved: 1}; }, () => {}), /multiple Sage accounts/);
    assert.equal(calls, 0);
  });

  await test("duplicate Sage customer codes across chunks are blocked before the first request", async () => {
    const chosen = picks(844); chosen[720].customerCode = "  sAgE-1 ";
    let calls = 0;
    await assert.rejects(approveSageSelectionsInBatches(chosen, async () => { calls++; return {approved: 1}; }, () => {}), /appears in both row/);
    assert.equal(calls, 0);
  });

  await test("Sage code normalisation retains meaningful punctuation", async () => {
    assert.equal(normalizeSageApprovalCode("WCAMB-02232"), "wcamb-02232");
    assert.equal(normalizeSageApprovalCode("WCAMB.02232"), "wcamb.02232");
    assert.notEqual(normalizeSageApprovalCode("WCAMB-02232"), normalizeSageApprovalCode("WCAMB.02232"));
  });

  await test("no-selection request never reaches the backend", async () => {
    let calls=0;
    await assert.rejects(approveSageSelectionsInBatches([], async () => {calls++;return {approved:1};},()=>{}), /Choose at least one/);
    assert.equal(calls, 0);
  });

  await test("unexpected server response is not silently declared successful", async () => {
    let approvals=0;
    await assert.rejects(approveSageSelectionsInBatches(picks(510), async () => ({approved: 0}),()=>{approvals++;}), err=>{
      assert.equal(err.progress.approved,0);
      assert.match(err.message,/unexpected approval count/);
      return true;
    });
    assert.equal(approvals,0);
  });

  await test("UI preserves confirmed-only removal, clear, per-row review and status messaging", async () => {
    const ui=fs.readFileSync(componentPath,"utf8");
    assert.match(ui,/approveSageSelectionsInBatches\(/);
    assert.match(ui,/for\(const \{itemId,studentId\} of chunk\)if\(next\[itemId\]===studentId\)delete next\[itemId\]/);
    assert.match(ui,/Review the refreshed results before retrying/);
    assert.match(ui,/aria-live="polite"/);
    assert.match(ui,/Remove this selection/);
    assert.doesNotMatch(ui, /Maximum 500 mappings may be approved at once/);
    assert.match(ui,/disabled=\{approve\.isPending\}/);
  });

  console.log(`${passed}/${passed} Sage bulk-approval regression checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
