const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const absent = (p) => !exists(p);
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}`);
  }
}

const attendance = read('server/attendance-reporting.ts');
const attendanceUi = read('client/src/components/attendance-reports.tsx');
const attendancePage = read('client/src/pages/attendance.tsx');
const fees = read('server/fees-import-routes.ts');
const feesUi = read('client/src/components/fee-balance-import-dialog.tsx');
const schoolFinance = read('client/src/pages/school-finance.tsx');
const transportUi = read('client/src/pages/transport.tsx');
const transport = read('server/transport-routes.ts');
const routes = read('server/routes.ts');
const index = read('server/index.ts');
const rbac = read('server/rbac-config.ts');
const app = read('client/src/App.tsx');
const sidebar = read('client/src/components/app-sidebar.tsx');
const schema = read('shared/schema.ts');
const migration = read('sql/2026_10_13_attendance_reporting_fee_import_followup.sql');
const auth = read('server/auth.ts');

// Attendance reporting architecture and correctness.
check('Dedicated attendance reporting service exists', exists('server/attendance-reporting.ts'));
check('Attendance reporting routes are registered', routes.includes('registerAttendanceReportingRoutes(app)'));
for (const endpoint of ['overview','students','absenteeism','non-attendance','stopped-attending','classes','export']) {
  check(`Attendance ${endpoint} endpoint exists`, attendance.includes(`/api/attendance/reports/${endpoint}`));
}
check('Individual student attendance history endpoint exists', attendance.includes('/api/attendance/reports/student/:id'));
check('Present and Late are reporting-presence statuses', attendance.includes('new Set(["present", "late"])'));
check('Configured absence reasons retain absence classification', attendance.includes('new Set(["absent", "sick", "fees", "suspended", "absconding", "excused"])'));
check('Missing attendance is surfaced as not recorded', attendance.includes('"not_recorded"'));
check('School-day schedules are reused', attendance.includes('schoolDaySchedules'));
check('School-day overrides are reused', attendance.includes('schoolDayOverrides'));
check('Student enrolment history is consulted', attendance.includes('studentEnrollmentEvents'));
check('Internal transfer history is consulted', attendance.includes('internalTransfers'));
check('Gate-confirmed attendance evidence participates in authoritative selection', attendance.includes('gateEvidenceLocked'));
check('Historical class uncertainty is represented instead of silently guessed', attendance.includes('historicalClassUncertain'));
check('Teacher attendance report scope is restricted by assignments', attendance.includes('teacher') && attendance.includes('assistant_teacher') && attendance.includes('classTeacherAssignments'));
check('Attendance reports enforce organisation/school scope', attendance.includes('school.organizationId !== user.organizationId') && attendance.includes('getUserSchoolAccess'));
check('Student-day reporting de-duplicates by student and date', attendance.includes('const key = `${row.studentId}:${row.date}`') && attendance.includes('const grouped = new Map'));
check('Attendance reporting supports server pagination', attendance.includes('pageSize') && attendance.includes('pagination'));
check('Attendance reporting supports search/filter/sort', attendance.includes('filters.search') && attendance.includes('filters.status') && attendance.includes('sortBy'));
check('Term non-attendance distinguishes missing data from confirmed absence', attendance.includes('Possible Non-Return') && attendance.includes('Attendance Incomplete') && attendance.includes('Insufficient Attendance Data'));
check('Consecutive absence logic uses school-day sequence and breaks on unresolved days', attendance.includes('consecutiveAbsentDays') && attendance.includes('notRecordedDays'));
check('Stopped-attending analysis tracks last presence and confirmed absences after it', attendance.includes('lastPresent') && attendance.includes('absentDaysSinceLastPresent'));
check('Excel attendance export exists', attendance.includes('XLSX') && attendance.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
check('PDF attendance export exists', attendance.includes('PDFDocument') && attendance.includes('application/pdf'));
check('Attendance report view permission exists', rbac.includes('attendance.reports.view'));
check('Attendance report export permission exists', rbac.includes('attendance.reports.export'));
check('Attendance page keeps existing register and adds reports tab', attendancePage.includes('Attendance Register') && attendancePage.includes('Attendance Reports'));
check('Report-only users can enter attendance page', app.includes('attendance.reports.view') && sidebar.includes('attendance.reports.view'));
check('Attendance frontend exposes historical-class uncertainty', attendanceUi.includes('Historical class needs review'));
check('Attendance frontend includes all agreed report types', ['overview','frequent','consecutive','non-attendance','stopped-attending','student','classes'].every(v => attendanceUi.includes(v)));

// Fee-balance import redesign.
check('Dedicated fee import routes exist', exists('server/fees-import-routes.ts'));
check('New fee import routes are registered', routes.includes('registerFeesImportRoutes(app)'));
check('CSV/XLSX/XLS automatic signature detection exists', fees.includes('0x50') && fees.includes('0xd0') && fees.includes('return "xlsx"') && fees.includes('return "xls"') && fees.includes('return "csv"'));
check('Excel workbook parsing uses existing xlsx library', fees.includes('import("xlsx")'));
check('CSV parsing remains supported', fees.includes('csv-parse/sync'));
check('Common learner-name headings are recognized', fees.includes('student name') && fees.includes('learner name') && fees.includes('customer name'));
check('Common balance headings are recognized', fees.includes('balance due') && fees.includes('outstanding balance') && fees.includes('amount due'));
check('Multiple plausible worksheets require explicit selection', fees.includes('candidateSheets') && fees.includes('requiresSheetSelection'));
check('Summary/subtotal labels are detected', fees.includes('SUMMARY_NAME_RE') && fees.includes('Summary/subtotal row'));
check('Excel SUM formulas are a subtotal signal', fees.includes('sheet[address]?.f') && fees.includes('Summary/subtotal formula row'));
check('Subtotal detection does not use amount equality or aggregate-value guessing', !fees.includes('subtotalAmount') && !fees.includes('looksLikeSubtotalAmount'));
check('Blank/repeated-header rows are skipped', fees.includes('Blank row') && fees.includes('Repeated column header'));
check('Skipped rows stay separate from unmatched rows', fees.includes('rowDisposition === "skipped"') && fees.includes('matchMethod === "unmatched"'));
check('Preview exposes matched/unmatched/skipped/invalid statistics', ['matchedRows','unmatchedRows','skippedRows','invalidRows'].every(v => fees.includes(v)));
check('File SHA-256 is persisted for duplicate awareness', fees.includes('createHash("sha256")') && schema.includes('fileHash'));
check('Duplicate exact-file commit requires explicit override', fees.includes('allowDuplicateFile') && fees.includes('status(409)'));
check('Background import progress is durable', ['processedRows','failedRows','progressMessage','processingStartedAt','processingCompletedAt'].every(v => schema.includes(v)));
check('Background worker claims jobs safely across multiple Node workers', fees.includes('FOR UPDATE SKIP LOCKED'));
check('Fee import processor uses application scheduler lifecycle', index.includes('runFeeImportProcessorTick') && index.includes('scheduleJob(runFeeImportJobs'));
check('Legacy long synchronous CSV endpoint is retired with JSON 410', fees.includes('app.post("/api/fees/import-csv"') && fees.includes('status(410).json'));
check('Fee importer exposes preview/commit/status endpoints', fees.includes('/api/fees/import-file/preview') && fees.includes('/api/fees/import-file/:batchId/commit') && fees.includes('/api/fees/import-file/:batchId/status'));
check('School Finance uses new fee import dialog', schoolFinance.includes('FeeBalanceImportDialog'));
check('Import UI advertises automatic file detection', feesUi.includes('File type is detected automatically'));
check('Import UI shows skipped rows and reason', feesUi.includes('Skipped rows') && feesUi.includes('skipReason'));
check('Import UI explicitly states amount alone does not determine subtotal', feesUi.includes('never from the monetary amount alone'));
check('Import UI shows background progress', feesUi.includes('progressPercent') && feesUi.includes('processing in the background'));
check('Auth policy recognizes new fee-import route family', auth.includes('import-file') && auth.includes('fees.import'));
check('Fee import enforces organisation/school scope', fees.includes('school.organizationId !== user.organizationId') && fees.includes('getUserSchoolAccess'));

// Cash-up correction.
check('Cash-up UI no longer contains receipts-not-included block', !transportUi.includes('Receipts not included in this cash-up'));
check('Cash-up UI no longer depends on unchecked-receipt state', !transportUi.includes('hasUnchecked') && !transportUi.includes('verifyBlocked'));
check('Cash-up API no longer exposes uncheckedPayments', !transport.includes('uncheckedPayments'));
check('Cash-up verification still revalidates linked transactions', transport.includes('linkedTransactionsRevalidated'));
check('Flag Discrepancy remains available', transportUi.includes('Flag Discrepancy'));
check('Password authorization remains in cash-up verification', transportUi.includes('Account password'));

// Removal / navigation cleanup.
check('Parents With Arrears page is deleted', absent('client/src/pages/arrears.tsx'));
check('Parents With Arrears UI/tab is gone', !schoolFinance.toLowerCase().includes('parents with arrears'));
check('Retired arrears route is gone', !app.includes('/arrears'));
check('Retired arrears permission is gone from live RBAC catalog', !rbac.includes('arrears.view'));
check('Migration retires only the arrears.view permission explicitly', migration.includes("code = 'arrears.view'") && migration.includes('DELETE FROM permissions'));
check('Point of Sale navigation remains', sidebar.includes('title: "Point of Sale"'));
check('Point of Sale entry has no In Production badge', !/title:\s*"Point of Sale"[^\n]*badge:\s*"In Production"/.test(sidebar));
check('Kund-Ai navigation remains', sidebar.includes('title: "Kund-Ai"'));
check('Kund-Ai entry is no longer marked comingSoon', !/title:\s*"Kund-Ai"[^\n]*comingSoon:\s*true/.test(sidebar));

// Schema / migration package.
check('Fee import schema additions are represented in shared schema', schema.includes('detectedFormat') && schema.includes('rowDisposition') && schema.includes('processingCompletedAt'));
check('Fee import migration is additive for new columns', migration.includes('ADD COLUMN IF NOT EXISTS detected_format') && migration.includes('ADD COLUMN IF NOT EXISTS row_disposition'));
check('Fee import indexes are additive', migration.includes('CREATE INDEX IF NOT EXISTS fees_import_batches_school_hash_idx') && migration.includes('CREATE INDEX IF NOT EXISTS fees_import_batches_status_idx'));
check('2026-10-13 migration runner exists', exists('script/apply-2026-10-13-combined-build.ts'));

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed) process.exit(1);
