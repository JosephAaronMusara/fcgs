import type { Express, Request } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  calendarEvents,
  calendarEventClasses,
  calendarEventStaffViewers,
  classes,
  schools,
  staff,
  students,
  parents,
} from "../shared/schema";
import { requireAuth } from "./auth";

// Helper: get logged-in user (match how your app stores auth user)
function getUser(req: Request) {
  // Most apps using passport put it here:
  // @ts-ignore
  return req.user;
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

export function registerCalendarRoutes(app: Express) {
  /**
   * LIST events user can SEE (Phase 2 rules)
   * GET /api/calendar/events?from=ISO&to=ISO
   */
  app.get("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: "from/to query params required (ISO dates)" });
    }

    // Determine identity type
    const staffRow = await getStaffRowByUserId(user.id);
    const studentRow = !staffRow ? await getStudentRowByUserId(user.id) : null;
    const parentRow = !staffRow && !studentRow ? await getParentRowByUserId(user.id) : null;

    // Build accessible event IDs per role
    // NOTE: We use SQL because visibility logic is OR-heavy.

    // Staff: see class events if:
    // - you are class teacher for at least one class in the event, OR
    // - you are in selected staff viewers
    // Students: see class events if include_students=true AND their class is in the event
    // Parents: see class events if include_parents=true AND any child is in an event class

    let rows: any[] = [];

    if (staffRow) {
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
            -- class events: creator OR class teacher OR selected staff viewer
            (e.scope = 'class' AND e.school_id = ${staffRow.schoolId} AND (
              e.created_by_user_id = ${user.id}
              OR c.class_teacher_id = ${staffRow.id}
              OR sv.staff_id = ${staffRow.id}
            ))
            OR
            -- school events (Phase 2: allow all staff in same school)
            (e.scope = 'school' AND e.school_id = ${staffRow.schoolId})
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);
      rows = (result as any).rows ?? [];
    } else if (studentRow) {
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
            (e.scope = 'school' AND e.school_id = ${studentRow.schoolId})
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);
      rows = (result as any).rows ?? [];
    } else if (parentRow) {
      // parent can have multiple children in different classes
      const childClasses = await db
        .select({ classId: students.classId })
        .from(students)
        .where(eq(students.parentId, parentRow.id));

      const classIds = childClasses.map((c) => c.classId).filter(Boolean) as number[];

      if (classIds.length === 0) return res.json({ events: [] });

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
            (e.scope = 'class' AND e.include_parents = true AND ec.class_id = ANY(${classIds}))
          )
        GROUP BY e.id
        ORDER BY e.start_at ASC
      `);
      rows = (result as any).rows ?? [];
    } else {
      // no linked staff/student/parent row
      rows = [];
    }

    return res.json({ events: rows });
  });

  /**
   * CREATE class event (multi-class)
   * POST /api/calendar/events
   */
  app.post("/api/calendar/events", requireAuth, async (req, res) => {
    const user = getUser(req);
    if (!user?.id) return res.status(401).json({ message: "Authentication required" });

    const staffRow = await getStaffRowByUserId(user.id);
    if (!staffRow) return res.status(403).json({ message: "Only staff can create events" });

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

    if (scope !== "class") {
      return res.status(400).json({ message: "Phase 2 supports scope=class only" });
    }
    if (!title || !startAt || !endAt) {
      return res.status(400).json({ message: "title, startAt, endAt are required" });
    }
    if (!Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ message: "classIds[] is required" });
    }

    const start = new Date(startAt);
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ message: "Invalid startAt/endAt" });
    }

    // Load classes
    const classRows = await db
      .select({
        id: classes.id,
        schoolId: classes.schoolId,
        classTeacherId: classes.classTeacherId,
      })
      .from(classes)
      .where(inArray(classes.id, classIds));

    if (classRows.length !== classIds.length) {
      return res.status(400).json({ message: "One or more classIds are invalid" });
    }

    // Enforce SAME SCHOOL for multi-class events (Phase 2)
    const schoolId = classRows[0].schoolId;
    if (!schoolId || classRows.some((c) => c.schoolId !== schoolId)) {
      return res.status(400).json({ message: "All selected classes must belong to the same school" });
    }

    // Any staff can create class events for any class in THEIR school
    if (staffRow.schoolId !== schoolId) {
      return res.status(403).json({ message: "You can only create class events for your own school" });
    }

    // Get organization_id from school
    const [schoolRow] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId));
    const organizationId = schoolRow?.organizationId ?? null;

    // Optional: validate staffViewerIds belong to same school
    const viewerIds = Array.isArray(staffViewerIds) ? staffViewerIds.filter(Boolean) : [];
    if (viewerIds.length > 0) {
      const viewerRows = await db
        .select({ id: staff.id, schoolId: staff.schoolId, userId: staff.userId })
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
          timezone: timezone ? String(timezone) : "Africa/Harare",
          includeStudents: includeStudents !== false, // default true
          includeParents: !!includeParents, // default false
        })
        .returning();

      const eventId = ev.id;

      await tx.insert(calendarEventClasses).values(
        classIds.map((cid: number) => ({
          eventId,
          classId: cid,
        })),
      ).onConflictDoNothing();

      if (viewerIds.length > 0) {
        await tx.insert(calendarEventStaffViewers).values(
          viewerIds.map((sid: number) => ({
            eventId,
            staffId: sid,
          })),
        ).onConflictDoNothing();
      }

      return ev;
    });

    return res.status(201).json({ event: created });
  });
}