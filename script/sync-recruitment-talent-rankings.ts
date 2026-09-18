import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { syncAllRecruitmentTalentRankings } from "../server/recruitment-routes";
import { recruitmentExaminationBoards, recruitmentSettings } from "@shared/schema";

async function ensureDefaultExaminationBoards(): Promise<number> {
  const settingsRows = await db
    .select({ organizationId: recruitmentSettings.organizationId })
    .from(recruitmentSettings);

  let seededOrganizations = 0;

  for (const { organizationId } of settingsRows) {
    const [activeBoard] = await db
      .select({ id: recruitmentExaminationBoards.id })
      .from(recruitmentExaminationBoards)
      .where(and(
        eq(recruitmentExaminationBoards.organizationId, organizationId),
        eq(recruitmentExaminationBoards.isActive, true),
      ))
      .limit(1);

    if (activeBoard) continue;

    const existingBoards = await db
      .select({ id: recruitmentExaminationBoards.id })
      .from(recruitmentExaminationBoards)
      .where(eq(recruitmentExaminationBoards.organizationId, organizationId));

    // Only bootstrap the defaults when the organization has never configured boards.
    // If rows exist but all are inactive, leave that deliberate configuration untouched
    // and allow recruitment:preflight to flag it for an administrator to review.
    if (existingBoards.length > 0) continue;

    await db.insert(recruitmentExaminationBoards).values([
      { organizationId, name: "ZIMSEC", displayOrder: 10, isActive: true },
      { organizationId, name: "Cambridge", displayOrder: 20, isActive: true },
    ]).onConflictDoNothing();

    seededOrganizations += 1;
  }

  return seededOrganizations;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Check the project .env file before running recruitment:talent-sync.");
  }

  const seededOrganizations = await ensureDefaultExaminationBoards();
  const result = await syncAllRecruitmentTalentRankings();

  if (seededOrganizations > 0) {
    console.log(`Initialized default Recruitment examination boards for ${seededOrganizations} organization(s).`);
  }
  console.log(`Recruitment talent rankings synchronized for ${result.applications} application(s).`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
