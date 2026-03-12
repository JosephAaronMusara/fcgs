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

// Helper: get logged-in user (match how your app stores auth user)
function getUser(req: Request): AuthedUser | null {
  // @ts-ignore
  return req.user ?? null;
}

function isStaffLikeRole(role?: string) {
  // In this app: staff-like = anything that's not student/parent (includes org_admin/school_admin/teacher/etc)
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

async function requirePerm(userId: number, code: string): Promise<boolean> {
  return await storage.userHasPermission(userId, code);
}

export function registerCalendarRoutes(app: Express) {
  /**
   * LIST events user can SEE
   * GET /api/calendar/events?from=ISO&to=ISO
   */
  app.get("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    // RBAC: must have calendar.view (applies to staff/student/parent if you want them using calendar)
    const canView = await requirePerm(user.id, "calendar.view");
    if (!canView) return res.status(403).json({ message: "Missing permission: calendar.view" });

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
        user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

      const staffIdCtx = staffRow?.id ?? null;

      const schoolFilter = schoolIdCtx ? sql`e.school_id = ${schoolIdCtx}` : sql`false`;
      const orgFilter = orgIdCtx ? sql`e.organization_id = ${orgIdCtx}` : sql`false`;

      const staffIsClassTeacher = staffIdCtx ? sql`c.class_teacher_id = ${staffIdCtx}` : sql`false`;
      const staffIsViewer = staffIdCtx ? sql`sv.staff_id = ${staffIdCtx}` : sql`false`;

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
            -- class events: creator OR class teacher OR selected staff viewer (in same school)
            (e.scope = 'class' AND ${schoolFilter} AND (
              e.created_by_user_id = ${user.id}
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
            -- personal (kept for completeness)
            (e.scope = 'personal' AND e.owner_user_id = ${user.id})
            OR
            -- class events visible to students in their class
            (e.scope = 'class' AND e.include_students = true AND ec.class_id = ${studentRow.classId})
            OR
            -- school events visible to all students in school (only if includeStudents)
            (e.scope = 'school' AND e.school_id = ${studentRow.schoolId} AND e.include_students = true)
            OR
            -- org events visible to students (only if includeStudents)
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
      // parent can have multiple children in different classes
      const childRows = await db
        .select({ classId: students.classId, schoolId: students.schoolId })
        .from(students)
        .where(eq(students.parentId, parentRow.id));

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
            -- org events where parents explicitly included
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

    const start = new Date(startAt);
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ message: "Invalid startAt/endAt" });
    }

    const tz = timezone ? String(timezone) : "Africa/Harare";
    const incStudents = includeStudents !== false; // default true
    const incParents = !!includeParents; // default false

    // RBAC: check create permission based on scope
    const createPermByScope: Record<string, string> = {
      personal: "calendar.create.personal",
      class: "calendar.create.class",
      school: "calendar.create.school",
      org: "calendar.create.org",
    };

    const requiredCreatePerm = createPermByScope[scope];
    if (!requiredCreatePerm) {
      return res.status(400).json({ message: "Unsupported scope. Use personal|class|school|org" });
    }

    const canCreate = await requirePerm(user.id, requiredCreatePerm);
    if (!canCreate) {
      return res.status(403).json({ message: `Missing permission: ${requiredCreatePerm}` });
    }

    // ----------------------------
    // CLASS EVENT (multi-class)
    // ----------------------------
    if (scope === "class") {
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

      // Staff can only create class events for their own school
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
            includeParents: incParents, // default false unless checked
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
    // - permission-based via calendar.create.school
    // ----------------------------
    if (scope === "school") {
      if (!schoolIdCtx) {
        return res.status(400).json({ message: "No school context for this user" });
      }

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
          includeStudents: incStudents, // default true
          includeParents: incParents, // checkbox controls parent visibility
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // ORG / HQ EVENT
    // - permission-based via calendar.create.org
    // ----------------------------
    if (scope === "org") {
      const orgId =
        user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

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
          includeParents: incParents, // optional checkbox
        })
        .returning();

      return res.status(201).json({ event: created });
    }

    // ----------------------------
    // PERSONAL EVENT (staff only)
    // ----------------------------
    if (scope === "personal") {
      const orgId =
        user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

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

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx =
      user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    const canEditOwn = await requirePerm(user.id, "calendar.edit.own");
    const canEditScope = await requirePerm(user.id, "calendar.edit.scope");

    if (!canEditOwn && !canEditScope) {
      return res.status(403).json({ message: "Missing permission: calendar.edit.own / calendar.edit.scope" });
    }

    // Authorization basics
    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    // Determine event scope context
    const eventOrgId =
      ev.organizationId ?? (ev.schoolId ? await getOrganizationIdBySchoolId(ev.schoolId) : null);

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && eventOrgId && orgIdCtx === eventOrgId;

    const isOrgAdmin = user.role === "org_admin";

    // Optional: class teacher can be considered "scoped" only if they also have edit.scope
    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    // Permission-based decision:
    // - personal: only owner + calendar.edit.own
    // - non-personal:
    //    * if creator/owner -> calendar.edit.own OR calendar.edit.scope
    //    * if not creator -> calendar.edit.scope AND within scope
    let allowed = false;

    if (ev.scope === "personal") {
      allowed = isOwner && canEditOwn;
    } else if (isCreator || isOwner) {
      allowed = canEditOwn || canEditScope;
    } else {
      // scoped edit: requires calendar.edit.scope and scope match
      if (canEditScope) {
        if (isOrgAdmin) {
          allowed = !!sameOrg;
        } else {
          // school-scoped users (school_admin, teachers with scope perms, etc.)
          allowed = !!sameSchool;
        }
      }
    }

    // (Optional) If you want class teachers to be able to edit non-owned class events,
    // you can enable this rule (still requires edit.scope):
    if (!allowed && ev.scope === "class" && isClassTeacher && canEditScope) {
      allowed = isOrgAdmin ? !!sameOrg : !!sameSchool;
    }

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

    // Extra safety: prevent editing out-of-scope org/school if someone somehow got permission
    if (!isOrgAdmin) {
      if ((ev.scope === "school" || ev.scope === "class") && ev.schoolId && schoolIdCtx && ev.schoolId !== schoolIdCtx) {
        return res.status(403).json({ message: "You can only edit school/class events for your school" });
      }
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

    const eventId = Number(req.params.id);
    if (!eventId || isNaN(eventId)) return res.status(400).json({ message: "Invalid event id" });

    const staffRow = await getStaffRowByUserId(user.id);
    const schoolIdCtx = staffRow?.schoolId ?? user.schoolId ?? null;
    const orgIdCtx =
      user.organizationId ?? (schoolIdCtx ? await getOrganizationIdBySchoolId(schoolIdCtx) : null);

    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    if (!ev) return res.status(404).json({ message: "Event not found" });

    const canDeleteOwn = await requirePerm(user.id, "calendar.delete.own");
    const canDeleteScope = await requirePerm(user.id, "calendar.delete.scope");

    if (!canDeleteOwn && !canDeleteScope) {
      return res.status(403).json({ message: "Missing permission: calendar.delete.own / calendar.delete.scope" });
    }

    // Authorization basics
    const isCreator = ev.createdByUserId === user.id;
    const isOwner = ev.ownerUserId === user.id;

    const eventOrgId =
      ev.organizationId ?? (ev.schoolId ? await getOrganizationIdBySchoolId(ev.schoolId) : null);

    const sameSchool = schoolIdCtx && ev.schoolId && schoolIdCtx === ev.schoolId;
    const sameOrg = orgIdCtx && eventOrgId && orgIdCtx === eventOrgId;

    const isOrgAdmin = user.role === "org_admin";

    let isClassTeacher = false;
    if (ev.scope === "class" && staffRow?.id) {
      const classIds = await getEventClassIds(eventId);
      isClassTeacher = await isClassTeacherOfAny(staffRow.id, classIds);
    }

    // Permission-based decision:
    // - personal: only owner + delete.own
    // - non-personal:
    //    * if creator/owner -> delete.own OR delete.scope
    //    * if not creator -> delete.scope AND within scope
    let allowed = false;

    if (ev.scope === "personal") {
      allowed = isOwner && canDeleteOwn;
    } else if (isCreator || isOwner) {
      allowed = canDeleteOwn || canDeleteScope;
    } else {
      if (canDeleteScope) {
        if (isOrgAdmin) {
          allowed = !!sameOrg;
        } else {
          allowed = !!sameSchool;
        }
      }
    }

    // Optional: class teacher delete (still requires delete.scope)
    if (!allowed && ev.scope === "class" && isClassTeacher && canDeleteScope) {
      allowed = isOrgAdmin ? !!sameOrg : !!sameSchool;
    }

    if (!allowed) return res.status(403).json({ message: "Not allowed to delete this event" });

    await db.transaction(async (tx) => {
      // delete children first (FKs)
      await tx.delete(calendarEventStaffViewers).where(eq(calendarEventStaffViewers.eventId, eventId));
      await tx.delete(calendarEventClasses).where(eq(calendarEventClasses.eventId, eventId));
      await tx.delete(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId));
      await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId));

      await tx.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
    });

    return res.status(204).send();
  });
}