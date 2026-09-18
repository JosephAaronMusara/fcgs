const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  try {
    console.log("\n=== STUDENT DUPLICATE CLASSIFICATION ===");

    const studentSummary = await pool.query(`
      WITH duplicate_groups AS (
        SELECT
          student_id,
          class_id,
          date,
          COUNT(*) AS row_count,
          COUNT(DISTINCT ROW(
            status,
            reason,
            notify_parent,
            notified_status,
            notified_reason,
            marked_by
          )) AS semantic_versions
        FROM attendance_records
        GROUP BY student_id, class_id, date
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS duplicate_groups,
        COUNT(*) FILTER (WHERE semantic_versions = 1)::int AS exact_duplicate_groups,
        COUNT(*) FILTER (WHERE semantic_versions > 1)::int AS conflict_groups
      FROM duplicate_groups;
    `);

    console.table(studentSummary.rows);

    console.log("\n=== STUDENT CONFLICT DETAILS ===");

    const studentConflicts = await pool.query(`
      WITH conflict_groups AS (
        SELECT
          student_id,
          class_id,
          date
        FROM attendance_records
        GROUP BY student_id, class_id, date
        HAVING
          COUNT(*) > 1
          AND COUNT(DISTINCT ROW(
            status,
            reason,
            notify_parent,
            notified_status,
            notified_reason,
            marked_by
          )) > 1
      )
      SELECT ar.*
      FROM attendance_records ar
      INNER JOIN conflict_groups cg
        ON cg.student_id = ar.student_id
       AND cg.class_id = ar.class_id
       AND cg.date = ar.date
      ORDER BY
        ar.date DESC,
        ar.class_id,
        ar.student_id,
        ar.id;
    `);

    if (studentConflicts.rowCount === 0) {
      console.log("No conflicting student duplicates.");
    } else {
      console.table(studentConflicts.rows);
    }

    console.log("\n=== STAFF DUPLICATE CLASSIFICATION ===");

    const staffSummary = await pool.query(`
      WITH duplicate_groups AS (
        SELECT
          school_id,
          staff_id,
          date,
          COUNT(*) AS row_count,
          COUNT(DISTINCT ROW(
            user_id,
            clock_in,
            clock_out,
            status,
            auto_clocked_out,
            reason_required,
            reason_type,
            reason_submitted_at,
            late_reason,
            early_clock_out_reason,
            clock_in_accuracy,
            clock_out_accuracy,
            device_signature,
            clock_in_latitude,
            clock_in_longitude,
            clock_out_latitude,
            clock_out_longitude,
            notes
          )) AS semantic_versions
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS duplicate_groups,
        COUNT(*) FILTER (WHERE semantic_versions = 1)::int AS exact_duplicate_groups,
        COUNT(*) FILTER (WHERE semantic_versions > 1)::int AS conflict_groups
      FROM duplicate_groups;
    `);

    console.table(staffSummary.rows);

    console.log("\n=== STAFF CONFLICT DETAILS ===");

    const staffConflicts = await pool.query(`
      WITH conflict_groups AS (
        SELECT
          school_id,
          staff_id,
          date
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING
          COUNT(*) > 1
          AND COUNT(DISTINCT ROW(
            user_id,
            clock_in,
            clock_out,
            status,
            auto_clocked_out,
            reason_required,
            reason_type,
            reason_submitted_at,
            late_reason,
            early_clock_out_reason,
            clock_in_accuracy,
            clock_out_accuracy,
            device_signature,
            clock_in_latitude,
            clock_in_longitude,
            clock_out_latitude,
            clock_out_longitude,
            notes
          )) > 1
      )
      SELECT sal.*
      FROM staff_attendance_logs sal
      INNER JOIN conflict_groups cg
        ON cg.school_id = sal.school_id
       AND cg.staff_id = sal.staff_id
       AND cg.date = sal.date
      ORDER BY
        sal.date DESC,
        sal.school_id,
        sal.staff_id,
        sal.id;
    `);

    if (staffConflicts.rowCount === 0) {
      console.log("No conflicting staff duplicates.");
    } else {
      console.table(staffConflicts.rows);
    }

  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
