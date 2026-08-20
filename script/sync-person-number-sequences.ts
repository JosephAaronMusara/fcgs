import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { personNumberSequences, staff, students } from "../shared/schema";
import { parsePersonNumber, schoolIdFromSequenceCode, type PersonNumberKind } from "../server/person-numbering";

type SequenceKey = `${PersonNumberKind}:${number}:${number}`;

type SequenceState = {
  entityType: PersonNumberKind;
  year: number;
  schoolId: number;
  lastSequence: number;
};

function fullYearForNumber(year2: string, createdAt: Date | null): number {
  const createdYear = createdAt?.getFullYear();
  if (createdYear && String(createdYear).slice(-2) === year2) return createdYear;

  // FCGS person numbers are a 20xx-era format. This fallback is only used when
  // a legacy row has no trustworthy created_at value; the normal allocator uses
  // the actual current issuance year for all new records.
  return 2000 + Number(year2);
}

function remember(
  states: Map<SequenceKey, SequenceState>,
  kind: PersonNumberKind,
  rawNumber: string,
  createdAt: Date | null,
) {
  const parsed = parsePersonNumber(rawNumber);
  if (!parsed || parsed.kind !== kind) return;

  const schoolId = schoolIdFromSequenceCode(parsed.schoolCode);
  const year = fullYearForNumber(parsed.year2, createdAt);
  const key: SequenceKey = `${kind}:${year}:${schoolId}`;
  const existing = states.get(key);
  if (!existing || parsed.sequence > existing.lastSequence) {
    states.set(key, { entityType: kind, year, schoolId, lastSequence: parsed.sequence });
  }
}

async function main() {
  const [studentRows, staffRows] = await Promise.all([
    db.select({ admissionNo: students.admissionNo, createdAt: students.createdAt }).from(students),
    db.select({ staffNo: staff.staffNo, createdAt: staff.createdAt }).from(staff),
  ]);

  const states = new Map<SequenceKey, SequenceState>();
  for (const row of studentRows) remember(states, "student", row.admissionNo, row.createdAt);
  for (const row of staffRows) remember(states, "staff", row.staffNo, row.createdAt);

  await db.transaction(async (tx) => {
    for (const state of states.values()) {
      const [existing] = await tx
        .select({ id: personNumberSequences.id, lastSequence: personNumberSequences.lastSequence })
        .from(personNumberSequences)
        .where(and(
          eq(personNumberSequences.entityType, state.entityType),
          eq(personNumberSequences.year, state.year),
          eq(personNumberSequences.schoolId, state.schoolId),
        ));

      if (existing) {
        if (existing.lastSequence < state.lastSequence) {
          await tx
            .update(personNumberSequences)
            .set({ lastSequence: state.lastSequence, updatedAt: new Date() })
            .where(eq(personNumberSequences.id, existing.id));
        }
      } else {
        await tx.insert(personNumberSequences).values({
          ...state,
          updatedAt: new Date(),
        });
      }
    }
  });

  const persisted = await db
    .select({
      entityType: personNumberSequences.entityType,
      year: personNumberSequences.year,
      schoolId: personNumberSequences.schoolId,
      lastSequence: personNumberSequences.lastSequence,
    })
    .from(personNumberSequences);

  const currentYear = new Date().getFullYear();
  console.log("FCGS person-number sequence high-water sync complete.");
  console.table(
    persisted
      .filter((row) => row.year === currentYear)
      .sort((a, b) => a.schoolId - b.schoolId || a.entityType.localeCompare(b.entityType)),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
