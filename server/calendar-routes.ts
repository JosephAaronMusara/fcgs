import type { Express, Request } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
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
} from "../shared/schema";
import { requireAuth } from "./auth";

type AuthedUser = {
  id: number;
  role?: string;
  schoolId?: number | null;
  organizationId?: number | null;
};

// -----------------------------
// Permission codes (RBAC)
// -----------------------------
const PERM = {
  view: "calendar.view",
  createPersonal: "calendar.create.personal",
  createClass: "calendar.create.class",
  createSchool: "calendar.create.school",
  createOrg: "calendar.create.org",
  editOwn: "calendar.edit.own",
  deleteOwn: "calendar.delete.own",
  editAny: "calendar.edit.any",
  deleteAny: "calendar.delete.any",
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
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`;
}

async function requirePerm(userId: number, code: string): Promise<boolean> {
  return await storage.userHasPermission(userId, code);
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

async function getEventClassIds(eventId: number): Promise<number[]> {
  const rows = await db
    .select({ classId: calendarEventClasses.classId })
    .from(calendarEventClasses)
    .where(eq(calendarEventClasses.eventId, eventId));

  return rows.map((r) => r.classId).filter(Boolean) as number[];
}

async function isClassTeacherOfAny(staffId: number, classIds: number[]) {
  if (!classIds.length) return false;

  const result = await db.execute(sql`
    SELECT 1
    FROM classes
    WHERE id = ANY(${intArrayParam(classIds)})
      AND class_teacher_id = ${staffId}
    LIMIT 1
  `);

  return ((result as any).rows ?? []).length > 0;
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
      // RBAC: staff must have calendar.view
      const canView = await requirePerm(user.id, PERM.view);
      if (!canView) return res.status(403).json({ message: "Missing permission: calendar.view" });

      const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
      const orgIdCtx =
        user.organizationId ??
        (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

      const staffIdCtx = staffRow?.id ?? null;

      const schoolFilter = schoolIdCtx ? sql`e.school_id = ${schoolIdCtx}` : sql`false`;
      const orgFilter = orgIdCtx ? sql`e.organization_id = ${orgIdCtx}` : sql`false`;

      const staffIsClassTeacher = staffIdCtx ? sql`c.class_teacher_id = ${staffIdCtx}` : sql`false`;
      const staffIsViewer = staffIdCtx ? sql`sv.staff_id = ${staffIdCtx}` : sql`false`;

      // Admins: can see all class events in their school (oversight)
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
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            (e.scope = 'class' AND ${schoolFilter} AND (
              e.created_by_user_id = ${user.id}
              OR ${adminCanSeeAllClassInSchool}
              OR ${staffIsClassTeacher}
              OR ${staffIsViewer}
            ))
            OR
            (e.scope = 'school' AND ${schoolFilter})
            OR
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
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            (e.scope = 'class' AND e.include_students = true AND ec.class_id = ${studentRow.classId})
            OR
            (e.scope = 'school' AND e.school_id = ${studentRow.schoolId} AND e.include_students = true)
            OR
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
      const childRows = await db
        .select({ classId: students.classId, schoolId: students.schoolId })
        .from(students)
        .where(eq(students.parentId, parentRow.id));

      const childClassIds = childRows.map((r) => r.classId).filter(Boolean) as number[];
      const childSchoolIds = Array.from(new Set(childRows.map((r) => r.schoolId).filter(Boolean) as number[]));

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
            (e.scope = 'class' AND e.include_parents = true AND ec.class_id = ANY(${classIdsSql}))
            OR
            (e.scope = 'school' AND e.include_parents = true AND e.school_id = ANY(${schoolIdsSql}))
            OR
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
   */
  app.post("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    if (!isStaffLikeRole(user.role)) {
      return res.status(403).json({ message: "Only staff can create events" });
    }

    // RBAC: staff must have calendar.view to access module endpoints
    const canView = await requirePerm(user.id, PERM.view);
    if (!canView) return res.status(403).json({ message: "Missing permission: calendar.view" });

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
    } = req.body ?? {};

    if (!scope || typeof scope !== "string") {
      return res.status(400).json({ message: "scope is required" });
    }
    if (!title || !startAt || !endAt) {
      return res.status(400).json({ message: "title, startAt, endAt are required" });
    }

    // RBAC: scope-specific create permission
    const createPerm =
      scope === "class"
        ? PERM.createClass
        : scope === "school"
          ? PERM.createSchool
          : scope === "org"
            ? PERM.createOrg
            : scope === "personal"
              ? PERM.createPersonal
              : null;

    if (!createPerm) {
      return res.status(400).json({ message: "Unsupported scope. Use personal|class|school|org" });
    }

    const canCreate = await requirePerm(user.id, createPerm);
    if (!canCreate) return res.status(403).json({ message: `Missing permission: ${createPerm}` });

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
      if (!Array.isArray(classIds) || classIds.length === 0) {
        return res.status(400).json({ message: "classIds[] is required for scope=class" });
      }

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

      if (!schoolIdCtx || schoolIdCtx !== schoolId) {
        return res.status(403).json({ message: "You can only create class events for your own school" });
      }

      const organizationId = await getOrganizationIdBySchoolId(schoolId);

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
            classId: classIds[0], // backward compat
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
    // ----------------------------
    if (scope === "school") {
      if (user.role !== "school_admin" && user.role !== "org_admin") {
        return res.status(403).json({ message: "Only school_admin/org_admin can create school events" });
      }
      if (!schoolIdCtx) return res.status(400).json({ message: "No school context for this user" });

      const organizationId = await getOrganizationIdBySchoolId(schoolIdCtx);

      const [created] = await db
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
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // ORG / HQ EVENT
    // ----------------------------
    if (scope === "org") {
      if (user.role !== "org_admin") {
        return res.status(403).json({ message: "Only org_admin can create org events" });
      }

      const orgId = user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);
      if (!orgId) return res.status(400).json({ message: "No organization context for this user" });

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
          includeStudents: incStudents,
          includeParents: incParents,
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // PERSONAL EVENT (staff only)
    // ----------------------------
    if (scope === "personal") {
      const orgId = user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

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

    // RBAC base: calendar.view
    const canView = await requirePerm(user.id, PERM.view);
    if (!canView) return res.status(403).json({ message: "Missing permission: calendar.view" });

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx = user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && ev.organizationId && orgIdCtx === ev.organizationId;

    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    const canEditOwn = await requirePerm(user.id, PERM.editOwn);
    const canEditAny = await requirePerm(user.id, PERM.editAny);

    const allowed =
      (ev.scope === "personal" ? isOwner : isCreator) ? canEditOwn : (
        canEditAny &&
        (
          (ev.scope === "org" && sameOrg && user.role === "org_admin") ||
          (ev.scope === "school" && (sameSchool || (sameOrg && user.role === "org_admin"))) ||
          (ev.scope === "class" && sameSchool && (user.role === "school_admin" || user.role === "org_admin" || isClassTeacher))
        )
      );

    if (!allowed) return res.status(403).json({ message: "Not allowed to edit this event" });

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
    } = req.body ?? {};

    const nextStart = startAt ? new Date(startAt) : (ev.startAt as unknown as Date);
    const nextEnd = endAt ? new Date(endAt) : (ev.endAt as unknown as Date);

    if (isNaN(nextStart.getTime()) || isNaN(nextEnd.getTime()) || nextEnd <= nextStart) {
      return res.status(400).json({ message: "Invalid startAt/endAt" });
    }

    const wantsClassIdsUpdate = Array.isArray(classIds);
    const wantsViewersUpdate = Array.isArray(staffViewerIds);

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

      if (ev.schoolId && ev.schoolId !== schoolId) {
        return res.status(400).json({ message: "Cannot move a class event to another school" });
      }

      if (!schoolIdCtx || schoolIdCtx !== schoolId) {
        return res.status(403).json({ message: "You can only set classIds within your own school" });
      }

      newClassIds = classIds.map((x: any) => Number(x)).filter((n: number) => !isNaN(n));
      newSchoolIdForClassEvent = schoolId;
    }

    let newViewerIds: number[] | null = null;
    if (ev.scope === "class" && wantsViewersUpdate) {
      newViewerIds = staffViewerIds.map((x: any) => Number(x)).filter((n: number) => !isNaN(n));

      if (newViewerIds.length > 0) {
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

    const updated = await db.transaction(async (tx) => {
      const [updatedEvent] = await tx
        .update(calendarEvents)
        .set({
          ...patch,
          ...(ev.scope === "class" && newClassIds ? { classId: newClassIds[0] } : {}),
        })
        .where(eq(calendarEvents.id, eventId))
        .returning();

      if (ev.scope === "class" && newClassIds) {
        await tx.delete(calendarEventClasses).where(eq(calendarEventClasses.eventId, eventId));
        await tx
          .insert(calendarEventClasses)
          .values(newClassIds.map((cid) => ({ eventId, classId: cid })))
          .onConflictDoNothing();
      }

      if (ev.scope === "class" && newViewerIds) {
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

    // RBAC base: calendar.view
    const canView = await requirePerm(user.id, PERM.view);
    if (!canView) return res.status(403).json({ message: "Missing permission: calendar.view" });

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx = user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && ev.organizationId && orgIdCtx === ev.organizationId;

    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    const canDeleteOwn = await requirePerm(user.id, PERM.deleteOwn);
    const canDeleteAny = await requirePerm(user.id, PERM.deleteAny);

    const allowed =
      (ev.scope === "personal" ? isOwner : isCreator) ? canDeleteOwn : (
        canDeleteAny &&
        (
          (ev.scope === "org" && sameOrg && user.role === "org_admin") ||
          (ev.scope === "school" && (sameSchool || (sameOrg && user.role === "org_admin"))) ||
          (ev.scope === "class" && sameSchool && (user.role === "school_admin" || user.role === "org_admin" || isClassTeacher))
        )
      );

    if (!allowed) return res.status(403).json({ message: "Not allowed to delete this event" });

    await db.transaction(async (tx) => {
      await tx.delete(calendarEventStaffViewers).where(eq(calendarEventStaffViewers.eventId, eventId));
      await tx.delete(calendarEventClasses).where(eq(calendarEventClasses.eventId, eventId));
      await tx.delete(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId));
      await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId));

      await tx.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
    });

    return res.status(204).send();
  });
}