import type { Express, Request } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  calendarEvents,
  calendarEventAttendees,
  calendarEventReminders,
  calendarEventClasses,
  calendarEventStaffViewers,
  classes,
  schools,
  staff,
  students,
  parents,
  schoolDayOverrides,
} from "../shared/schema";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { getParentIdsForUser } from "./parent-identity";

type AuthedUser = {
  id: number;
  role?: string;
  schoolId?: number | null;
  organizationId?: number | null;
};

// Helper: get logged-in user (match how your app stores auth user)
function getUser(req: Request): AuthedUser | null {
  // @ts-ignore
  return req.user ?? null;
}

function isStaffLikeRole(role?: string) {
  return role !== "student" && role !== "parent";
}

function intArrayParam(ids: number[]) {
  // ARRAY[1,2,3]::int[]
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::int[]`;
}

async function getStaffRowByUserId(userId: number) {
  const [row] = await db.select().from(staff).where(eq(staff.userId, userId));
  return row ?? null;
}

async function getStudentRowByUserId(userId: number) {
  const [row] = await db.select().from(students).where(eq(students.userId, userId));
  return row ?? null;
}

async function getParentRowByUserId(userId: number) {
  const [row] = await db.select().from(parents).where(eq(parents.userId, userId));
  return row ?? null;
}

async function getOrganizationIdBySchoolId(schoolId: number) {
  const [row] = await db
    .select({ organizationId: schools.organizationId })
    .from(schools)
    .where(eq(schools.id, schoolId));
  return row?.organizationId ?? null;
}


function toHarareDateText(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function calendarDateRange(start: Date, end: Date) {
  const startText = toHarareDateText(start);
  const endText = toHarareDateText(end);
  const dates: string[] = [];
  const cursor = new Date(`${startText}T12:00:00+02:00`);
  const last = new Date(`${endText}T12:00:00+02:00`);
  while (cursor <= last) {
    dates.push(toHarareDateText(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function getEventClassIds(eventId: number): Promise<number[]> {
  const rows = await db
    .select({ classId: calendarEventClasses.classId })
    .from(calendarEventClasses)
    .where(eq(calendarEventClasses.eventId, eventId));

  return rows.map((r) => r.classId).filter(Boolean) as number[];
}

async function isClassTeacherOfAny(staffId: number, classIds: number[]) {
  if (!classIds.length) return false;
  const rows = await db
    .select({ id: classes.id })
    .from(classes)
    .where(inArray(classes.id, classIds));

  // We need to check teacher per class; easiest is SQL:
  const result = await db.execute(sql`
    SELECT 1
    FROM classes
    WHERE id = ANY(${intArrayParam(classIds)})
      AND class_teacher_id = ${staffId}
    LIMIT 1
  `);

  return ((result as any).rows ?? []).length > 0;
}


async function hasCalendarPermission(userId: number, permissionCode: string) {
  return storage.userHasPermission(userId, permissionCode);
}

async function canCreateCalendarScope(userId: number, scope: string) {
  const permissionMap: Record<string, string> = {
    personal: "calendar.create.personal",
    class: "calendar.create.class",
    school: "calendar.create.school",
    org: "calendar.create.org",
  };
  const permission = permissionMap[scope];
  return permission ? hasCalendarPermission(userId, permission) : false;
}

async function canEditCalendarEvent(userId: number, scope: string, isOwnerLike: boolean, isScopedManager: boolean) {
  if (isOwnerLike && await hasCalendarPermission(userId, "calendar.edit.own")) return true;
  if (isScopedManager && await hasCalendarPermission(userId, "calendar.edit.scope")) return true;
  return false;
}

async function canDeleteCalendarEvent(userId: number, scope: string, isOwnerLike: boolean, isScopedManager: boolean) {
  if (isOwnerLike && await hasCalendarPermission(userId, "calendar.delete.own")) return true;
  if (isScopedManager && await hasCalendarPermission(userId, "calendar.delete.scope")) return true;
  return false;
}

function parseDateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d;
}

export function registerCalendarRoutes(app: Express) {
  /**
   * LIST events user can SEE
   * GET /api/calendar/events?from=ISO&to=ISO
   */
  app.get("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    const from = parseDateOrNull(req.query.from);
    const to = parseDateOrNull(req.query.to);
    if (!from || !to) {
      return res.status(400).json({ message: "from/to query params required (ISO dates)" });
    }

    // Determine identity type
    const staffRow = await getStaffRowByUserId(user.id);
    const studentRow = !staffRow ? await getStudentRowByUserId(user.id) : null;
    const parentRow = !staffRow && !studentRow ? await getParentRowByUserId(user.id) : null;

    let rows: any[] = [];

    // ----------------------------
    // STAFF (including school_admin/org_admin even if they don't have a staff row)
    // ----------------------------
    if (isStaffLikeRole(user.role) && !studentRow && !parentRow) {
      const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
      const orgIdCtx =
        user.organizationId ??
        (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

      const staffIdCtx = staffRow?.id ?? null;

      const schoolFilter = schoolIdCtx ? sql`e.school_id = ${schoolIdCtx}` : sql`false`;
      const orgFilter = orgIdCtx ? sql`e.organization_id = ${orgIdCtx}` : sql`false`;

      const staffIsClassTeacher = staffIdCtx ? sql`c.class_teacher_id = ${staffIdCtx}` : sql`false`;
      const staffIsViewer = staffIdCtx ? sql`sv.staff_id = ${staffIdCtx}` : sql`false`;

      // Admins: can see all class events in their school (useful for oversight)
      const adminCanSeeAllClassInSchool =
        user.role === "school_admin" || user.role === "org_admin" ? sql`true` : sql`false`;

      const result = await db.execute(sql`
        SELECT
          e.*,
          COALESCE(json_agg(DISTINCT ec.class_id) FILTER (WHERE ec.class_id IS NOT NULL), '[]') AS "classIds",
          COALESCE(json_agg(DISTINCT sv.staff_id) FILTER (WHERE sv.staff_id IS NOT NULL), '[]') AS "staffViewerIds"
        FROM calendar_events e
        LEFT JOIN calendar_event_classes ec ON ec.event_id = e.id
        LEFT JOIN classes c ON c.id = ec.class_id
        LEFT JOIN calendar_event_staff_viewers sv ON sv.event_id = e.id
        WHERE e.start_at < ${to} AND e.end_at > ${from}
          AND (
            -- personal events you own
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            -- class events:
            (e.scope = 'class' AND ${schoolFilter} AND (
              e.created_by_user_id = ${user.id}
              OR ${adminCanSeeAllClassInSchool}
              OR ${staffIsClassTeacher}
              OR ${staffIsViewer}
            ))
            OR
            -- school events: all staff in same school
            (e.scope = 'school' AND ${schoolFilter})
            OR
            -- org/HQ events: all staff in same org
            (e.scope = 'org' AND ${orgFilter})
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);

      rows = (result as any).rows ?? [];
      return res.json({ events: rows });
    }

    // ----------------------------
    // STUDENT (view-only)
    // ----------------------------
    if (studentRow) {
      const orgId = studentRow.schoolId ? await getOrganizationIdBySchoolId(studentRow.schoolId) : null;
      const orgFilter = orgId ? sql`e.organization_id = ${orgId}` : sql`false`;

      const result = await db.execute(sql`
        SELECT
          e.*,
          COALESCE(json_agg(DISTINCT ec.class_id) FILTER (WHERE ec.class_id IS NOT NULL), '[]') AS "classIds",
          '[]'::json AS "staffViewerIds"
        FROM calendar_events e
        LEFT JOIN calendar_event_classes ec ON ec.event_id = e.id
        WHERE e.start_at < ${to} AND e.end_at > ${from}
          AND (
            -- personal (kept for completeness; students don't create in our rules)
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            -- class events visible to students in their class
            (e.scope = 'class' AND e.include_students = true AND ec.class_id = ${studentRow.classId})
            OR
            -- school events visible to all students in school
            (e.scope = 'school' AND e.school_id = ${studentRow.schoolId} AND e.include_students = true)
            OR
            -- org events visible to students (default ON)
            (e.scope = 'org' AND ${orgFilter} AND e.include_students = true)
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);

      rows = (result as any).rows ?? [];
      return res.json({ events: rows });
    }

    // ----------------------------
    // PARENT (view-only)
    // ----------------------------
    if (parentRow) {
      // One parent portal user can be linked to school-specific parent records across multiple schools.
      const parentIds = await getParentIdsForUser(user.id);
      const childRows = parentIds.length ? await db
        .select({ classId: students.classId, schoolId: students.schoolId })
        .from(students)
        .where(inArray(students.parentId, parentIds)) : [];

      const childClassIds = childRows.map((r) => r.classId).filter(Boolean) as number[];
      const childSchoolIds = Array.from(
        new Set(childRows.map((r) => r.schoolId).filter(Boolean) as number[]),
      );

      if (childClassIds.length === 0 && childSchoolIds.length === 0) {
        return res.json({ events: [] });
      }

      const classIdsSql = childClassIds.length ? intArrayParam(childClassIds) : sql`ARRAY[]::int[]`;
      const schoolIdsSql = childSchoolIds.length ? intArrayParam(childSchoolIds) : sql`ARRAY[]::int[]`;

      // derive org(s) from school(s)
      let orgIds: number[] = [];
      if (childSchoolIds.length) {
        const orgRows = await db
          .select({ organizationId: schools.organizationId })
          .from(schools)
          .where(inArray(schools.id, childSchoolIds));
        orgIds = Array.from(new Set(orgRows.map((r) => r.organizationId).filter(Boolean) as number[]));
      }

      const orgIdsSql = orgIds.length ? intArrayParam(orgIds) : sql`ARRAY[]::int[]`;

      const result = await db.execute(sql`
        SELECT
          e.*,
          COALESCE(json_agg(DISTINCT ec.class_id) FILTER (WHERE ec.class_id IS NOT NULL), '[]') AS "classIds",
          '[]'::json AS "staffViewerIds"
        FROM calendar_events e
        LEFT JOIN calendar_event_classes ec ON ec.event_id = e.id
        WHERE e.start_at < ${to} AND e.end_at > ${from}
          AND (
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            -- class events where parents explicitly included
            (e.scope = 'class' AND e.include_parents = true AND ec.class_id = ANY(${classIdsSql}))
            OR
            -- school events where parents explicitly included
            (e.scope = 'school' AND e.include_parents = true AND e.school_id = ANY(${schoolIdsSql}))
            OR
            -- org events where parents explicitly included (checkbox)
            (e.scope = 'org' AND e.include_parents = true AND e.organization_id = ANY(${orgIdsSql}))
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);

      rows = (result as any).rows ?? [];
      return res.json({ events: rows });
    }

    return res.json({ events: [] });
  });

  /**
   * CREATE event
   * POST /api/calendar/events
   *
   * Supports: class, school, org, personal
   * - students/parents: view-only (no create)
   */
  app.post("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    if (!isStaffLikeRole(user.role)) {
      return res.status(403).json({ message: "Only staff can create events" });
    }
    if (!(await hasCalendarPermission(user.id, "calendar.view"))) {
      return res.status(403).json({ message: "You do not have calendar access" });
    }

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;

    const {
      scope,
      title,
      description,
      location,
      startAt,
      endAt,
      allDay,
      timezone,
      classIds,
      includeStudents,
      includeParents,
      staffViewerIds,
      attendanceExpectation,
    } = req.body ?? {};

    if (!scope || typeof scope !== "string") {
      return res.status(400).json({ message: "scope is required" });
    }
    if (!title || !startAt || !endAt) {
      return res.status(400).json({ message: "title, startAt, endAt are required" });
    }

    const start = new Date(startAt);
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ message: "Invalid startAt/endAt" });
    }

    const tz = timezone ? String(timezone) : "Africa/Harare";
    const incStudents = includeStudents !== false; // default true
    const incParents = !!includeParents; // default false

    // ----------------------------
    // CLASS EVENT (multi-class)
    // ----------------------------
    if (scope === "class") {
      if (!(await canCreateCalendarScope(user.id, "class"))) {
        return res.status(403).json({ message: "You do not have permission to create class events" });
      }
      if (!Array.isArray(classIds) || classIds.length === 0) {
        return res.status(400).json({ message: "classIds[] is required for scope=class" });
      }

      // Load classes
      const classRows = await db
        .select({
          id: classes.id,
          schoolId: classes.schoolId,
        })
        .from(classes)
        .where(inArray(classes.id, classIds));

      if (classRows.length !== classIds.length) {
        return res.status(400).json({ message: "One or more classIds are invalid" });
      }

      // Enforce SAME SCHOOL for multi-class events
      const schoolId = classRows[0].schoolId;
      if (!schoolId || classRows.some((c) => c.schoolId !== schoolId)) {
        return res.status(400).json({ message: "All selected classes must belong to the same school" });
      }

      // Any staff can create class events for any class in THEIR school
      if (!schoolIdCtx || schoolIdCtx !== schoolId) {
        return res.status(403).json({ message: "You can only create class events for your own school" });
      }

      // Get org
      const organizationId = await getOrganizationIdBySchoolId(schoolId);

      // Optional: validate staffViewerIds belong to same school
      const viewerIds = Array.isArray(staffViewerIds) ? staffViewerIds.filter(Boolean) : [];
      if (viewerIds.length > 0) {
        const viewerRows = await db
          .select({ id: staff.id, schoolId: staff.schoolId })
          .from(staff)
          .where(inArray(staff.id, viewerIds));

        if (viewerRows.length !== viewerIds.length) {
          return res.status(400).json({ message: "One or more staffViewerIds are invalid" });
        }
        if (viewerRows.some((v) => v.schoolId !== schoolId)) {
          return res.status(400).json({ message: "Selected staff viewers must be from the same school" });
        }
      }

      const created = await db.transaction(async (tx) => {
        const [ev] = await tx
          .insert(calendarEvents)
          .values({
            scope: "class",
            organizationId,
            schoolId,
            // keep classId for backward compatibility (first class)
            classId: classIds[0],
            ownerUserId: null,
            createdByUserId: user.id,
            title: String(title),
            description: description ? String(description) : null,
            location: location ? String(location) : null,
            startAt: start,
            endAt: end,
            allDay: !!allDay,
            timezone: tz,
            includeStudents: incStudents, // default true
            includeParents: incParents,   // default false unless checked
          })
          .returning();

        const eventId = ev.id;

        await tx
          .insert(calendarEventClasses)
          .values(classIds.map((cid: number) => ({ eventId, classId: cid })))
          .onConflictDoNothing();

        if (viewerIds.length > 0) {
          await tx
            .insert(calendarEventStaffViewers)
            .values(viewerIds.map((sid: number) => ({ eventId, staffId: sid })))
            .onConflictDoNothing();
        }

        return ev;
      });

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // SCHOOL EVENT
    // - created by school_admin/org_admin (safe default)
    // - visible to staff + students (includeStudents default ON)
    // - parents only if includeParents checked
    // ----------------------------
    if (scope === "school") {
      if (!(await canCreateCalendarScope(user.id, "school"))) {
        return res.status(403).json({ message: "You do not have permission to create school events" });
      }
      if (!schoolIdCtx) {
        return res.status(400).json({ message: "No school context for this user" });
      }

      const organizationId = await getOrganizationIdBySchoolId(schoolIdCtx);

      const expectation = attendanceExpectation === "no_regular_attendance" ? "no_regular_attendance" : "normal";
      const created = await db.transaction(async (tx) => {
        const [event] = await tx
          .insert(calendarEvents)
          .values({
            scope: "school",
            organizationId,
            schoolId: schoolIdCtx,
            classId: null,
            ownerUserId: null,
            createdByUserId: user.id,
            title: String(title),
            description: description ? String(description) : null,
            location: location ? String(location) : null,
            startAt: start,
            endAt: end,
            allDay: !!allDay,
            timezone: tz,
            includeStudents: incStudents,
            includeParents: incParents,
            attendanceExpectation: expectation,
          })
          .returning();

        if (expectation === "no_regular_attendance") {
          for (const overrideDate of calendarDateRange(start, end)) {
            await tx.insert(schoolDayOverrides).values({
              schoolId: schoolIdCtx,
              calendarEventId: event.id,
              overrideDate,
              isSchoolDay: false,
              reason: String(title),
              createdByUserId: user.id,
            }).onConflictDoUpdate({
              target: [schoolDayOverrides.schoolId, schoolDayOverrides.overrideDate],
              set: { calendarEventId: event.id, isSchoolDay: false, reason: String(title), createdByUserId: user.id, updatedAt: new Date() },
            });
          }
        }

        return event;
      });

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // ORG / HQ EVENT
    // - created by org_admin
    // - visible to staff in org
    // - students if includeStudents true
    // - parents only if includeParents checked
    // ----------------------------
    if (scope === "org") {
      if (!(await canCreateCalendarScope(user.id, "org"))) {
        return res.status(403).json({ message: "You do not have permission to create organization events" });
      }

      const orgId = user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);
      if (!orgId) {
        return res.status(400).json({ message: "No organization context for this user" });
      }

      const [created] = await db
        .insert(calendarEvents)
        .values({
          scope: "org",
          organizationId: orgId,
          schoolId: null,
          classId: null,
          ownerUserId: null,
          createdByUserId: user.id,
          title: String(title),
          description: description ? String(description) : null,
          location: location ? String(location) : null,
          startAt: start,
          endAt: end,
          allDay: !!allDay,
          timezone: tz,
          includeStudents: incStudents, // default true
          includeParents: incParents,   // optional checkbox
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // PERSONAL EVENT (staff only)
    // ----------------------------
    if (scope === "personal") {
      if (!isStaffLikeRole(user.role)) {
        return res.status(403).json({ message: "Only staff can create personal events" });
      }
      if (!(await canCreateCalendarScope(user.id, "personal"))) {
        return res.status(403).json({ message: "You do not have permission to create personal events" });
      }

      const orgId =
        user.organizationId ??
        (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

      const [created] = await db
        .insert(calendarEvents)
        .values({
          scope: "personal",
          organizationId: orgId,
          schoolId: schoolIdCtx,
          classId: null,
          ownerUserId: user.id,
          createdByUserId: user.id,
          title: String(title),
          description: description ? String(description) : null,
          location: location ? String(location) : null,
          startAt: start,
          endAt: end,
          allDay: !!allDay,
          timezone: tz,
          includeStudents: false,
          includeParents: false,
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    return res.status(400).json({ message: "Unsupported scope. Use personal|class|school|org" });
  });

  /**
   * EDIT event
   * PUT /api/calendar/events/:id
   */
  app.put("/api/calendar/events/:id", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    if (!isStaffLikeRole(user.role)) {
      return res.status(403).json({ message: "Only staff can edit events" });
    }
    if (!(await hasCalendarPermission(user.id, "calendar.view"))) {
      return res.status(403).json({ message: "You do not have calendar access" });
    }

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx =
      user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    // Authorization
    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    const isSchoolAdmin = user.role === "school_admin";
    const isOrgAdmin = user.role === "org_admin";

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && ev.organizationId && orgIdCtx === ev.organizationId;

    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    const ownerLike = ev.scope === "personal" ? isOwner : isCreator || isOwner || isClassTeacher;
    const scopedManager =
      ev.scope === "org"
        ? !!sameOrg
        : ev.scope === "school" || ev.scope === "class"
          ? !!sameSchool || !!sameOrg
          : false;

    const allowed = await canEditCalendarEvent(user.id, ev.scope, ownerLike, scopedManager);

    if (!allowed) return res.status(403).json({ message: "Not allowed to edit this event" });

    // Build patch
    const {
      title,
      description,
      location,
      startAt,
      endAt,
      allDay,
      timezone,
      includeStudents,
      includeParents,
      classIds,
      staffViewerIds,
      attendanceExpectation,
    } = req.body ?? {};

    const nextStart = startAt ? new Date(startAt) : (ev.startAt as unknown as Date);
    const nextEnd = endAt ? new Date(endAt) : (ev.endAt as unknown as Date);

    if (isNaN(nextStart.getTime()) || isNaN(nextEnd.getTime()) || nextEnd <= nextStart) {
      return res.status(400).json({ message: "Invalid startAt/endAt" });
    }

    // For class events, allow changing classIds + staffViewerIds
    const wantsClassIdsUpdate = Array.isArray(classIds);
    const wantsViewersUpdate = Array.isArray(staffViewerIds);

    // Validate classIds update if requested
    let newClassIds: number[] | null = null;
    let newSchoolIdForClassEvent: number | null = null;

    if (ev.scope === "class" && wantsClassIdsUpdate) {
      if (classIds.length === 0) return res.status(400).json({ message: "classIds[] cannot be empty" });

      const classRows = await db
        .select({ id: classes.id, schoolId: classes.schoolId })
        .from(classes)
        .where(inArray(classes.id, classIds));

      if (classRows.length !== classIds.length) {
        return res.status(400).json({ message: "One or more classIds are invalid" });
      }

      const schoolId = classRows[0].schoolId;
      if (!schoolId || classRows.some((c) => c.schoolId !== schoolId)) {
        return res.status(400).json({ message: "All selected classes must belong to the same school" });
      }

      // do not allow moving an event across schools
      if (ev.schoolId && ev.schoolId !== schoolId) {
        return res.status(400).json({ message: "Cannot move a class event to another school" });
      }

      // staff must have school context to manage class events
      if (!schoolIdCtx || schoolIdCtx !== schoolId) {
        return res.status(403).json({ message: "You can only set classIds within your own school" });
      }

      newClassIds = classIds.map((x: any) => Number(x)).filter((n: number) => !isNaN(n));
      newSchoolIdForClassEvent = schoolId;
    }

    // Validate viewers update if requested
    let newViewerIds: number[] | null = null;
    if (ev.scope === "class" && wantsViewersUpdate) {
      newViewerIds = staffViewerIds.map((x: any) => Number(x)).filter((n: number) => !isNaN(n));

      if (newViewerIds.length > 0) {
        // Must have a school context to validate viewers
        const schoolId = ev.schoolId ?? newSchoolIdForClassEvent;
        if (!schoolId) return res.status(400).json({ message: "Missing schoolId for class event" });

        const viewerRows = await db
          .select({ id: staff.id, schoolId: staff.schoolId })
          .from(staff)
          .where(inArray(staff.id, newViewerIds));

        if (viewerRows.length !== newViewerIds.length) {
          return res.status(400).json({ message: "One or more staffViewerIds are invalid" });
        }
        if (viewerRows.some((v) => v.schoolId !== schoolId)) {
          return res.status(400).json({ message: "Selected staff viewers must be from the same school" });
        }
      }
    }

    const patch: any = {
      updatedAt: new Date(),
      startAt: nextStart,
      endAt: nextEnd,
    };

    if (title !== undefined) patch.title = String(title);
    if (description !== undefined) patch.description = description ? String(description) : null;
    if (location !== undefined) patch.location = location ? String(location) : null;
    if (allDay !== undefined) patch.allDay = !!allDay;
    if (timezone !== undefined) patch.timezone = timezone ? String(timezone) : "Africa/Harare";
    if (includeStudents !== undefined) patch.includeStudents = includeStudents !== false;
    if (includeParents !== undefined) patch.includeParents = !!includeParents;
    if (ev.scope === "school" && attendanceExpectation !== undefined) patch.attendanceExpectation = attendanceExpectation === "no_regular_attendance" ? "no_regular_attendance" : "normal";

    // If scope is org/school, enforce same org/school context on edit (extra safety)
    if (ev.scope === "school" && ev.schoolId && schoolIdCtx && ev.schoolId !== schoolIdCtx && !(isOrgAdmin && sameOrg)) {
      return res.status(403).json({ message: "You can only edit school events for your school" });
    }
    if (ev.scope === "org" && ev.organizationId && orgIdCtx && ev.organizationId !== orgIdCtx) {
      return res.status(403).json({ message: "You can only edit org events in your organization" });
    }

    const updated = await db.transaction(async (tx) => {
      const [updatedEvent] = await tx
        .update(calendarEvents)
        .set({
          ...patch,
          // keep classId aligned with first class for class events if classIds updated
          ...(ev.scope === "class" && newClassIds ? { classId: newClassIds[0] } : {}),
        })
        .where(eq(calendarEvents.id, eventId))
        .returning();

      if (ev.scope === "school" && ev.schoolId) {
        await tx.delete(schoolDayOverrides).where(eq(schoolDayOverrides.calendarEventId, eventId));
        if (updatedEvent.attendanceExpectation === "no_regular_attendance") {
          for (const overrideDate of calendarDateRange(nextStart, nextEnd)) {
            await tx.insert(schoolDayOverrides).values({
              schoolId: ev.schoolId,
              calendarEventId: eventId,
              overrideDate,
              isSchoolDay: false,
              reason: String(updatedEvent.title),
              createdByUserId: user.id,
            }).onConflictDoUpdate({
              target: [schoolDayOverrides.schoolId, schoolDayOverrides.overrideDate],
              set: { calendarEventId: eventId, isSchoolDay: false, reason: String(updatedEvent.title), createdByUserId: user.id, updatedAt: new Date() },
            });
          }
        }
      }

      if (ev.scope === "class" && newClassIds) {
        // Replace class links
        await tx.delete(calendarEventClasses).where(eq(calendarEventClasses.eventId, eventId));
        await tx
          .insert(calendarEventClasses)
          .values(newClassIds.map((cid) => ({ eventId, classId: cid })))
          .onConflictDoNothing();
      }

      if (ev.scope === "class" && newViewerIds) {
        // Replace viewer links
        await tx.delete(calendarEventStaffViewers).where(eq(calendarEventStaffViewers.eventId, eventId));
        if (newViewerIds.length > 0) {
          await tx
            .insert(calendarEventStaffViewers)
            .values(newViewerIds.map((sid) => ({ eventId, staffId: sid })))
            .onConflictDoNothing();
        }
      }

      return updatedEvent;
    });

    return res.json({ event: updated });
  });

  /**
   * DELETE event
   * DELETE /api/calendar/events/:id
   */
  app.delete("/api/calendar/events/:id", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    if (!isStaffLikeRole(user.role)) {
      return res.status(403).json({ message: "Only staff can delete events" });
    }
    if (!(await hasCalendarPermission(user.id, "calendar.view"))) {
      return res.status(403).json({ message: "You do not have calendar access" });
    }

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx =
      user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    // Authorization
    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    const isSchoolAdmin = user.role === "school_admin";
    const isOrgAdmin = user.role === "org_admin";

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && ev.organizationId && orgIdCtx === ev.organizationId;

    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    const ownerLike = ev.scope === "personal" ? isOwner : isCreator || isOwner || isClassTeacher;
    const scopedManager =
      ev.scope === "org"
        ? !!sameOrg
        : ev.scope === "school" || ev.scope === "class"
          ? !!sameSchool || !!sameOrg
          : false;

    const allowed = await canDeleteCalendarEvent(user.id, ev.scope, ownerLike, scopedManager);

    if (!allowed) return res.status(403).json({ message: "Not allowed to delete this event" });

    await db.transaction(async (tx) => {
      // delete children first (FKs)
      await tx.delete(calendarEventStaffViewers).where(eq(calendarEventStaffViewers.eventId, eventId));
      await tx.delete(calendarEventClasses).where(eq(calendarEventClasses.eventId, eventId));
      await tx.delete(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId));
      await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId));
      await tx.delete(schoolDayOverrides).where(eq(schoolDayOverrides.calendarEventId, eventId));

      await tx.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
    });

    return res.status(204).send();
  });
}