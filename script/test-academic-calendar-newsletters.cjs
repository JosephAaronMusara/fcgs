#!/usr/bin/env node
// Offline, database-free regression checks. Does not send communications or touch gates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
function loadPure(rel) {
  const filename = path.join(root, rel);
  const output = ts.transpileModule(read(rel), { fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [], `${rel} has syntax errors`);
  const instance = new Module(filename);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(output.outputText, filename);
  return instance.exports;
}
const calendar = loadPure('shared/academic-calendar.ts');
const sms = loadPure('shared/sms-segments.ts');
const example = {
  currentAcademicYear: '2026',
  term1StartDate: '2026-01-13', term1EndDate: '2026-04-01',
  term2StartDate: '2026-05-12', term2EndDate: '2026-08-06',
  term3StartDate: '2026-09-08', term3EndDate: '2026-12-05',
};
let tests = 0;
function check(title, fn) { fn(); tests++; console.log('PASS', title); }
check('Current HQ term is Term 3 in October, not school default Term 1', () => {
  const p = calendar.resolveAcademicCalendar(example, '2026-10-15');
  assert.equal(p.academicYear, '2026'); assert.equal(p.term, 'term3'); assert.equal(p.error, null);
});
check('Vacations derive automatically between HQ terms', () => {
  const p = calendar.resolveAcademicCalendar(example, '2026-04-02');
  assert.equal(p.period, 'vac1'); assert.equal(p.term, null); assert.equal(p.ranges.vac1.start, '2026-04-02');
});
check('Term boundaries are inclusive and switch automatically', () => {
  assert.equal(calendar.resolveAcademicCalendar(example, '2026-05-11').period, 'vac1');
  assert.equal(calendar.resolveAcademicCalendar(example, '2026-05-12').period, 'term2');
});
check('Year does not auto-roll over on January 1', () => {
  const p = calendar.resolveAcademicCalendar(example, '2027-01-01');
  assert.equal(p.academicYear, '2026'); assert.equal(p.period, null);
});
check('No silent term1 fallback outside the configured academic periods', () => {
  const p = calendar.resolveAcademicCalendar(example, '2026-12-25');
  assert.equal(p.term, null); assert.equal(p.period, null);
});
check('Partial vacation dates fail instead of silently choosing wrong term', () => {
  assert.match(calendar.resolveAcademicCalendar({ ...example, vac1StartDate: '2026-04-02' }, '2026-04-15').error, /both dates/i);
});
check('Overlapping HQ term dates fail', () => {
  assert.match(calendar.resolveAcademicCalendar({ ...example, term2StartDate: '2026-03-20' }, '2026-04-15').error, /overlap|ends before/i);
});
check('Missing HQ term dates fail without Term 1 fallback', () => {
  assert.match(calendar.resolveAcademicCalendar({ currentAcademicYear: '2026' }, '2026-10-15').error, /Configure valid start/i);
});
check('SMS GSM single-part maximum and multipart thresholds', () => {
  assert.equal(sms.estimateSmsSegments('A'.repeat(160)).segments, 1);
  assert.equal(sms.estimateSmsSegments('A'.repeat(161)).segments, 2);
  assert.equal(sms.estimateSmsSegments('A'.repeat(306)).segments, 2);
  assert.equal(sms.estimateSmsSegments('A'.repeat(307)).segments, 3);
});
check('SMS extended GSM characters require two septets', () => {
  assert.equal(sms.estimateSmsSegments('^'.repeat(81)).segments, 2);
  assert.equal(sms.estimateSmsSegments('^'.repeat(79)).segments, 1);
});
check('Unicode counts 70 single or 67 multipart UTF-16 code units', () => {
  assert.equal(sms.estimateSmsSegments('中'.repeat(70)).segments, 1);
  assert.equal(sms.estimateSmsSegments('中'.repeat(71)).segments, 2);
  assert.equal(sms.estimateSmsSegments('🙂'.repeat(35)).segments, 1);
  assert.equal(sms.estimateSmsSegments('🙂'.repeat(36)).segments, 2);
});
check('Full 9-segment newsletter remains complete after text preparation', () => {
  const original = 'Message: ' + 'A'.repeat(1300);
  assert.equal(sms.newsletterSmsText(original), original);
  assert.equal(sms.estimateSmsSegments(sms.newsletterSmsText(original)).segments, 9);
});
check('HTML newsletter retains paragraphs and decodes entities', () => {
  assert.equal(sms.newsletterSmsText('<p>Dear parents</p><p>Fees &amp; classes</p>'), 'Dear parents\nFees & classes');
});
check('Newsletter server sends full plainText to existing SMS service', () => {
  const source = read('server/routes.ts');
  const start = source.indexOf('jobType: "newsletter_publish"');
  const send = source.indexOf('communicationService.sendBulkSms(', start);
  assert.ok(start > 0 && send > start);
  assert.match(source.slice(send, send + 180), /smsRecipients,\s*plainText,/);
  assert.ok(!source.includes('plainText.substring(0, 157)'));
});
check('School update and create ignore legacy school-level academic overrides', () => {
  const source = read('server/routes.ts');
  assert.match(source, /for \(const key of SCHOOL_CALENDAR_FIELDS\) delete schoolUpdate\[key\]/);
  assert.match(source, /for \(const key of SCHOOL_CALENDAR_FIELDS\) delete \(data as Record<string, unknown>\)\[key\]/);
});
check('Fee schedule save rejects stale academic context and vacations', () => {
  const source = read('server/fees-schedule.ts');
  assert.ok(source.includes('req.body?.academicYear !== academicYear'));
  assert.ok(source.includes('No current school term in the Headquarters calendar'));
});
check('No automatic Gate Bridge updates enabled by this fix', () => {
  const source = read('server/academic-calendar.ts');
  assert.ok(!source.includes('gateBridge'));
});
console.log(`${tests}/${tests} calendar/newsletter regression checks passed.`);
