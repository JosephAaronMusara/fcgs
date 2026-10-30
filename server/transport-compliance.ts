import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db";
import { createInAppNotifications } from "./communication";
import {
  staff,
  transportComplianceNotificationLog,
  transportComplianceOverrides,
  transportDocumentRequirements,
  transportDocuments,
  transportDrivers,
  transportOwners,
  transportSettings,
  transportVehicles,
} from "@shared/schema";

const DEFAULT_REQUIREMENTS: Array<{
  entityType: "owner" | "driver" | "vehicle";
  ownerType?: "individual" | "company";
  categoryCode: string;
  label: string;
  isRequired?: boolean;
  allowsMultiple?: boolean;
  tracksExpiry?: boolean;
  isImage?: boolean;
  displayOrder: number;
}> = [
  { entityType: "owner", ownerType: "individual", categoryCode: "national_id", label: "National ID or Passport", isRequired: true, displayOrder: 10 },
  { entityType: "owner", ownerType: "individual", categoryCode: "proof_of_address", label: "Proof of Address", displayOrder: 20 },
  { entityType: "owner", ownerType: "individual", categoryCode: "service_agreement", label: "Transport / Service Agreement", isRequired: true, displayOrder: 30 },
  { entityType: "owner", ownerType: "individual", categoryCode: "payment_confirmation", label: "Bank or Payment Confirmation", displayOrder: 40 },
  { entityType: "owner", ownerType: "individual", categoryCode: "tax_document", label: "Tax Documentation", displayOrder: 50 },
  { entityType: "owner", ownerType: "individual", categoryCode: "other", label: "Other Supporting Document", allowsMultiple: true, displayOrder: 999 },
  { entityType: "owner", ownerType: "company", categoryCode: "company_registration", label: "Company Registration Certificate", isRequired: true, displayOrder: 10 },
  { entityType: "owner", ownerType: "company", categoryCode: "representative_id", label: "Authorized Representative ID", isRequired: true, displayOrder: 20 },
  { entityType: "owner", ownerType: "company", categoryCode: "representative_authorization", label: "Representative Authorization Letter", displayOrder: 30 },
  { entityType: "owner", ownerType: "company", categoryCode: "proof_of_address", label: "Proof of Company Address", displayOrder: 40 },
  { entityType: "owner", ownerType: "company", categoryCode: "service_agreement", label: "Transport / Service Agreement", isRequired: true, displayOrder: 50 },
  { entityType: "owner", ownerType: "company", categoryCode: "payment_confirmation", label: "Bank or Payment Confirmation", displayOrder: 60 },
  { entityType: "owner", ownerType: "company", categoryCode: "tax_document", label: "Tax Documentation", displayOrder: 70 },
  { entityType: "owner", ownerType: "company", categoryCode: "other", label: "Other Supporting Document", allowsMultiple: true, displayOrder: 999 },
  { entityType: "driver", categoryCode: "driver_photo", label: "Driver Photograph", isRequired: true, isImage: true, displayOrder: 10 },
  { entityType: "driver", categoryCode: "national_id", label: "National ID or Passport", isRequired: true, displayOrder: 20 },
  { entityType: "driver", categoryCode: "licence_front", label: "Driver's Licence - Front", isRequired: true, tracksExpiry: true, isImage: true, displayOrder: 30 },
  { entityType: "driver", categoryCode: "licence_back", label: "Driver's Licence - Back", isRequired: true, tracksExpiry: true, isImage: true, displayOrder: 40 },
  { entityType: "driver", categoryCode: "medical_fitness", label: "Medical Fitness Certificate", isRequired: true, tracksExpiry: true, displayOrder: 50 },
  { entityType: "driver", categoryCode: "defensive_driving", label: "Defensive Driving Certificate", tracksExpiry: true, displayOrder: 60 },
  { entityType: "driver", categoryCode: "first_aid", label: "First Aid Certificate", tracksExpiry: true, displayOrder: 70 },
  { entityType: "driver", categoryCode: "police_clearance", label: "Police Clearance", tracksExpiry: true, displayOrder: 80 },
  { entityType: "driver", categoryCode: "engagement_agreement", label: "Employment / Engagement Agreement", displayOrder: 90 },
  { entityType: "driver", categoryCode: "proof_of_address", label: "Proof of Address", displayOrder: 100 },
  { entityType: "driver", categoryCode: "operator_permit", label: "Operator / Public Service Permit", tracksExpiry: true, displayOrder: 110 },
  { entityType: "driver", categoryCode: "other_certificate", label: "Other Training Certificate", allowsMultiple: true, tracksExpiry: true, displayOrder: 120 },
  { entityType: "driver", categoryCode: "other", label: "Other Document", allowsMultiple: true, displayOrder: 999 },
  { entityType: "vehicle", categoryCode: "vehicle_front", label: "Vehicle Image - Front", isRequired: true, isImage: true, displayOrder: 10 },
  { entityType: "vehicle", categoryCode: "vehicle_rear", label: "Vehicle Image - Rear", isRequired: true, isImage: true, displayOrder: 20 },
  { entityType: "vehicle", categoryCode: "vehicle_left", label: "Vehicle Image - Left Side", isRequired: true, isImage: true, displayOrder: 30 },
  { entityType: "vehicle", categoryCode: "vehicle_right", label: "Vehicle Image - Right Side", isRequired: true, isImage: true, displayOrder: 40 },
  { entityType: "vehicle", categoryCode: "driver_cabin", label: "Vehicle Image - Driver Cabin", isImage: true, displayOrder: 50 },
  { entityType: "vehicle", categoryCode: "passenger_interior", label: "Vehicle Image - Passenger Interior", isImage: true, displayOrder: 60 },
  { entityType: "vehicle", categoryCode: "registration_plate", label: "Vehicle Image - Registration Plate", isImage: true, displayOrder: 70 },
  { entityType: "vehicle", categoryCode: "dashboard_odometer", label: "Vehicle Image - Dashboard / Odometer", isImage: true, displayOrder: 80 },
  { entityType: "vehicle", categoryCode: "engine_chassis", label: "Vehicle Image - Engine / Chassis", isImage: true, displayOrder: 90 },
  { entityType: "vehicle", categoryCode: "registration_certificate", label: "Vehicle Registration Certificate / Book", isRequired: true, tracksExpiry: true, displayOrder: 100 },
  { entityType: "vehicle", categoryCode: "proof_of_ownership", label: "Proof of Vehicle Ownership", isRequired: true, displayOrder: 110 },
  { entityType: "vehicle", categoryCode: "insurance", label: "Insurance Certificate", isRequired: true, tracksExpiry: true, displayOrder: 120 },
  { entityType: "vehicle", categoryCode: "fitness", label: "Fitness / Roadworthiness Certificate", isRequired: true, tracksExpiry: true, displayOrder: 130 },
  { entityType: "vehicle", categoryCode: "radio_licence", label: "Radio Licence", tracksExpiry: true, displayOrder: 140 },
  { entityType: "vehicle", categoryCode: "road_licence", label: "Road / Vehicle Licence", isRequired: true, tracksExpiry: true, displayOrder: 150 },
  { entityType: "vehicle", categoryCode: "operator_permit", label: "Route / Operator Permit", tracksExpiry: true, displayOrder: 160 },
  { entityType: "vehicle", categoryCode: "lease_agreement", label: "Lease / Contracted Service Agreement", tracksExpiry: true, displayOrder: 170 },
  { entityType: "vehicle", categoryCode: "maintenance_record", label: "Maintenance / Service Record", allowsMultiple: true, displayOrder: 180 },
  { entityType: "vehicle", categoryCode: "inspection_report", label: "Inspection Report", allowsMultiple: true, tracksExpiry: true, displayOrder: 190 },
  { entityType: "vehicle", categoryCode: "fire_extinguisher", label: "Fire Extinguisher Service", tracksExpiry: true, displayOrder: 200 },
  { entityType: "vehicle", categoryCode: "first_aid_kit", label: "First Aid Kit Inspection", tracksExpiry: true, displayOrder: 210 },
  { entityType: "vehicle", categoryCode: "tracking_device", label: "Tracking Device Information", displayOrder: 220 },
  { entityType: "vehicle", categoryCode: "accident_repair", label: "Accident / Repair Documentation", allowsMultiple: true, displayOrder: 230 },
  { entityType: "vehicle", categoryCode: "other", label: "Other Document or Image", allowsMultiple: true, displayOrder: 999 },
];

