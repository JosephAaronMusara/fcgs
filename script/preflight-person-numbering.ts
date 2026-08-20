import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { staff, students } from "../shared/schema";

async function main() {
  const [studentFormat] = await db.select({ count: sql<number>`count(*)` }).from(students)
    .where(sql`${students.admissionNo} <> upper(btrim(${students.admissionNo})) OR ${students.admissionNo} !~ '^FCGS[0-9]{2}S[0-9]{4,}[A-Z]+$'`);
  const [staffFormat] = await db.select({ count: sql<number>`count(*)` }).from(staff)
    .where(sql`${staff.staffNo} <> upper(btrim(${staff.staffNo})) OR ${staff.staffNo} !~ '^FCGS[0-9]{2}E[0-9]{4,}[A-Z]+$'`);

  const studentDupes = await db.execute(sql`
    SELECT upper(btrim(admission_no)) AS normalized, count(*)::int AS count
    FROM students
    GROUP BY upper(btrim(admission_no))
    HAVING count(*) > 1
    ORDER BY count(*) DESC, normalized
    LIMIT 20
  `);
  const staffDupes = await db.execute(sql`
    SELECT upper(btrim(staff_no)) AS normalized, count(*)::int AS count
    FROM staff
    GROUP BY upper(btrim(staff_no))
    HAVING count(*) > 1
    ORDER BY count(*) DESC, normalized
    LIMIT 20
  `);

  const studentBad = Number(studentFormat?.count || 0);
  const staffBad = Number(staffFormat?.count || 0);
  const studentDuplicateRows = (studentDupes as any).rows || studentDupes;
  const staffDuplicateRows = (staffDupes as any).rows || staffDupes;

  console.log("FCGS person-numbering schema preflight");
  console.log(`Student rows incompatible with canonical DB check: ${studentBad}`);
  console.log(`Staff rows incompatible with canonical DB check: ${staffBad}`);
  console.log(`Normalized Student duplicate groups: ${studentDuplicateRows.length}`);
  console.log(`Normalized Staff duplicate groups: ${staffDuplicateRows.length}`);

  if (studentDuplicateRows.length) console.table(studentDuplicateRows);
  if (staffDuplicateRows.length) console.table(staffDuplicateRows);

  if (studentBad || staffBad || studentDuplicateRows.length || staffDuplicateRows.length) {
    throw new Error("Preflight failed. Do not run db:push until the reported numbering data is repaired.");
  }

  console.log("Preflight passed. The numbering constraints/indexes are safe to apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
