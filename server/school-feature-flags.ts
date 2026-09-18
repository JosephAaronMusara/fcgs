import { and, eq, or } from "drizzle-orm";
import { db } from "./db";
import { fleetAllocations, fleetVehicleProfiles, schools, staff } from "@shared/schema";

export async function fleetRequirementForSchool(schoolId: number) {
  const vehicles = await db.select({ id: fleetVehicleProfiles.id }).from(fleetVehicleProfiles).where(and(
    eq(fleetVehicleProfiles.schoolId, schoolId),
    eq(fleetVehicleProfiles.isActive, true),
  ));
  const directAllocations = await db.select({ id: fleetAllocations.id }).from(fleetAllocations).where(and(
    eq(fleetAllocations.status, "active"),
    or(eq(fleetAllocations.allocatedToSchoolId, schoolId), eq(fleetAllocations.schoolId, schoolId)),
  ));
  const staffIds = (await db.select({ id: staff.id }).from(staff).where(eq(staff.schoolId, schoolId))).map(row => row.id);
  let staffAllocations: Array<{ id: number }> = [];
  if (staffIds.length) {
    const { inArray } = await import("drizzle-orm");
    staffAllocations = await db.select({ id: fleetAllocations.id }).from(fleetAllocations).where(and(
      eq(fleetAllocations.status, "active"),
      inArray(fleetAllocations.allocatedToStaffId, staffIds),
    ));
  }
  const required = vehicles.length > 0 || directAllocations.length > 0 || staffAllocations.length > 0;
  return { required, activeSchoolVehicles: vehicles.length, activeSchoolAllocations: directAllocations.length, activeStaffAllocations: staffAllocations.length };
}

export async function ensureFleetEnabledForSchool(schoolId: number | null | undefined) {
  if (!schoolId) return;
  const requirement = await fleetRequirementForSchool(schoolId);
  if (requirement.required) await db.update(schools).set({ enableFleetManagement: true }).where(eq(schools.id, schoolId));
}