function requirementScopeKey(entityType: string, ownerType?: string | null): string {
  return `${entityType}:${ownerType || "all"}`;
}

export async function ensureTransportDocumentRequirements(schoolId: number): Promise<void> {
  const existing = await db.select({ id: transportDocumentRequirements.id }).from(transportDocumentRequirements)
    .where(eq(transportDocumentRequirements.schoolId, schoolId)).limit(1);
  if (existing.length) return;
  await db.insert(transportDocumentRequirements).values(DEFAULT_REQUIREMENTS.map((row) => ({
    schoolId,
    entityType: row.entityType,
    ownerType: row.ownerType || null,
    scopeKey: requirementScopeKey(row.entityType, row.ownerType),
    categoryCode: row.categoryCode,
    label: row.label,
    isRequired: row.isRequired || false,
    allowsMultiple: row.allowsMultiple || false,
    tracksExpiry: row.tracksExpiry || false,
    isImage: row.isImage || false,
    displayOrder: row.displayOrder,
  }))).onConflictDoNothing();
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysUntil(dateValue: string | Date): number {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const date = new Date(`${typeof dateValue === "string" ? dateValue.slice(0, 10) : toDateOnly(dateValue)}T00:00:00Z`).getTime();
  return Math.ceil((date - today) / 86_400_000);
}

export type TransportComplianceSummary = {
  status: "compliant" | "expiring_soon" | "expired" | "missing" | "overridden" | "unknown";
  missingCategories: string[];
  expiring: Array<{ categoryCode: string; expiryDate: string; daysRemaining: number; documentId?: number }>;
  expired: Array<{ categoryCode: string; expiryDate: string; daysRemaining: number; documentId?: number }>;
  overrideActive: boolean;
};

export async function calculateTransportCompliance(args: {
  schoolId: number;
  entityType: "owner" | "driver" | "vehicle";
  entityId: number;
  ownerType?: string | null;
}): Promise<TransportComplianceSummary> {
  await ensureTransportDocumentRequirements(args.schoolId);
  const scope = requirementScopeKey(args.entityType, args.entityType === "owner" ? args.ownerType : null);
  const [requirements, documents, overrides] = await Promise.all([
    db.select().from(transportDocumentRequirements).where(and(
      eq(transportDocumentRequirements.schoolId, args.schoolId),
      eq(transportDocumentRequirements.entityType, args.entityType),
      eq(transportDocumentRequirements.isActive, true),
      or(eq(transportDocumentRequirements.scopeKey, scope), eq(transportDocumentRequirements.scopeKey, `${args.entityType}:all`)),
    )).orderBy(asc(transportDocumentRequirements.displayOrder)),
    db.select().from(transportDocuments).where(and(
      eq(transportDocuments.schoolId, args.schoolId),
      eq(transportDocuments.entityType, args.entityType),
      eq(transportDocuments.entityId, args.entityId),
      eq(transportDocuments.isActive, true),
    )),
    db.select().from(transportComplianceOverrides).where(and(
      eq(transportComplianceOverrides.schoolId, args.schoolId),
      eq(transportComplianceOverrides.entityType, args.entityType),
      eq(transportComplianceOverrides.entityId, args.entityId),
      isNull(transportComplianceOverrides.revokedAt),
      gte(transportComplianceOverrides.expiresAt, new Date()),
    )),
  ]);
  const missingCategories = requirements.filter((requirement) => requirement.isRequired && !documents.some((document) => document.categoryCode === requirement.categoryCode)).map((requirement) => requirement.categoryCode);
  const expiring: TransportComplianceSummary["expiring"] = [];
  const expired: TransportComplianceSummary["expired"] = [];
  for (const document of documents) {
    if (!document.expiryDate) continue;
    const daysRemaining = daysUntil(document.expiryDate);
    const item = { categoryCode: document.categoryCode, expiryDate: document.expiryDate, daysRemaining, documentId: document.id };
    if (daysRemaining < 0) expired.push(item);
    else if (daysRemaining <= 30) expiring.push(item);
  }
  if (overrides.length) return { status: "overridden", missingCategories, expiring, expired, overrideActive: true };
  if (expired.length) return { status: "expired", missingCategories, expiring, expired, overrideActive: false };
  if (missingCategories.length) return { status: "missing", missingCategories, expiring, expired, overrideActive: false };
  if (expiring.length) return { status: "expiring_soon", missingCategories, expiring, expired, overrideActive: false };
  if (requirements.length === 0 && documents.length === 0) return { status: "unknown", missingCategories, expiring, expired, overrideActive: false };
  return { status: "compliant", missingCategories, expiring, expired, overrideActive: false };
}

async function explicitExpiryItems(schoolId: number) {
  const [vehicles, drivers, documents] = await Promise.all([
    db.select().from(transportVehicles).where(and(eq(transportVehicles.schoolId, schoolId), eq(transportVehicles.isActive, true))),
    db.select().from(transportDrivers).where(and(eq(transportDrivers.schoolId, schoolId), eq(transportDrivers.isActive, true))),
    db.select().from(transportDocuments).where(and(
      eq(transportDocuments.schoolId, schoolId),
      eq(transportDocuments.isActive, true),
      sql`${transportDocuments.expiryDate} is not null`,
    )),
  ]);
  const items = new Map<string, { entityType: "vehicle" | "driver" | "owner"; entityId: number; documentId: number | null; categoryCode: string; label: string; expiryDate: string; displayName: string }>();
  const names = new Map<string, string>();
  vehicles.forEach((vehicle) => names.set(`vehicle:${vehicle.id}`, vehicle.registrationNumber));
  drivers.forEach((driver) => names.set(`driver:${driver.id}`, `${driver.firstName} ${driver.lastName}`));

  const add = (item: { entityType: "vehicle" | "driver" | "owner"; entityId: number; documentId: number | null; categoryCode: string; label: string; expiryDate: string; displayName: string }) => {
    const key = `${item.entityType}:${item.entityId}:${item.categoryCode}:${item.expiryDate}`;
    const existing = items.get(key);
    if (!existing || (!existing.documentId && item.documentId)) items.set(key, item);
  };

  for (const vehicle of vehicles) {
    const values = [
      ["registration_certificate", "Vehicle registration", vehicle.registrationExpiry],
      ["insurance", "Vehicle insurance", vehicle.insuranceExpiry],
      ["fitness", "Vehicle fitness", vehicle.fitnessExpiry],
      ["radio_licence", "Vehicle radio licence", vehicle.radioLicenceExpiry],
    ] as const;
    for (const [categoryCode, label, expiryDate] of values) {
      if (expiryDate) add({ entityType: "vehicle", entityId: vehicle.id, documentId: null, categoryCode, label, expiryDate, displayName: vehicle.registrationNumber });
    }
  }
  for (const driver of drivers) {
    if (driver.licenceExpiry) add({ entityType: "driver", entityId: driver.id, documentId: null, categoryCode: "licence_front", label: "Driver licence", expiryDate: driver.licenceExpiry, displayName: `${driver.firstName} ${driver.lastName}` });
  }
  for (const document of documents) {
    if (!document.expiryDate || !["vehicle", "driver", "owner"].includes(document.entityType)) continue;
    let displayName = names.get(`${document.entityType}:${document.entityId}`) || `${document.entityType} #${document.entityId}`;
    if (document.entityType === "owner") {
      const [owner] = await db.select({ name: transportOwners.name }).from(transportOwners).where(and(eq(transportOwners.id, document.entityId), eq(transportOwners.schoolId, schoolId))).limit(1);
      if (owner?.name) displayName = owner.name;
    }
    add({
      entityType: document.entityType as "vehicle" | "driver" | "owner",
      entityId: document.entityId,
      documentId: document.id,
      categoryCode: document.categoryCode,
      label: document.categoryCode.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      expiryDate: document.expiryDate,
      displayName,
    });
  }
  return Array.from(items.values());
}

export async function scanTransportComplianceForSchool(schoolId: number, actorUserId?: number): Promise<{ notificationsCreated: number; vehiclesUpdated: number; driversUpdated: number }> {
  await ensureTransportDocumentRequirements(schoolId);
  const [settings] = await db.select().from(transportSettings).where(eq(transportSettings.schoolId, schoolId)).limit(1);
  const thresholds = Array.isArray(settings?.complianceNotificationDays)
    ? settings!.complianceNotificationDays.map((value) => Number(value)).filter((value) => [30, 14, 7, 1, 0].includes(value))
    : [30, 14, 7, 1, 0];
  const [vehicles, drivers] = await Promise.all([
    db.select().from(transportVehicles).where(eq(transportVehicles.schoolId, schoolId)),
    db.select().from(transportDrivers).where(eq(transportDrivers.schoolId, schoolId)),
  ]);
  let vehiclesUpdated = 0;
  let driversUpdated = 0;
  for (const vehicle of vehicles) {
    const compliance = await calculateTransportCompliance({ schoolId, entityType: "vehicle", entityId: vehicle.id });
    if (vehicle.complianceStatus !== compliance.status) {
      await db.update(transportVehicles).set({ complianceStatus: compliance.status, updatedAt: new Date() }).where(eq(transportVehicles.id, vehicle.id));
      vehiclesUpdated += 1;
    }
  }
  for (const driver of drivers) {
    const compliance = await calculateTransportCompliance({ schoolId, entityType: "driver", entityId: driver.id });
    if (driver.complianceStatus !== compliance.status) {
      await db.update(transportDrivers).set({ complianceStatus: compliance.status, updatedAt: new Date() }).where(eq(transportDrivers.id, driver.id));
      driversUpdated += 1;
    }
  }

  const recipientRows: Array<{ staffId: number; userId: number }> = [];
  if (settings?.transportManagerStaffId) {
    const [manager] = await db.select({ staffId: staff.id, userId: staff.userId }).from(staff).where(and(
      eq(staff.id, settings.transportManagerStaffId),
      eq(staff.schoolId, schoolId),
      eq(staff.status, "active"),
    )).limit(1);
    if (manager?.userId) recipientRows.push({ staffId: manager.staffId, userId: manager.userId });
  }
  if (!recipientRows.length) {
    const [fallback] = await db.select({ staffId: staff.id, userId: staff.userId }).from(staff).where(and(
      eq(staff.schoolId, schoolId),
      eq(staff.status, "active"),
      sql`${staff.userId} is not null`,
    )).orderBy(asc(staff.id)).limit(1);
    if (fallback?.userId) recipientRows.push({ staffId: fallback.staffId, userId: fallback.userId });
  }
  let notificationsCreated = 0;
  if (recipientRows.length) {
    for (const item of await explicitExpiryItems(schoolId)) {
      const remaining = daysUntil(item.expiryDate);
      const threshold = remaining < 0 ? 0 : thresholds.find((value) => value === remaining);
      if (threshold == null) continue;
      for (const recipient of recipientRows) {
        const [existing] = await db.select({ id: transportComplianceNotificationLog.id }).from(transportComplianceNotificationLog).where(and(
          eq(transportComplianceNotificationLog.schoolId, schoolId),
          eq(transportComplianceNotificationLog.entityType, item.entityType),
          eq(transportComplianceNotificationLog.entityId, item.entityId),
          eq(transportComplianceNotificationLog.categoryCode, item.categoryCode),
          eq(transportComplianceNotificationLog.thresholdDays, threshold),
          eq(transportComplianceNotificationLog.expiryDate, item.expiryDate),
          eq(transportComplianceNotificationLog.recipientUserId, recipient.userId),
        )).limit(1);
        if (existing) continue;
        await createInAppNotifications({
          recipientType: "staff",
          recipientIds: [recipient.staffId],
          title: remaining < 0 ? `${item.label} expired` : `${item.label} expires soon`,
          message: `${item.displayName}: ${item.label} ${remaining < 0 ? `expired ${Math.abs(remaining)} day(s) ago` : `expires in ${remaining} day(s)`} on ${item.expiryDate}.`,
          channel: "system",
          schoolId,
          actorUserId,
          link: `/transport?recordType=${item.entityType}&recordId=${item.entityId}&tab=compliance`,
          severity: remaining < 0 ? "critical" : remaining <= 7 ? "warning" : "info",
        });
        await db.insert(transportComplianceNotificationLog).values({
          schoolId,
          entityType: item.entityType,
          entityId: item.entityId,
          documentId: item.documentId,
          categoryCode: item.categoryCode,
          thresholdDays: threshold,
          expiryDate: item.expiryDate,
          recipientUserId: recipient.userId,
        }).onConflictDoNothing();
        notificationsCreated += 1;
      }
    }
  }
  return { notificationsCreated, vehiclesUpdated, driversUpdated };
}

export async function scanAllTransportCompliance(): Promise<void> {
  const [settingsSchools, vehicleSchools, driverSchools] = await Promise.all([
    db.selectDistinct({ schoolId: transportSettings.schoolId }).from(transportSettings),
    db.selectDistinct({ schoolId: transportVehicles.schoolId }).from(transportVehicles),
    db.selectDistinct({ schoolId: transportDrivers.schoolId }).from(transportDrivers),
  ]);
  const schoolIds = Array.from(new Set(
    [...settingsSchools, ...vehicleSchools, ...driverSchools]
      .map((row) => Number(row.schoolId))
      .filter((schoolId) => Number.isInteger(schoolId) && schoolId > 0),
  ));
  for (const schoolId of schoolIds) {
    await scanTransportComplianceForSchool(schoolId).catch((error) => console.error(`[Transport Compliance] School ${schoolId}:`, error));
  }
}
