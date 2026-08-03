import "dotenv/config";
import { pool } from "../server/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE assessment_types
        ADD COLUMN IF NOT EXISTS code text,
        ADD COLUMN IF NOT EXISTS assessment_cardinality text,
        ADD COLUMN IF NOT EXISTS report_aggregation_mode text
    `);

    await client.query(`
      ALTER TABLE assessments
        ADD COLUMN IF NOT EXISTS enforce_exam_uniqueness boolean NOT NULL DEFAULT false
    `);

    const existingIndex = await client.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'assessments'
        AND indexname = 'assessments_single_per_exam_subject_uidx'
      LIMIT 1
    `);

    if (existingIndex.rows.length > 0) {
      const definition = existingIndex.rows[0].indexdef.toLowerCase();
      const expectedTokens = [
        'unique index',
        '(class_id, subject_id, exam_id)',
        'enforce_exam_uniqueness',
        'exam_id is not null',
      ];
      if (!expectedTokens.every((token) => definition.includes(token))) {
        throw new Error(
          'The existing assessments_single_per_exam_subject_uidx definition does not match the required policy index. Review it manually before continuing.',
        );
      }
    } else {
      // This flag is derived from assessment type policy. Resetting it is safe
      // before first-time index creation; the policy apply step restores the
      // protected canonical rows immediately afterwards.
      await client.query(`
        UPDATE assessments
        SET enforce_exam_uniqueness = false
        WHERE enforce_exam_uniqueness = true
      `);

      await client.query(`
        CREATE UNIQUE INDEX assessments_single_per_exam_subject_uidx
        ON assessments (class_id, subject_id, exam_id)
        WHERE enforce_exam_uniqueness = true
          AND exam_id IS NOT NULL
      `);
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      applied: true,
      changes: [
        "assessment_types policy columns",
        "assessments enforce_exam_uniqueness column",
        "assessments single-per-exam partial unique index",
      ],
      next: "Run assessments:policy:preflight, review the output, then run assessments:policy:apply.",
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
