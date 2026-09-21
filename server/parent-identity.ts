import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "./db";
import { parents, schools, students, users, type Parent, type User } from "@shared/schema";

export function normalizeParentPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export async function getParentRecordsForUser(userId: number) {
  return db.select().from(parents).where(eq(parents.userId, userId));
}

export async function getParentIdsForUser(userId: number): Promise<number[]> {
  const rows = await db.select({ id: parents.id }).from(parents).where(eq(parents.userId, userId));
  return rows.map((row) => Number(row.id));
}

export async function getChildrenForParentUser(userId: number) {
  const parentIds = await getParentIdsForUser(userId);
  if (!parentIds.length) return [];
  return db.select().from(students).where(and(inArray(students.parentId, parentIds), isNull(students.archivedAt), or(isNull(students.status), ne(students.status, "internally_transferred"))));
}

export async function getAccessibleSchoolIdsForParentUser(userId: number): Promise<number[]> {
  const rows = await db.select({ schoolId: parents.schoolId }).from(parents).where(eq(parents.userId, userId));
  return Array.from(new Set(rows.map((row) => Number(row.schoolId)).filter((id) => Number.isFinite(id) && id > 0)));
}

export async function parentUserCanAccessStudent(userId: number, studentId: number): Promise<boolean> {
  const parentIds = await getParentIdsForUser(userId);
  if (!parentIds.length) return false;
  const [row] = await db.select({ id: students.id }).from(students).where(and(eq(students.id, studentId), inArray(students.parentId, parentIds))).limit(1);
  return Boolean(row);
}

type ParentIdentityRow = {
  parent: Parent;
  schoolName: string | null;
  organizationId: number | null;
};

async function identityPoolForSchool(schoolId: number): Promise<ParentIdentityRow[]> {
  const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) return [];
  return db.select({
    parent: parents,
    schoolName: schools.name,
    organizationId: schools.organizationId,
  }).from(parents)
    .innerJoin(schools, eq(parents.schoolId, schools.id))
    .where(eq(schools.organizationId, school.organizationId));
}

export async function findParentIdentityMatches(options: {
  schoolId: number;
  phone?: string | null;
  excludeParentId?: number | null;
}) {
  const phoneKey = normalizeParentPhone(options.phone);
  if (phoneKey.length < 7) return [] as ParentIdentityRow[];
  const pool = await identityPoolForSchool(options.schoolId);
  return pool.filter((row) => row.parent.id !== options.excludeParentId && normalizeParentPhone(row.parent.phone) === phoneKey);
}

export async function describeParentIdentityMatch(options: {
  schoolId: number;
  phone?: string | null;
  excludeParentId?: number | null;
}) {
  const matches = await findParentIdentityMatches(options);
  if (!matches.length) return null;
  const parentIds = matches.map((row) => row.parent.id);
  const childRows = parentIds.length
    ? await db.select({
        id: students.id,
        parentId: students.parentId,
        schoolId: students.schoolId,
        firstName: students.firstName,
        lastName: students.lastName,
        admissionNo: students.admissionNo,
      }).from(students).where(inArray(students.parentId, parentIds))
    : [];
  const userIds = Array.from(new Set(matches.map((row) => row.parent.userId).filter((id): id is number => Number(id) > 0)));
  const linkedUsers = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
  const primary = matches.find((row) => row.parent.userId) || matches[0];
  return {
    phoneKey: normalizeParentPhone(options.phone),
    parentId: primary.parent.id,
    userId: primary.parent.userId || null,
    firstName: primary.parent.firstName,
    lastName: primary.parent.lastName,
    email: primary.parent.email || null,
    phone: primary.parent.phone,
    conflictingUserIds: userIds.length > 1 ? userIds : [],
    schools: matches.map((row) => ({
      parentId: row.parent.id,
      schoolId: row.parent.schoolId,
      schoolName: row.schoolName,
      userId: row.parent.userId || null,
      children: childRows.filter((child) => child.parentId === row.parent.id).map((child) => ({
        id: child.id,
        admissionNo: child.admissionNo,
        firstName: child.firstName,
        lastName: child.lastName,
      })),
    })),
    user: linkedUsers.length === 1 ? sanitizeUser(linkedUsers[0]) : null,
  };
}

function sanitizeUser(user: User) {
  const { password: _password, ...safe } = user;
  return safe;
}

export async function linkParentIdentityToUser(parentId: number, userId: number) {
  const [parent] = await db.select().from(parents).where(eq(parents.id, parentId)).limit(1);
  if (!parent || !parent.schoolId) throw new Error("Parent record not found");
  const matches = [{ parent, schoolName: null, organizationId: null }, ...(await findParentIdentityMatches({ schoolId: parent.schoolId, phone: parent.phone, excludeParentId: parent.id }))];
  const conflicting = Array.from(new Set(matches.map((row) => row.parent.userId).filter((id): id is number => Number(id) > 0 && Number(id) !== Number(userId))));
  if (conflicting.length) {
    throw new Error("This phone number is already linked to more than one portal account. Correct the parent identity before continuing.");
  }
  const ids = matches.map((row) => row.parent.id);
  if (ids.length) await db.update(parents).set({ userId }).where(inArray(parents.id, ids));
  return ids;
}

export async function existingUserForParentIdentity(parentId: number) {
  const [parent] = await db.select().from(parents).where(eq(parents.id, parentId)).limit(1);
  if (!parent || !parent.schoolId) return null;
  const description = await describeParentIdentityMatch({ schoolId: parent.schoolId, phone: parent.phone, excludeParentId: parent.id });
  if (!description || description.conflictingUserIds.length || !description.userId) return null;
  const [user] = await db.select().from(users).where(eq(users.id, description.userId)).limit(1);
  return user ? { user, description } : null;
}
