const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  let client;

  try {
    client = await pool.connect();

    console.log("\n=== ATTENDANCE DUPLICATE CLEANUP ===");

    // ---------------------------------------------------------
    // 1. SAFETY CHECK - STUDENT DUPLICATES MUST BE SEMANTICALLY
    //    IDENTICAL, IGNORING id/created_at only.
    // ---------------------------------------------------------
    const studentConflicts = await client.query(`
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
            marked_by,
            source,
            gate_evidence_locked,
            first_gate_arrival_at,
            admitted_at,
            last_gate_exit_at,
            gate_id,
            gate_device_id,
            gate_correction_reason,
            gate_corrected_by_user_id,
            gate_corrected_at,
            reconciliation_at
          )) AS semantic_versions
        FROM attendance_records
        GROUP BY student_id, class_id, date
        HAVING COUNT(*) > 1
      )
      SELECT COUNT(*)::int AS count
      FROM duplicate_groups
      WHERE semantic_versions > 1;
    `);

    if (studentConflicts.rows[0].count !== 0) {
      throw new Error(
        `STOPPED: ${studentConflicts.rows[0].count} student duplicate groups now contain conflicting information.`
      );
    }

    // ---------------------------------------------------------
    // 2. SAFETY CHECK - STAFF DUPLICATES MAY DIFFER ONLY IN
    //    clock_in, reason_submitted_at and created_at.
    // ---------------------------------------------------------
    const staffMaterialConflicts = await client.query(`
      WITH duplicate_groups AS (
        SELECT
          school_id,
          staff_id,
          date,
          COUNT(DISTINCT ROW(
            user_id,
            clock_out,
            status,
            auto_clocked_out,
            reason_required,
            reason_type,
            late_reason,
            early_clock_out_reason,
            clock_in_accuracy,
            clock_out_accuracy,
            device_signature,
            clock_in_latitude,
            clock_in_longitude,
            clock_out_latitude,
            clock_out_longitude,
            notes,
            source,
            first_gate_entry_at,
            last_gate_exit_at,
            currently_on_campus,
            missing_clock_out
          )) AS material_versions,
          EXTRACT(
            EPOCH FROM (MAX(clock_in) - MIN(clock_in))
          ) AS clock_in_spread_seconds
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING COUNT(*) > 1
      )
      SELECT COUNT(*)::int AS count
      FROM duplicate_groups
      WHERE material_versions > 1
         OR COALESCE(clock_in_spread_seconds, 0) > 1;
    `);

    if (staffMaterialConflicts.rows[0].count !== 0) {
      throw new Error(
        `STOPPED: ${staffMaterialConflicts.rows[0].count} staff duplicate groups contain material conflicts.`
      );
    }

    // ---------------------------------------------------------
    // 3. GET ALL AFFECTED ROWS AND WRITE LOCAL BACKUP
    // ---------------------------------------------------------
    const studentRows = await client.query(`
      SELECT ar.*
      FROM attendance_records ar
      INNER JOIN (
        SELECT student_id, class_id, date
        FROM attendance_records
        GROUP BY student_id, class_id, date
        HAVING COUNT(*) > 1
      ) d
        ON d.student_id = ar.student_id
       AND d.class_id = ar.class_id
       AND d.date = ar.date
      ORDER BY ar.date, ar.class_id, ar.student_id, ar.id;
    `);

    const staffRows = await client.query(`
      SELECT sal.*
      FROM staff_attendance_logs sal
      INNER JOIN (
        SELECT school_id, staff_id, date
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING COUNT(*) > 1
      ) d
        ON d.school_id = sal.school_id
       AND d.staff_id = sal.staff_id
       AND d.date = sal.date
      ORDER BY sal.date, sal.school_id, sal.staff_id, sal.id;
    `);

    const backupDir = path.resolve(
      process.cwd(),
      "attendance-dedupe-backup-20260910"
    );

    fs.mkdirSync(backupDir, { recursive: true });

    fs.writeFileSync(
      path.join(backupDir, "student-attendance-before.json"),
      JSON.stringify(studentRows.rows, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(backupDir, "staff-attendance-before.json"),
      JSON.stringify(staffRows.rows, null, 2),
      "utf8"
    );

    console.log(`Backup directory: ${backupDir}`);
    console.log(`Student rows backed up: ${studentRows.rowCount}`);
    console.log(`Staff rows backed up: ${staffRows.rowCount}`);

    // ---------------------------------------------------------
    // 4. CLEAN UP IN ONE TRANSACTION
    // ---------------------------------------------------------
    await client.query("BEGIN");

    // Students are semantic duplicates. Keep the lowest ID.
    const studentDelete = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY student_id, class_id, date
            ORDER BY id ASC
          ) AS rn
        FROM attendance_records
      )
      DELETE FROM attendance_records ar
      USING ranked r
      WHERE ar.id = r.id
        AND r.rn > 1;
    `);

    // For staff duplicate submissions, preserve the earliest
    // real clock-in, earliest reason-submission timestamp and
    // earliest created timestamp on the keeper row.
    await client.query(`
      WITH duplicate_groups AS (
        SELECT
          school_id,
          staff_id,
          date,
          MIN(id) AS keep_id,
          MIN(clock_in) AS earliest_clock_in,
          MIN(reason_submitted_at) AS earliest_reason_submitted_at,
          MIN(created_at) AS earliest_created_at
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING COUNT(*) > 1
      )
      UPDATE staff_attendance_logs sal
      SET
        clock_in = COALESCE(d.earliest_clock_in, sal.clock_in),
        reason_submitted_at = COALESCE(
          d.earliest_reason_submitted_at,
          sal.reason_submitted_at
        ),
        created_at = COALESCE(
          d.earliest_created_at,
          sal.created_at
        )
      FROM duplicate_groups d
      WHERE sal.id = d.keep_id;
    `);

    const staffDelete = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY school_id, staff_id, date
            ORDER BY id ASC
          ) AS rn
        FROM staff_attendance_logs
      )
      DELETE FROM staff_attendance_logs sal
      USING ranked r
      WHERE sal.id = r.id
        AND r.rn > 1;
    `);

    // ---------------------------------------------------------
    // 5. VERIFY BEFORE COMMIT
    // ---------------------------------------------------------
    const studentRemaining = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT student_id, class_id, date
        FROM attendance_records
        GROUP BY student_id, class_id, date
        HAVING COUNT(*) > 1
      ) x;
    `);

    const staffRemaining = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT school_id, staff_id, date
        FROM staff_attendance_logs
        GROUP BY school_id, staff_id, date
        HAVING COUNT(*) > 1
      ) x;
    `);

    if (
      studentRemaining.rows[0].count !== 0 ||
      staffRemaining.rows[0].count !== 0
    ) {
      throw new Error(
        `Verification failed. Student duplicate groups: ${studentRemaining.rows[0].count}, Staff duplicate groups: ${staffRemaining.rows[0].count}`
      );
    }

    await client.query("COMMIT");

    console.log("\n=== CLEANUP COMPLETE ===");
    console.log(`Redundant student rows removed: ${studentDelete.rowCount}`);
    console.log(`Redundant staff rows removed: ${staffDelete.rowCount}`);
    console.log(
      `Remaining student duplicate groups: ${studentRemaining.rows[0].count}`
    );
    console.log(
      `Remaining staff duplicate groups: ${staffRemaining.rows[0].count}`
    );

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }

    console.error("\nCLEANUP FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
})();
