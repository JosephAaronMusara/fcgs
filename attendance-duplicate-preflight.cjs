const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  try {
    console.log("\n=== STUDENT ATTENDANCE DUPLICATES ===");

    const students = await pool.query(`
      SELECT
        student_id,
        class_id,
        date,
        COUNT(*)::int AS duplicate_count
      FROM attendance_records
      GROUP BY student_id, class_id, date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, date DESC
    `);

    console.table(students.rows);
    console.log("Student duplicate groups:", students.rowCount);

    console.log("\n=== STAFF ATTENDANCE DUPLICATES ===");

    const staff = await pool.query(`
      SELECT
        school_id,
        staff_id,
        date,
        COUNT(*)::int AS duplicate_count
      FROM staff_attendance_logs
      GROUP BY school_id, staff_id, date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, date DESC
    `);

    console.table(staff.rows);
    console.log("Staff duplicate groups:", staff.rowCount);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
