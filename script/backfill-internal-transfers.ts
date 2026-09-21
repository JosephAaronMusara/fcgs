import "dotenv/config";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { internalTransfers, studentEnrollmentEvents, students } from "../shared/schema";

const apply = process.argv.includes("--apply");

type Classification = "already_correct" | "fully_reconstructable" | "partially_reconstructable" | "manual_review";
type Assessment = {
  transferId: number;
  classification: Classification;
  reason: string;
  destinationStudentId?: number;
  sourceStudentId?: number;
  joiningDate?: string | null;
};

async function studentById(id: number | null | undefined) {
  if (!id) return null;
  const [row] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  return row || null;
}

async function assessTransfer(transfer: typeof internalTransfers.$inferSelect): Promise<Assessment> {
  if (transfer.sourceStudentId && transfer.destinationStudentId) {
    const [source, destination] = await Promise.all([
      studentById(transfer.sourceStudentId),
      studentById(transfer.destinationStudentId),
    ]);
    if (source && destination && source.schoolId === transfer.sourceSchoolId && destination.schoolId === transfer.destinationSchoolId) {
      return { transferId: transfer.id, classification: "already_correct", reason: "Explicit source/destination learner links already exist.", sourceStudentId: source.id, destinationStudentId: destination.id, joiningDate: transfer.joiningDate };
    }
    return { transferId: transfer.id, classification: "manual_review", reason: "Stored source/destination learner links are inconsistent or missing." };
  }

  const destination = await studentById(transfer.personId);
  if (!destination) return { transferId: transfer.id, classification: "manual_review", reason: "Legacy destination learner row cannot be found." };
  if (destination.schoolId !== transfer.destinationSchoolId) {
    return { transferId: transfer.id, classification: "manual_review", reason: `Legacy learner is at school ${destination.schoolId ?? "none"}, not destination school ${transfer.destinationSchoolId}.` };
  }
  if (transfer.destinationAdmissionNo && destination.admissionNo.trim().toUpperCase() !== transfer.destinationAdmissionNo.trim().toUpperCase()) {
    return { transferId: transfer.id, classification: "manual_review", reason: "Destination admission number no longer matches the transfer history." };
  }

  const [sourceExisting] = await db.select().from(students).where(and(
    eq(students.schoolId, transfer.sourceSchoolId),
    sql`upper(btrim(${students.admissionNo})) = ${destination.admissionNo.trim().toUpperCase()}`,
    isNull(students.archivedAt),
  )).limit(1);

  const inboundEvents = await db.select().from(studentEnrollmentEvents).where(and(
    eq(studentEnrollmentEvents.studentId, destination.id),
    eq(studentEnrollmentEvents.schoolId, transfer.destinationSchoolId),
    eq(studentEnrollmentEvents.eventType, "internal_transfer_in"),
  )).orderBy(desc(studentEnrollmentEvents.effectiveDate), desc(studentEnrollmentEvents.id)).limit(1);
  const inbound = inboundEvents[0] || null;

  // Legacy internal transfers had only one effective date. In that historical model the
  // learner row was moved to the destination and became active there on that same date, so
  // using effectiveDate as the destination joining date is reconstruction of recorded
  // system semantics, not fabrication. New transfers store joiningDate explicitly.
  const reconstructedJoiningDate = transfer.joiningDate || inbound?.effectiveDate || transfer.effectiveDate;

  if (destination.enrollmentDate && destination.enrollmentDate > transfer.effectiveDate) {
    return { transferId: transfer.id, classification: "manual_review", reason: "Legacy enrollment date is after the transfer date, so the source enrollment history is ambiguous." };
  }

  return {
    transferId: transfer.id,
    classification: "fully_reconstructable",
    reason: sourceExisting ? "Existing source historical row can be linked and normalized using recorded transfer history." : "Missing source historical row can be reconstructed from the legacy destination row and recorded transfer history.",
    sourceStudentId: sourceExisting?.id,
    destinationStudentId: destination.id,
    joiningDate: reconstructedJoiningDate,
  };
}

