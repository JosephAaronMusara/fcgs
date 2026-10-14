const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.error(`[FAIL] ${name}`); }
}

const schema = read('shared/schema.ts');
const service = read('server/fees-schedule.ts');
const imports = read('server/fees-import-routes.ts');
const routes = read('server/routes.ts');
const access = read('server/access-control-operations.ts');
const portal = read('server/portal-routes.ts');
const auth = read('server/auth.ts');
const page = read('client/src/pages/school-finance.tsx');
const scheduleUi = read('client/src/components/fee-schedule-dialog.tsx');
const importUi = read('client/src/components/fee-balance-import-dialog.tsx');
const migration = read('sql/2026_10_14_fee_schedule_automatic_arrears.sql');
const pkg = JSON.parse(read('package.json'));

check('Dedicated fee schedule service exists', exists('server/fees-schedule.ts'));
check('Term schedule table exists', schema.includes('feeTermSchedules') && schema.includes('fee_term_schedules'));
check('Three-instalment table exists', schema.includes('feeTermInstallments') && schema.includes('fee_term_installments'));
check('Schedule is unique by school/year/term', schema.includes('fee_term_schedules_school_year_term_uidx'));
check('Instalment amounts must be positive', schema.includes('fee_term_installments_amount_positive_chk'));
check('Instalment numbers are constrained to 1-3', schema.includes('fee_term_installments_number_chk'));
check('Current fee position uses Africa/Harare-aware date key', service.includes('Africa/Harare') && service.includes('feeDateKey'));
check('Due amount includes instalments effective today', service.includes('arrearsEffectiveDate <= dateKey'));
check('Maximum up-to-date balance is total minus due', service.includes('totalTermFee - amountDueToDate'));
check('Positive balance is in arrears when allowed balance is zero', service.includes('balanceDue <= maxUpToDateBalance + 0.01'));
check('Current schedule endpoint is registered', routes.includes('registerFeeScheduleRoutes(app)'));
check('Schedule view requires fees.view', auth.includes('/fees\\/schedule\\/current') && auth.includes('fees.view'));
check('Schedule edit uses fees.manage_structure', service.includes('requirePermission("fees.manage_structure")'));
check('Schedule update is school-context scoped', service.includes('schoolIdFromRequest') && service.includes('getUserSchoolAccess'));
check('Schedule edit requires exactly three instalments', service.includes('requires exactly three instalments'));
check('Schedule dates must be inside current term', service.includes('arrears-effective date must fall within'));
check('Schedule dates must be strictly increasing', service.includes('strictly increasing order'));
check('Schedule changes are activity audited', service.includes('createActivityLog') && service.includes('fee_term_schedule'));
check('Fee import no longer reads manual total/max fields', !imports.includes('req.body.term_total_fee') && !imports.includes('req.body.term_max_balance'));
check('Fee import requires configured schedule', imports.includes('getCurrentFeePosition') && imports.includes('Configure the term fee schedule before importing balances'));
check('Import batches snapshot fee schedule context', schema.includes('feeScheduleId') && schema.includes('feePositionDate') && schema.includes('amountDueToDate'));
check('Import preview snapshots year/term/schedule values', imports.includes('academicYear: feePosition.academicYear') && imports.includes('amountDueToDate: feePosition.amountDueToDate.toFixed(2)'));
check('Fee balance import UI has no manual term fee field', !importUi.includes('Term total fee amount'));
check('Fee balance import UI has no manual max balance field', !importUi.includes('Maximum allowed balance for “Up to date”'));
check('Fee balance import UI shows authoritative schedule values', importUi.includes('Required paid to date') && importUi.includes('Up-to-date balance limit'));
check('Background import Card crash hotfix is included', importUi.includes('import { Card, CardContent }'));
check('Fee Schedule button is in Student Payments', page.includes('FeeScheduleDialog') && page.includes('Fee Schedule'));
check('Current Fee Position strip is present', page.includes('Due to date:') && page.includes('Up-to-date balance limit:'));
check('Five KPI tiles use one desktop row', page.includes('lg:grid-cols-5'));
check('Calculated total is visible and non-editable', scheduleUi.includes('Calculated Total Term Fees') && scheduleUi.includes('readOnly'));
check('No read-only badge is rendered for calculated total', !scheduleUi.includes('Read Only') && !scheduleUi.includes('read-only'));
check('Default later instalments use first day of following months', scheduleUi.includes('addMonthsFirstDay(start, 1)') && scheduleUi.includes('addMonthsFirstDay(start, 2)'));
check('UI explains previous-day payment deadline', scheduleUi.includes('Payment deadline:') && scheduleUi.includes('previousDay'));
check('Server recalculates total from instalments', service.includes('reduce((sum, row) => sum + row.amount'));
check('Fee summary is date-aware', routes.includes('resolveStudentFeePosition(student)'));
check('Fee reminders are date-aware', routes.includes('const feeSnapshot = await resolveStudentFeePosition(student)'));
check('Attendance arrears review is date-aware', routes.includes('const statusKey = feeSnapshot.feesStatus'));
check('Parent/student finance snapshot is date-aware', portal.includes('resolveStudentFeePosition(student, now)'));
check('Gate financial access is date-aware', access.includes('resolveStudentFeePosition(student, now)'));
check('Historical import values remain batch snapshots', imports.includes('const termTotalFee = Number.parseFloat(batch.termTotalFee') && imports.includes('const termMaxBalance = Number.parseFloat(batch.termMaxBalance'));
check('Migration creates schedule tables', migration.includes('CREATE TABLE IF NOT EXISTS fee_term_schedules') && migration.includes('CREATE TABLE IF NOT EXISTS fee_term_installments'));
check('Migration adds import snapshot columns additively', migration.includes('ADD COLUMN IF NOT EXISTS fee_schedule_id') && migration.includes('ADD COLUMN IF NOT EXISTS amount_due_to_date'));
check('Explicit 2026-10-14 migration runner exists', exists('script/apply-2026-10-14-fee-schedule.ts'));
check('Package exposes controlled 2026-10-14 upgrade', pkg.scripts['fcgs:upgrade:2026-10-14'] === 'tsx script/apply-2026-10-14-fee-schedule.ts');

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed) process.exit(1);
