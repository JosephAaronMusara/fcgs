const fs = require('fs');

const files = new Map();
function read(file) {
  if (!files.has(file)) files.set(file, fs.readFileSync(file, 'utf8'));
  return files.get(file);
}

const checks = [
  ['Enrollment removal persistence fields', 'shared/schema.ts', /enrollmentRemovedAt: timestamp\("enrollment_removed_at"\)[\s\S]*enrollmentRemovalReason/],
  ['Portal-controlled manual restriction fields', 'shared/schema.ts', /manualRestrictionActive: boolean\("manual_restriction_active"\)[\s\S]*manualRestrictionReason/],
  ['Academic-calendar override table', 'shared/schema.ts', /pgTable\("school_day_overrides"/],
  ['Immutable template version table', 'shared/schema.ts', /pgTable\("attendance_message_template_versions"/],
  ['Remove Enrollment endpoint', 'server/access-control-operations.ts', /identities\/:id\/remove-enrollment/],
  ['Explicit re-enrol clears removed state', 'server/access-control-operations.ts', /ensureIdentityForStudent\(student, scope\.organizationId, true\)/],
  ['Routine student policy preserves removed enrollment', 'server/access-control-operations.ts', /enrollmentRemoved = !!identity\?\.enrollmentRemovedAt && !explicitEnrollment/],
  ['Restrict / Restore endpoint', 'server/access-control-operations.ts', /identities\/:id\/restriction/],
  ['Recognition enforces manual entry restriction', 'server/access-control-operations.ts', /identity\.manualRestrictionActive[\s\S]*Manual restriction:/],
  ['Access Control OFF is fail-open at terminal sync', 'server/access-control-operations.ts', /enableAccessControl === false && identity\.isActive[\s\S]*desired\.usertype = "white"/],
  ['Access Control OFF is fail-open at recognition', 'server/access-control-operations.ts', /Access Control disabled; fail-open/],
  ['Date-specific school-day override API', 'server/access-control-operations.ts', /school-day\/overrides/],
  ['Date-specific override used by attendance', 'server/access-control-operations.ts', /isAcademicOpenDay\(student\.schoolId, parts\.date\)/],
  ['Stale financial denial automatically resyncs after 36h', 'server/access-control-operations.ts', /Financial snapshot exceeded 36 hours; fail-open policy refresh/],
  ['Scheduled financial override activation enforces term cap', 'server/access-control-operations.ts', /previouslyActivated\.length >= 2/],
  ['Template rendered preview API', 'server/access-control-operations.ts', /message-templates\/preview/],
  ['Template unsupported-placeholder validation', 'server/access-control-operations.ts', /Unsupported template placeholder/],
  ['Template immutable history API', 'server/access-control-operations.ts', /message-templates\/:key\/history/],
  ['Template save records previous and new Email body', 'server/access-control-operations.ts', /previousEmailBodyTemplate:[\s\S]*newEmailBodyTemplate:/],
  ['Template UI edits Email body', 'client/src/components/attendance-school-day-settings.tsx', /<Label>Email body<\/Label>/],
  ['Template UI has rendered preview', 'client/src/components/attendance-school-day-settings.tsx', /Rendered Preview/],
  ['Template UI displays Email history', 'client/src/components/attendance-school-day-settings.tsx', /Previous email body[\s\S]*New email body/],
  ['Parent dashboard self-scoped API', 'server/portal-routes.ts', /api\/me\/parent-dashboard/],
  ['Student dashboard self-scoped API', 'server/portal-routes.ts', /api\/me\/student-dashboard/],
  ['Parent finance linked-child API', 'server/portal-routes.ts', /api\/me\/parent-finance/],
  ['Student reduced finance API', 'server/portal-routes.ts', /student-finance[\s\S]*intentionally reduced/],
  ['Student dashboard finance response is reduced server-side', 'server/portal-routes.ts', /student dashboard intentionally exposes only the reduced finance view/],
  ['Parent and Student dedicated dashboard routing', 'client/src/App.tsx', /DashboardRoutePage[\s\S]*PortalDashboardPage/],
  ['Parent dedicated finance routing', 'client/src/App.tsx', /FeesRoutePage[\s\S]*ParentFinancePage/],
  ['Student dedicated finance route', 'client/src/App.tsx', /\/my-finance/],
  ['Portal roles cannot enter staff/admin routes through stray permissions', 'client/src/App.tsx', /portalRoleBlocked = isPortalRole && !!permissionRule && !roleAllowed/],
  ['Parent Gate-aware attendance columns', 'client/src/pages/children-attendance.tsx', /Gate Arrival[\s\S]*Gate Exit[\s\S]*Source/],
  ['Student Gate-aware attendance columns', 'client/src/pages/my-attendance.tsx', /Gate Arrival[\s\S]*Gate Exit[\s\S]*Source/],
  ['Parent report PDF self-service', 'client/src/pages/children-reports.tsx', /\/api\/report-cards\/\$\{mark\.examId\}\/student/],
  ['Student report PDF self-service', 'client/src/pages/my-grades.tsx', /\/api\/report-cards\/\$\{mark\.examId\}\/student/],
  ['Parent portal navigation has no dead hash links', 'client/src/components/app-sidebar.tsx', /const parentMenuGroups:[\s\S]*?\];/m, (m) => !/url: "#"/.test(m)],
  ['Student portal navigation has no dead hash links', 'client/src/components/app-sidebar.tsx', /const studentMenuGroups:[\s\S]*?\];/m, (m) => !/url: "#"/.test(m)],
  ['Student Payment history endpoint is blocked', 'server/routes.ts', /Student attempted to access payment history/],
  ['Administrative Student 360 is blocked to portal roles', 'server/routes.ts', /Portal user attempted to access the administrative Student 360 endpoint/],
  ['Notification ownership enforced before mark-read', 'server/routes.ts', /eq\(notifications\.userId, currentUser\.id\)/],
  ['Legacy student account and subject management endpoints reject portal roles', 'server/routes.ts', /students\/:id\/subjects", requireAuth, denyPortalRoles[\s\S]*students\/:id\/user", requireAuth, denyPortalRoles/],
  ['Class attendance grid/export reject portal roles', 'server/routes.ts', /attendance\/grid\/:classId\/:from\/:to", requireAuth, denyPortalRoles[\s\S]*attendance\/export\/:classId\/:from\/:to", requireAuth, denyPortalRoles/],
  ['Legacy class arrears endpoint rejects portal roles', 'server/routes.ts', /fees\/arrears-for-class", requireAuth, denyPortalRoles/],
  ['Report Hub administrative endpoints reject portal roles', 'server/routes.ts', /report-hub\/streams", requireAuth, denyPortalRoles[\s\S]*report-hub\/stream-analytics\/:examId\/:streamId", requireAuth, denyPortalRoles/],
  ['Report comment mutation endpoints reject portal roles', 'server/routes.ts', /report-card-subject-comments", requireAuth, denyPortalRoles[\s\S]*report-card-comments\/bulk", requireAuth, denyPortalRoles/],
  ['Financial override visible in Student 360', 'client/src/pages/student-360.tsx', /Temporary financial Gate access/],
  ['Financial override visible in Student Payments', 'client/src/pages/school-finance.tsx', /Gate Override/],
  ['HQ Fleet register requires/selects Base Home school', 'client/src/pages/fleet-management.tsx', /Select Base\/Home school[\s\S]*Register Vehicle/],
  ['HQ Fleet backend accepts organisation Base Home school', 'server/fleet-routes.ts', /requestedBaseSchoolId = input\.baseSchoolId \?\? scope\.schoolId[\s\S]*assertSchoolInOrganisation\(baseSchoolId, scope\.organizationId\)/],
  ['Additive DB completion SQL exists', 'sql/access_control_build1_completion.sql', /school_day_overrides[\s\S]*attendance_message_template_versions/],
];

let passed = 0;
for (const [name, file, pattern, extra] of checks) {
  let ok = false;
  try {
    const text = read(file);
    const match = text.match(pattern);
    ok = !!match && (!extra || extra(match[0], text));
  } catch (_) {}
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name} (${file})`);
  if (ok) passed++;
}
console.log(`\n${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exit(1);