async function applyAssessment(assessment: Assessment) {
  if (assessment.classification !== "fully_reconstructable") return;
  await db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(internalTransfers).where(eq(internalTransfers.id, assessment.transferId)).limit(1);
    if (!transfer) throw new Error(`Transfer ${assessment.transferId} disappeared during apply.`);
    if (transfer.sourceStudentId && transfer.destinationStudentId) return; // idempotent
    const [destination] = await tx.select().from(students).where(eq(students.id, assessment.destinationStudentId!)).limit(1);
    if (!destination) throw new Error(`Destination learner ${assessment.destinationStudentId} disappeared during apply.`);

    let sourceId = assessment.sourceStudentId || null;
    if (!sourceId) {
      const [source] = await tx.insert(students).values({
        userId: null,
        schoolId: transfer.sourceSchoolId,
        admissionNo: destination.admissionNo.trim().toUpperCase(),
        firstName: destination.firstName,
        lastName: destination.lastName,
        nationalIdNumber: destination.nationalIdNumber,
        passportNumber: destination.passportNumber,
        email: destination.email,
        phone: destination.phone,
        gender: destination.gender,
        dateOfBirth: destination.dateOfBirth,
        address: destination.address,
        streetAddress: destination.streetAddress,
        residentialArea: destination.residentialArea,
        photo: destination.photo,
        classId: null,
        streamId: null,
        parentId: destination.parentId,
        hostelId: null,
        isBoarding: false,
        isDayScholar: true,
        status: "internally_transferred",
        enrollmentDate: destination.enrollmentDate,
        statusDate: transfer.effectiveDate,
        feesTotalTerm: "0",
        feesPaidSoFar: "0",
        feesBalance: "0",
        feesMaxBalance: "0",
        feesCustomerId: null,
        feesStatus: "n/a",
        feesSource: "student_payments_csv",
        feesSnapshotAt: null,
        feesImportBatchId: null,
      }).returning();
      sourceId = source.id;
    } else {
      await tx.update(students).set({ userId: null, classId: null, streamId: null, status: "internally_transferred", statusDate: transfer.effectiveDate }).where(eq(students.id, sourceId));
    }

    const joiningDate = assessment.joiningDate!;
    await tx.update(students).set({
      enrollmentDate: joiningDate,
      statusDate: destination.status === "active" && !destination.statusDate ? joiningDate : destination.statusDate,
    }).where(eq(students.id, destination.id));

    const [existingOutEvent] = await tx.select({ id: studentEnrollmentEvents.id }).from(studentEnrollmentEvents).where(and(
      eq(studentEnrollmentEvents.studentId, sourceId),
      eq(studentEnrollmentEvents.eventType, "internal_transfer_out"),
      eq(studentEnrollmentEvents.effectiveDate, transfer.effectiveDate),
    )).limit(1);
    if (!existingOutEvent) {
      await tx.insert(studentEnrollmentEvents).values({
        studentId: sourceId,
        schoolId: transfer.sourceSchoolId,
        eventType: "internal_transfer_out",
        effectiveDate: transfer.effectiveDate,
        reason: transfer.reason,
        notes: transfer.notes,
        previousStatus: "active",
        newStatus: "internally_transferred",
        createdByUserId: transfer.completedByUserId || transfer.requestedByUserId || null,
      });
    }

    await tx.update(internalTransfers).set({
      personId: sourceId,
      sourceStudentId: sourceId,
      destinationStudentId: destination.id,
      joiningDate,
      sourceAdmissionNo: transfer.sourceAdmissionNo || destination.admissionNo,
      destinationAdmissionNo: transfer.destinationAdmissionNo || destination.admissionNo,
    }).where(eq(internalTransfers.id, transfer.id));
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const transfers = await db.select().from(internalTransfers).where(and(eq(internalTransfers.personType, "student"), eq(internalTransfers.status, "completed"))).orderBy(internalTransfers.id);
  const assessments: Assessment[] = [];
  for (const transfer of transfers) assessments.push(await assessTransfer(transfer));

  const summary = assessments.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ mode: apply ? "apply" : "preflight", summary, transfers: assessments }, null, 2));

  if (!apply) {
    console.log("\nRead-only preflight complete. Nothing was changed. Run with --apply only after reviewing the classifications above.");
    return;
  }
  const eligible = assessments.filter((row) => row.classification === "fully_reconstructable");
  for (const assessment of eligible) await applyAssessment(assessment);
  console.log(`\nApplied ${eligible.length} fully reconstructable historical transfer(s). Partially reconstructable/manual-review rows were not modified.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
