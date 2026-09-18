import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { ensureTransportDocumentRequirements } from "../server/transport-compliance";
import {
  accessGroups,
  classes,
  organizations,
  parents,
  schools,
  staff,
  students,
  transportAssignments,
  transportAuditEvents,
  transportDriverOwnerHistory,
  transportDrivers,
  transportOwners,
  transportPathNodeLearners,
  transportPathNodes,
  transportRoutes,
  transportServicePoints,
  transportSettings,
  transportVehicleDriverHistory,
  transportVehicleOwnerHistory,
  transportVehiclePaths,
  transportVehicles,
  userAccessGroups,
  userSchoolAccess,
  users,
} from "@shared/schema";

const TEST_SCHOOL_CODE = "TRTEST";
const TEST_SCHOOL_NAME = "FCGS Transport Test School";
const TEST_PASSWORD = "transport123";
const RESET = process.argv.includes("--reset");

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function localDatabaseGuard(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required. Run this through dotenv against your LOCAL database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  const databaseName = url.pathname.replace(/^\//, "");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
  const isLocalHost = localHosts.has(url.hostname);
  const isClearlyTestDatabase = /(local|test|dev)/i.test(databaseName);
  if (process.env.NODE_ENV === "production" || !isLocalHost || !isClearlyTestDatabase) {
    throw new Error(
      `REFUSING TO RUN: Transport dummy data is LOCAL-ONLY. Database host=${url.hostname}, database=${databaseName || "(unknown)"}. ` +
      'Use a loopback/local Docker host and a database name containing "local", "test", or "dev".',
    );
  }
}

async function findOrCreateSchool(organizationId: number, year: number) {
  const [existing] = await db.select().from(schools).where(eq(schools.shortCode, TEST_SCHOOL_CODE)).limit(1);
  if (existing) {
    const [updated] = await db.update(schools).set({
      organizationId,
      name: TEST_SCHOOL_NAME,
      enableTransport: true,
      enableFinance: true,
      currentAcademicYear: String(year),
      currentTerm: "term2",
    }).where(eq(schools.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(schools).values({
    organizationId,
    name: TEST_SCHOOL_NAME,
    shortCode: TEST_SCHOOL_CODE,
    motto: "Local Transport Test Data",
    address: "Local test environment only",
    phone: "+263700000001",
    email: "transport.test@local.invalid",
    enableTransport: true,
    enableFinance: true,
    enableHostel: false,
    currentAcademicYear: String(year),
    currentTerm: "term2",
    schoolType: "secondary",
  }).returning();
  return created;
}

async function ensureUser(args: {
  username: string;
  role: "school_admin" | "parent";
  firstName: string;
  lastName: string;
  email: string;
  schoolId: number;
  organizationId: number;
}) {
  const hashed = await bcrypt.hash(TEST_PASSWORD, 10);
  const [existing] = await db.select().from(users).where(eq(users.username, args.username)).limit(1);
  if (existing) {
    const [updated] = await db.update(users).set({
      password: hashed,
      role: args.role,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      schoolId: args.schoolId,
      organizationId: args.organizationId,
      isActive: true,
      mustResetPassword: false,
      tempPasswordLoginsRemaining: null,
    }).where(eq(users.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(users).values({
    username: args.username,
    password: hashed,
    role: args.role,
    firstName: args.firstName,
    lastName: args.lastName,
    email: args.email,
    schoolId: args.schoolId,
    organizationId: args.organizationId,
    isActive: true,
    mustResetPassword: false,
  }).returning();
  return created;
}

async function ensureSchoolAdminAccess(userId: number, schoolId: number) {
  const [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, "School Admin")).limit(1);
  if (!group) throw new Error('Access group "School Admin" is missing. Run the normal local seed first.');
  const [mapping] = await db.select().from(userAccessGroups)
    .where(and(eq(userAccessGroups.userId, userId), eq(userAccessGroups.accessGroupId, group.id))).limit(1);
  if (!mapping) await db.insert(userAccessGroups).values({ userId, accessGroupId: group.id });
  const [schoolAccess] = await db.select().from(userSchoolAccess)
    .where(and(eq(userSchoolAccess.userId, userId), eq(userSchoolAccess.schoolId, schoolId))).limit(1);
  if (!schoolAccess) await db.insert(userSchoolAccess).values({ userId, schoolId });
}

async function ensureOrgAdminSchoolAccess(schoolId: number) {
  const orgAdmins = await db.select({ id: users.id }).from(users).where(eq(users.role, "org_admin"));
  for (const admin of orgAdmins) {
    const [existing] = await db.select().from(userSchoolAccess)
      .where(and(eq(userSchoolAccess.userId, admin.id), eq(userSchoolAccess.schoolId, schoolId))).limit(1);
    if (!existing) await db.insert(userSchoolAccess).values({ userId: admin.id, schoolId });
  }
}

async function cleanupTransportSchool(schoolId: number) {
  // Prevent a later Fleet test from being silently broken by a Transport reset.
  try {
    const fleetLinks = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM fleet_vehicle_profiles f
      JOIN transport_vehicles v ON v.id=f.transport_vehicle_id
      WHERE v.school_id=${schoolId}
    `);
    if (Number(fleetLinks.rows[0]?.count ?? 0) > 0) {
      throw new Error("Cannot reset Transport test data because one or more test vehicles are already linked to Fleet. Remove those Fleet test links first.");
    }
  } catch (error: any) {
    if (error?.code !== "42P01") throw error; // Fleet table may not exist before Fleet schema is pushed.
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM transport_claim_allocations WHERE claim_id IN (SELECT id FROM transport_claims WHERE school_id=${schoolId})`);
    await tx.execute(sql`DELETE FROM transport_claim_deductions WHERE claim_id IN (SELECT id FROM transport_claims WHERE school_id=${schoolId})`);
    await tx.execute(sql`DELETE FROM transport_payouts WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_provider_adjustments WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_cashup_payments WHERE cashup_id IN (SELECT id FROM transport_cashups WHERE school_id=${schoolId})`);
    await tx.execute(sql`DELETE FROM transport_receipt_events WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_payment_allocations WHERE payment_id IN (SELECT id FROM transport_payments WHERE school_id=${schoolId})`);
    await tx.execute(sql`DELETE FROM transport_compliance_notification_log WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_compliance_overrides WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_documents WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_account_adjustments WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_cashups WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_refunds WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_payments WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_charges WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_path_node_learners WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_assignment_events WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_incidents WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_claims WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_subscription_rules WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_penalties WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_advances WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_vehicle_owner_history WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_vehicle_driver_history WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_driver_owner_history WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_assignments WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_path_nodes WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_vehicle_paths WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_service_points WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_pickup_points WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_vehicles WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_drivers WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_owners WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_routes WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_period_locks WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_document_requirements WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_settings WHERE school_id=${schoolId}`);
    await tx.execute(sql`DELETE FROM transport_audit_events WHERE school_id=${schoolId}`);
  });
}

async function ensureClass(schoolId: number) {
  const [existing] = await db.select().from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.className, "Transport Test Class"))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(classes).values({ schoolId, className: "Transport Test Class", shortCode: "TR-TST", capacity: 40 }).returning();
  return created;
}

async function ensureStaff(schoolId: number, year2: string) {
  const staffNo = `FCGS${year2}E9901TRT`;
  const [existing] = await db.select().from(staff).where(eq(staff.staffNo, staffNo)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(staff).values({
    schoolId,
    staffNo,
    firstName: "Tatenda",
    lastName: "Transport Test",
    email: "transport.manager@local.invalid",
    phone: "+263700000010",
    role: "administrator",
    status: "active",
    address: "Transport Test Address",
  }).returning();
  return created;
}

async function ensureParent(parentUserId: number, schoolId: number) {
  const [existing] = await db.select().from(parents).where(eq(parents.userId, parentUserId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(parents).values({
    userId: parentUserId,
    schoolId,
    firstName: "Patience",
    lastName: "Transport Parent",
    email: "transport.parent@local.invalid",
    phone: "+263700000020",
    address: "Transport Test Parent Address",
    relationship: "parent",
  }).returning();
  return created;
}

async function ensureStudent(args: {
  schoolId: number;
  classId: number;
  parentId: number;
  admissionNo: string;
  firstName: string;
  lastName: string;
}) {
  const [existing] = await db.select().from(students).where(eq(students.admissionNo, args.admissionNo)).limit(1);
  if (existing) {
    const [updated] = await db.update(students).set({
      schoolId: args.schoolId,
      classId: args.classId,
      parentId: args.parentId,
      firstName: args.firstName,
      lastName: args.lastName,
      status: "active",
      isDayScholar: true,
      isBoarding: false,
    }).where(eq(students.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(students).values({
    schoolId: args.schoolId,
    classId: args.classId,
    parentId: args.parentId,
    admissionNo: args.admissionNo,
    firstName: args.firstName,
    lastName: args.lastName,
    status: "active",
    isDayScholar: true,
    isBoarding: false,
    enrollmentDate: isoDate(new Date()),
  }).returning();
  return created;
}

async function createPath(args: {
  schoolId: number;
  routeId: number;
  vehicleId: number;
  name: string;
  effectiveFrom: string;
  userId: number;
  learnerLabels: string[];
  latOffset: number;
}) {
  const [path] = await db.insert(transportVehiclePaths).values({
    schoolId: args.schoolId,
    routeId: args.routeId,
    vehicleId: args.vehicleId,
    direction: "pickup",
    isTwoWay: true,
    canonicalTraversal: "forward",
    name: args.name,
    versionNumber: 1,
    status: "active",
    effectiveFrom: args.effectiveFrom,
    estimatedDistanceKm: "18.50",
    estimatedDurationMinutes: 45,
    notes: "Seeded local Transport test path. Create version 2 in the UI to test versioning.",
    createdByUserId: args.userId,
    activatedByUserId: args.userId,
    activatedAt: new Date(),
  }).returning();

  const nodes: any[] = [];
  nodes.push((await db.insert(transportPathNodes).values({
    schoolId: args.schoolId, pathId: path.id, nodeType: "start", name: "Test School Gate", latitude: String(-17.8252 + args.latOffset), longitude: "31.0335000", stopOrder: 1, expectedTime: "06:30", reverseExpectedTime: "16:45",
  }).returning())[0]);

  let order = 2;
  for (let i = 0; i < args.learnerLabels.length; i++) {
    nodes.push((await db.insert(transportPathNodes).values({
      schoolId: args.schoolId, pathId: path.id, nodeType: "learner_stop", name: `${args.learnerLabels[i]} Pickup`, latitude: String(-17.82 + args.latOffset + i * 0.002), longitude: String(31.04 + i * 0.002), stopOrder: order++, expectedTime: `06:${35 + i * 5}`,
    }).returning())[0]);
  }
  nodes.push((await db.insert(transportPathNodes).values({
    schoolId: args.schoolId, pathId: path.id, nodeType: "checkpoint", name: "Mandatory Test Checkpoint", latitude: String(-17.81 + args.latOffset), longitude: "31.0600000", stopOrder: order++, checkpointRadiusMeters: 50, notes: "Use this node to test mandatory checkpoint handling.",
  }).returning())[0]);
  for (let i = args.learnerLabels.length - 1; i >= 0; i--) {
    nodes.push((await db.insert(transportPathNodes).values({
      schoolId: args.schoolId, pathId: path.id, nodeType: "learner_stop", name: `${args.learnerLabels[i]} Drop-off`, latitude: String(-17.8195 + args.latOffset + i * 0.002), longitude: String(31.0405 + i * 0.002), stopOrder: order++, reverseExpectedTime: `16:${20 + i * 5}`,
    }).returning())[0]);
  }
  nodes.push((await db.insert(transportPathNodes).values({
    schoolId: args.schoolId, pathId: path.id, nodeType: "destination", name: "Test School Destination", latitude: String(-17.8250 + args.latOffset), longitude: "31.0337000", stopOrder: order, expectedTime: "07:15", reverseExpectedTime: "16:00",
  }).returning())[0]);

  const pickupNodes = nodes.filter((node) => String(node.name).endsWith(" Pickup"));
  const dropoffNodes = nodes.filter((node) => String(node.name).endsWith(" Drop-off"));
  return { path, pickupNodes, dropoffNodes };
}

async function main() {
  localDatabaseGuard();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const year2 = String(year).slice(-2);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const midMonthStart = `${year}-${String(month).padStart(2, "0")}-15`;
  const futureExpiry = isoDate(addDays(now, 365));

  const [organization] = await db.select().from(organizations).orderBy(organizations.id).limit(1);
  if (!organization) throw new Error("No organization exists. Run the normal local seed first.");

  const school = await findOrCreateSchool(organization.id, year);
  const admin = await ensureUser({ username: "transport_test_admin", role: "school_admin", firstName: "Transport", lastName: "Test Admin", email: "transport.admin@local.invalid", schoolId: school.id, organizationId: organization.id });
  const verifier = await ensureUser({ username: "transport_test_verifier", role: "school_admin", firstName: "Transport", lastName: "Test Verifier", email: "transport.verifier@local.invalid", schoolId: school.id, organizationId: organization.id });
  const parentUser = await ensureUser({ username: "transport_test_parent", role: "parent", firstName: "Patience", lastName: "Transport Parent", email: "transport.parent@local.invalid", schoolId: school.id, organizationId: organization.id });
  await ensureSchoolAdminAccess(admin.id, school.id);
  await ensureSchoolAdminAccess(verifier.id, school.id);
  await ensureOrgAdminSchoolAccess(school.id);

  const classRow = await ensureClass(school.id);
  const managerStaff = await ensureStaff(school.id, year2);
  const parentRow = await ensureParent(parentUser.id, school.id);

  const studentSpecs = [
    ["9901", "Tariro", "Full Month"],
    ["9902", "Simba", "Full Month B"],
    ["9903", "Nyasha", "Capacity Candidate"],
    ["9904", "Rudo", "Inbound Only"],
    ["9905", "Tawanda", "Outbound Only"],
    ["9906", "Chipo", "Midmonth"],
  ] as const;
  const learnerRows: any[] = [];
  for (const [sequence, firstName, lastName] of studentSpecs) {
    learnerRows.push(await ensureStudent({
      schoolId: school.id,
      classId: classRow.id,
      parentId: parentRow.id,
      admissionNo: `FCGS${year2}S${sequence}TRT`,
      firstName,
      lastName,
    }));
  }

  const existingRoutes = await db.select({ id: transportRoutes.id }).from(transportRoutes).where(eq(transportRoutes.schoolId, school.id)).limit(1);
  if (existingRoutes.length && !RESET) {
    console.log(JSON.stringify({
      status: "ALREADY_SEEDED",
      message: "Transport test data already exists for the dedicated test school. Use --reset to clear all Transport records in this test school and recreate the baseline.",
      school: { id: school.id, name: school.name, shortCode: school.shortCode },
      credentials: { operator: "transport_test_admin", verifier: "transport_test_verifier", parent: "transport_test_parent", password: TEST_PASSWORD },
    }, null, 2));
    return;
  }
  if (RESET) await cleanupTransportSchool(school.id);

  const [settings] = await db.insert(transportSettings).values({
    schoolId: school.id,
    transportManagerStaffId: managerStaff.id,
    currencyCode: "USD",
    stopGroupingDistanceMeters: 30,
    inboundOneWayPercent: "60.00",
    outboundOneWayPercent: "60.00",
    joiningFullChargeThroughDay: 5,
    refundNoCreditRemainingDays: 5,
    pendingSeatReservationEnabled: true,
    pendingSeatReservationDays: 7,
    overdueWarningDays: 7,
    suspensionEligibilityDays: 30,
    suspensionNoticeDays: 3,
    minimumSuspensionBalance: "0.00",
    receiptPrefix: "TT",
    receiptSequenceLength: 6,
    receiptResetYearly: true,
    receiptNextSequence: 1,
    receiptSequenceYear: year,
    receiptFooter: "LOCAL TRANSPORT TEST RECEIPT",
    printCopiesOnOnePage: true,
    requireCashupForClaim: true,
    reportWeekStartsOn: 1,
    mapProvider: "openstreetmap",
    defaultCheckpointRadiusMeters: 50,
    attachmentSizeLimitMB: 25,
    complianceNotificationDays: [30, 14, 7, 1, 0],
    complianceNotificationRecipients: ["transport_manager"],
    approvalWorkflow: {},
    deductionPriority: ["refund", "subscription", "penalty", "advance", "other"],
  }).returning();
  await ensureTransportDocumentRequirements(school.id);

  const [centralRoute, staffRoute, providerRoute] = await db.insert(transportRoutes).values([
    { schoolId: school.id, name: "Transport Test Central Route", code: "TRT-CENTRAL", direction: "both", defaultFee: "100.00", billingFrequency: "monthly", departureTime: "06:30", arrivalTime: "07:15", status: "active", isActive: true, notes: "Capacity test route." , createdByUserId: admin.id },
    { schoolId: school.id, name: "Transport Test Staff-Owned Route", code: "TRT-STAFF", direction: "both", defaultFee: "100.00", billingFrequency: "monthly", departureTime: "06:35", arrivalTime: "07:20", status: "active", isActive: true, notes: "Staff-owner settlement test route.", createdByUserId: admin.id },
    { schoolId: school.id, name: "Transport Test Provider Route", code: "TRT-PROVIDER", direction: "both", defaultFee: "100.00", billingFrequency: "monthly", departureTime: "06:40", arrivalTime: "07:25", status: "active", isActive: true, notes: "Contracted provider claim/payout test route.", createdByUserId: admin.id },
  ]).returning();

  const [staffOwner, providerOwner] = await db.insert(transportOwners).values([
    { schoolId: school.id, name: "Transport Test Staff Owner", ownerType: "individual", phone: "+263700000030", email: "staff.owner@local.invalid", address: "Test Staff Owner Address", alternativeContactName: "Test Alternative Contact", alternativeContactPhone: "+263700000031", isStaffOwner: true, staffId: managerStaff.id, nationalIdOrRegistration: "TEST-ID-STAFF-001", paymentDetails: "Local test payment details", isActive: true, effectiveFrom: periodStart, notes: "Dummy staff owner for Transport testing." },
    { schoolId: school.id, name: "Transport Test Coaches (Pvt) Ltd", ownerType: "company", phone: "+263700000040", email: "provider@local.invalid", address: "Test Provider Yard", alternativeContactName: "Provider Contact", alternativeContactPhone: "+263700000041", isStaffOwner: false, nationalIdOrRegistration: "TRTEST-COMPANY-001", paymentDetails: "Local test provider bank account", isActive: true, effectiveFrom: periodStart, notes: "Dummy contracted transport provider." },
  ]).returning();

  const [internalDriver, providerDriver] = await db.insert(transportDrivers).values([
    { schoolId: school.id, ownerId: null, firstName: "Tendai", lastName: "Internal Driver", phone: "+263700000050", homeAddress: "Test Driver Address", nationalId: "TEST-NID-DRV-01", licenceNumber: "TEST-DL-INT-001", licenceExpiry: futureExpiry, engagementType: "internal", nextOfKinName: "Internal Driver NOK", nextOfKinRelationship: "Sibling", nextOfKinPhone: "+263700000051", complianceStatus: "compliant", isActive: true, effectiveFrom: periodStart, notes: "Dummy internal driver." },
    { schoolId: school.id, ownerId: providerOwner.id, firstName: "Brian", lastName: "Provider Driver", phone: "+263700000060", homeAddress: "Provider Driver Address", nationalId: "TEST-NID-DRV-02", licenceNumber: "TEST-DL-EXT-001", licenceExpiry: futureExpiry, engagementType: "external", nextOfKinName: "Provider Driver NOK", nextOfKinRelationship: "Spouse", nextOfKinPhone: "+263700000061", complianceStatus: "compliant", isActive: true, effectiveFrom: periodStart, notes: "Dummy external provider driver." },
  ]).returning();
  await db.insert(transportDriverOwnerHistory).values([
    { schoolId: school.id, driverId: internalDriver.id, ownerId: null, effectiveFrom: periodStart, reason: "Seeded internal driver", createdByUserId: admin.id },
    { schoolId: school.id, driverId: providerDriver.id, ownerId: providerOwner.id, effectiveFrom: periodStart, reason: "Seeded provider driver", createdByUserId: admin.id },
  ]);

  const [schoolVehicle, staffVehicle, providerVehicle] = await db.insert(transportVehicles).values([
    { schoolId: school.id, registrationNumber: "TST 1001", makeModel: "Toyota Hiace Test", capacity: 2, ownershipType: "school", ownerId: null, driverId: internalDriver.id, registrationExpiry: futureExpiry, insuranceExpiry: futureExpiry, fitnessExpiry: futureExpiry, radioLicenceExpiry: futureExpiry, complianceStatus: "compliant", status: "active", isActive: true, notes: "Capacity is intentionally 2. Two learners are already assigned." },
    { schoolId: school.id, registrationNumber: "TST 2002", makeModel: "Toyota Quantum Test", capacity: 4, ownershipType: "staff", ownerId: staffOwner.id, driverId: internalDriver.id, registrationExpiry: futureExpiry, insuranceExpiry: futureExpiry, fitnessExpiry: futureExpiry, radioLicenceExpiry: futureExpiry, complianceStatus: "compliant", status: "active", isActive: true, notes: "Staff-owned settlement test vehicle." },
    { schoolId: school.id, registrationNumber: "TST 3003", makeModel: "Mercedes Sprinter Test", capacity: 18, ownershipType: "contracted", ownerId: providerOwner.id, driverId: providerDriver.id, registrationExpiry: futureExpiry, insuranceExpiry: futureExpiry, fitnessExpiry: futureExpiry, radioLicenceExpiry: futureExpiry, complianceStatus: "compliant", status: "active", isActive: true, notes: "Contracted provider claim and payout test vehicle." },
  ]).returning();
  await db.insert(transportVehicleOwnerHistory).values([
    { schoolId: school.id, vehicleId: staffVehicle.id, ownerId: staffOwner.id, effectiveFrom: periodStart, reason: "Seeded staff ownership", createdByUserId: admin.id },
    { schoolId: school.id, vehicleId: providerVehicle.id, ownerId: providerOwner.id, effectiveFrom: periodStart, reason: "Seeded contracted ownership", createdByUserId: admin.id },
  ]);
  await db.insert(transportVehicleDriverHistory).values([
    { schoolId: school.id, vehicleId: schoolVehicle.id, driverId: internalDriver.id, effectiveFrom: periodStart, reason: "Seeded driver assignment", createdByUserId: admin.id },
    { schoolId: school.id, vehicleId: staffVehicle.id, driverId: internalDriver.id, effectiveFrom: periodStart, reason: "Seeded driver assignment", createdByUserId: admin.id },
    { schoolId: school.id, vehicleId: providerVehicle.id, driverId: providerDriver.id, effectiveFrom: periodStart, reason: "Seeded driver assignment", createdByUserId: admin.id },
  ]);

  const points = new Map<number, { pickup: any; dropoff: any }>();
  for (let i = 0; i < learnerRows.length; i++) {
    const learner = learnerRows[i];
    const lat = -17.82 + i * 0.002;
    const lon = 31.04 + i * 0.002;
    const [pickup, dropoff] = await db.insert(transportServicePoints).values([
      { schoolId: school.id, studentId: learner.id, pointType: "pickup", name: `${learner.firstName} Test Pickup`, latitude: String(lat), longitude: String(lon), address: `${10 + i} Test Street`, landmark: "Blue test marker", instructions: "Local test pickup point", privacyClass: "private_household", isTemporary: false, effectiveFrom: periodStart, isActive: true, createdByUserId: admin.id },
      { schoolId: school.id, studentId: learner.id, pointType: "dropoff", name: `${learner.firstName} Test Drop-off`, latitude: String(lat + 0.0005), longitude: String(lon + 0.0005), address: `${10 + i} Test Street`, landmark: "Red test marker", instructions: "Local test drop-off point", privacyClass: "private_household", isTemporary: false, effectiveFrom: periodStart, isActive: true, createdByUserId: admin.id },
    ]).returning();
    points.set(learner.id, { pickup, dropoff });
  }

  const schoolPath = await createPath({ schoolId: school.id, routeId: centralRoute.id, vehicleId: schoolVehicle.id, name: "TRTEST School Vehicle Path", effectiveFrom: periodStart, userId: admin.id, learnerLabels: ["Tariro", "Simba"], latOffset: 0 });
  const staffPath = await createPath({ schoolId: school.id, routeId: staffRoute.id, vehicleId: staffVehicle.id, name: "TRTEST Staff Vehicle Path", effectiveFrom: periodStart, userId: admin.id, learnerLabels: ["Rudo"], latOffset: 0.02 });
  const providerPath = await createPath({ schoolId: school.id, routeId: providerRoute.id, vehicleId: providerVehicle.id, name: "TRTEST Provider Vehicle Path", effectiveFrom: periodStart, userId: admin.id, learnerLabels: ["Tawanda", "Chipo"], latOffset: 0.04 });

  const assignmentSpecs = [
    { learner: learnerRows[0], route: centralRoute, vehicle: schoolVehicle, driver: internalDriver, pathInfo: schoolPath, pathIndex: 0, serviceType: "both", base: 100, agreed: 100, percent: 100, startDate: periodStart, note: "Full-month two-way learner on school vehicle." },
    { learner: learnerRows[1], route: centralRoute, vehicle: schoolVehicle, driver: internalDriver, pathInfo: schoolPath, pathIndex: 1, serviceType: "both", base: 100, agreed: 100, percent: 100, startDate: periodStart, note: "Second learner fills TST 1001 to its capacity of 2." },
    { learner: learnerRows[3], route: staffRoute, vehicle: staffVehicle, driver: internalDriver, pathInfo: staffPath, pathIndex: 0, serviceType: "pickup", base: 100, agreed: 60, percent: 60, startDate: periodStart, note: "Inbound-only learner: expected monthly fee USD 60 at 60%." },
    { learner: learnerRows[4], route: providerRoute, vehicle: providerVehicle, driver: providerDriver, pathInfo: providerPath, pathIndex: 0, serviceType: "dropoff", base: 100, agreed: 60, percent: 60, startDate: periodStart, note: "Outbound-only learner: expected monthly fee USD 60 at 60%." },
    { learner: learnerRows[5], route: providerRoute, vehicle: providerVehicle, driver: providerDriver, pathInfo: providerPath, pathIndex: 1, serviceType: "both", base: 100, agreed: 100, percent: 100, startDate: midMonthStart, note: "Mid-month learner starts on day 15 to test proration." },
  ] as const;

  const seededAssignments: any[] = [];
  for (const spec of assignmentSpecs) {
    const point = points.get(spec.learner.id)!;
    const pickupNode = spec.pathInfo.pickupNodes[spec.pathIndex];
    const dropoffNode = spec.pathInfo.dropoffNodes[spec.pathIndex];
    const [assignment] = await db.insert(transportAssignments).values({
      schoolId: school.id,
      studentId: spec.learner.id,
      routeId: spec.route.id,
      vehicleId: spec.vehicle.id,
      driverId: spec.driver.id,
      outboundVehicleId: spec.vehicle.id,
      inboundPathId: spec.serviceType === "dropoff" ? null : spec.pathInfo.path.id,
      inboundPathTraversal: "forward",
      outboundPathId: spec.serviceType === "pickup" ? null : spec.pathInfo.path.id,
      outboundPathTraversal: "reverse",
      pickupServicePointId: spec.serviceType === "dropoff" ? null : point.pickup.id,
      dropoffServicePointId: spec.serviceType === "pickup" ? null : point.dropoff.id,
      pickupPathNodeId: spec.serviceType === "dropoff" ? null : pickupNode.id,
      dropoffPathNodeId: spec.serviceType === "pickup" ? null : dropoffNode.id,
      serviceType: spec.serviceType,
      serviceState: "active",
      planningStatus: "path_confirmed",
      financialStatus: "pending_first_payment",
      billingFrequency: "monthly",
      baseMonthlyFee: String(spec.base),
      agreedFee: String(spec.agreed),
      oneWayPercentSnapshot: String(spec.percent),
      startDate: spec.startDate,
      isActive: true,
      notes: spec.note,
      createdByUserId: admin.id,
    }).returning();
    seededAssignments.push(assignment);
    if (assignment.pickupPathNodeId && assignment.pickupServicePointId) {
      await db.insert(transportPathNodeLearners).values({ schoolId: school.id, pathNodeId: assignment.pickupPathNodeId, assignmentId: assignment.id, servicePointId: assignment.pickupServicePointId, boardsHere: true, alightsHere: false, effectiveFrom: assignment.startDate });
    }
    if (assignment.dropoffPathNodeId && assignment.dropoffServicePointId) {
      await db.insert(transportPathNodeLearners).values({ schoolId: school.id, pathNodeId: assignment.dropoffPathNodeId, assignmentId: assignment.id, servicePointId: assignment.dropoffServicePointId, boardsHere: false, alightsHere: true, effectiveFrom: assignment.startDate });
    }
  }

  await db.insert(transportAuditEvents).values({
    schoolId: school.id,
    entityType: "test_dataset",
    entityId: null,
    action: "seed_local_transport_test_data",
    previousValues: null,
    newValues: { schoolCode: TEST_SCHOOL_CODE, routes: 3, vehicles: 3, assignments: seededAssignments.length, unassignedCapacityCandidateStudentId: learnerRows[2].id },
    reason: "Local-only end-to-end Transport test baseline",
    userId: admin.id,
  });

  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const midMonthDays = Math.max(0, days - 15 + 1);
  const midMonthExpected = Math.round((100 * midMonthDays / days + Number.EPSILON) * 100) / 100;

  console.log(JSON.stringify({
    status: "SEEDED",
    mode: "LOCAL_ONLY",
    school: { id: school.id, name: school.name, shortCode: school.shortCode },
    credentials: {
      operator: { username: admin.username, password: TEST_PASSWORD, loginRole: "staff", purpose: "Record payments, prepare cash-up, prepare claims, approve claims/payouts" },
      verifier: { username: verifier.username, password: TEST_PASSWORD, loginRole: "staff", purpose: "Verify payments/cash-ups/claims so separation-of-duties checks can be tested" },
      parent: { username: parentUser.username, password: TEST_PASSWORD, loginRole: "parent", purpose: "Check parent-facing notifications generated by Transport actions" },
    },
    currentTestPeriod: { year, month, term: "term2", periodStart, midMonthStart },
    settings: { inboundOneWayPercent: 60, outboundOneWayPercent: 60, joiningFullChargeThroughDay: 5, requireCashupForClaim: true },
    vehicles: [
      { registration: schoolVehicle.registrationNumber, ownership: "school", capacity: schoolVehicle.capacity, assignedLearners: 2, purpose: "Capacity protection" },
      { registration: staffVehicle.registrationNumber, ownership: "staff", owner: staffOwner.name, purpose: "Staff-owner settlement" },
      { registration: providerVehicle.registrationNumber, ownership: "contracted", owner: providerOwner.name, purpose: "Provider claim and payout" },
    ],
    learners: [
      { name: "Tariro Full Month", admissionNo: learnerRows[0].admissionNo, expectedCharge: 100, vehicle: schoolVehicle.registrationNumber },
      { name: "Simba Full Month B", admissionNo: learnerRows[1].admissionNo, expectedCharge: 100, vehicle: schoolVehicle.registrationNumber },
      { name: "Nyasha Capacity Candidate", admissionNo: learnerRows[2].admissionNo, expectedCharge: null, vehicle: null, purpose: `Try assigning to ${schoolVehicle.registrationNumber}; it should be blocked because capacity is already 2/2.` },
      { name: "Rudo Inbound Only", admissionNo: learnerRows[3].admissionNo, expectedCharge: 60, vehicle: staffVehicle.registrationNumber },
      { name: "Tawanda Outbound Only", admissionNo: learnerRows[4].admissionNo, expectedCharge: 60, vehicle: providerVehicle.registrationNumber },
      { name: "Chipo Midmonth", admissionNo: learnerRows[5].admissionNo, expectedCharge: midMonthExpected, vehicle: providerVehicle.registrationNumber, formula: `100 × ${midMonthDays}/${days}` },
    ],
    expectedChargeBatchTotal: Math.round((320 + midMonthExpected + Number.EPSILON) * 100) / 100,
    nextStep: `Log in as ${admin.username}, select ${TEST_SCHOOL_NAME}, and generate charges for ${year}-${String(month).padStart(2, "0")}.`,
    resetCommand: "npx dotenv -e .env -- npm run transport:test-data:reset",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
