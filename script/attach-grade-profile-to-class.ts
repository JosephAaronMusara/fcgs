import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { classes, grades, schools, streams } from "../shared/schema";
import {
  GRADE_PROFILE_KEYS,
  normalizeSchoolType,
  resolveGradeProfileKey,
} from "../shared/academic-profiles";

function readNumberArg(args: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function readStringArg(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim();
  return value || undefined;
}

function gradeAlreadyAppliesToClass(grade: any, classId: number): boolean {
  if (grade.appliesAll) return true;
  if (!Array.isArray(grade.classIds) || grade.classIds.length === 0) return true;
  return grade.classIds.map((id: unknown) => Number(id)).includes(classId);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const classId = readNumberArg(args, "class-id");
  const requestedProfileKey = readStringArg(args, "profile-key");

  if (!classId) {
    throw new Error("--class-id=<id> is required");
  }
  if (requestedProfileKey && !GRADE_PROFILE_KEYS.includes(requestedProfileKey as any)) {
    throw new Error(`Unknown --profile-key. Expected one of: ${GRADE_PROFILE_KEYS.join(", ")}`);
  }

  const [classInfo] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
  if (!classInfo) throw new Error(`Class ${classId} was not found`);

  const [school, stream] = await Promise.all([
    db.select().from(schools).where(eq(schools.id, classInfo.schoolId)).limit(1).then((rows) => rows[0]),
    classInfo.streamId
      ? db.select().from(streams).where(eq(streams.id, classInfo.streamId)).limit(1).then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);
  if (!school) throw new Error(`School ${classInfo.schoolId} was not found`);

  const schoolType = normalizeSchoolType(school.schoolType);
  if (schoolType === "secondary" && !requestedProfileKey) {
    throw new Error("Secondary classes require an explicit --profile-key because subjects may use different examination profiles");
  }

  const profileKey = requestedProfileKey || resolveGradeProfileKey({
    schoolType: school.schoolType,
    examinationBoard: school.examinationBoard,
    streamName: stream?.name,
  });
  if (!profileKey) {
    throw new Error("The grading profile could not be resolved. Supply --profile-key explicitly.");
  }

  const schoolGrades = await db.select().from(grades).where(eq(grades.schoolId, school.id));
  const profileGrades = schoolGrades.filter((grade) => grade.gradeLevel === profileKey);
  if (profileGrades.length === 0) {
    throw new Error(`No ${profileKey} grade records exist for ${school.name}`);
  }

  const alreadyApplicable = profileGrades.filter((grade) => gradeAlreadyAppliesToClass(grade, classId));
  const toUpdate = profileGrades.filter((grade) => !gradeAlreadyAppliesToClass(grade, classId));

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`School: ${school.name} (#${school.id})`);
  console.log(`Class: ${classInfo.className} (#${classInfo.id})`);
  console.log(`Stream: ${stream?.name || "Not configured"}`);
  console.log(`Profile: ${profileKey}`);
  console.log(JSON.stringify({
    profileGradeRows: profileGrades.length,
    alreadyApplicable: alreadyApplicable.length,
    rowsToUpdate: toUpdate.length,
  }, null, 2));

  console.table(profileGrades.map((grade) => ({
    gradeId: grade.id,
    gradeName: grade.gradeName,
    lowerLimit: grade.lowerLimit,
    upperLimit: grade.upperLimit,
    gradeType: grade.gradeType || "generic",
    appliesAll: grade.appliesAll === true,
    currentClassIds: Array.isArray(grade.classIds) ? grade.classIds.join(",") : "",
    action: gradeAlreadyAppliesToClass(grade, classId) ? "no change" : `add class ${classId}`,
  })));

  if (!apply) {
    console.log("No database rows were changed. Re-run with --apply after reviewing the profile and ranges.");
    return;
  }

  if (toUpdate.length === 0) {
    console.log("No updates were needed.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const grade of toUpdate) {
      const currentClassIds = Array.isArray(grade.classIds)
        ? grade.classIds.map(Number).filter(Number.isFinite)
        : [];
      const nextClassIds = Array.from(new Set([...currentClassIds, classId]));
      await tx.update(grades).set({ classIds: nextClassIds }).where(eq(grades.id, grade.id));
    }
  });

  console.log(`Updated ${toUpdate.length} grade rows. Class ${classId} is now attached to profile ${profileKey}.`);
}

main()
  .catch((error) => {
    console.error("Attach grade profile failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
