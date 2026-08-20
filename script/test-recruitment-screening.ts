import assert from "node:assert/strict";
import {
  calculateAgeOnDate,
  calculateALevelPoints,
  evaluateHighSchoolEligibility,
  evaluateRecruitmentRequirement,
  publicHighSchoolEligibilityPolicy,
} from "../server/recruitment-screening";
import { coreRecruitmentDocumentRequirements, isHighSchoolCoreRequirementDefinition, recruitmentCategoryCode } from "../shared/recruitment";

const base = {
  inputType: "select",
  acceptedValues: ["Primary Teaching Certificate"],
  minimumNumber: null,
  maximumNumber: null,
  alternativePassKeywords: ["Bachelor of Education", "B.Ed"],
  alternativePassNote: "Equivalent teaching qualification accepted.",
};

assert.deepEqual(evaluateRecruitmentRequirement(base, "Primary Teaching Certificate", ""), { passed: true, alternativeAccepted: false, evaluationNote: null });
assert.equal(evaluateRecruitmentRequirement(base, "Other", "Bachelor of Education in Primary Education").alternativeAccepted, true);
assert.deepEqual(evaluateRecruitmentRequirement(base, "Other", "Diploma in Bookkeeping"), { passed: false, alternativeAccepted: false, evaluationNote: null });

assert.equal(recruitmentCategoryCode("High School Teaching"), "high_school_teaching");
assert.equal(recruitmentCategoryCode("Primary School Teaching"), "primary_teaching");
assert.equal(recruitmentCategoryCode("Teaching"), null);
assert.equal(isHighSchoolCoreRequirementDefinition({ code: "a_level_points", label: "13 A-Level Points" }), true);
assert.equal(isHighSchoolCoreRequirementDefinition({ code: "35_years_and_below", label: "35 Years and Below" }), true);
assert.equal(isHighSchoolCoreRequirementDefinition({ code: "teaching_qualification", label: "Teaching qualification" }), true);
assert.equal(isHighSchoolCoreRequirementDefinition({ code: "years_experience", label: "Minimum years of experience" }), false);

assert.equal(calculateAgeOnDate("1990-08-14", new Date("2026-08-14T12:00:00Z")), 36);
assert.equal(calculateAgeOnDate("1990-08-15", new Date("2026-08-14T12:00:00Z")), 35);
assert.equal(calculateAgeOnDate("1990-08-14", new Date("2026-08-13T22:30:00Z")), 36); // 00:30 on 14 Aug in Harare
assert.equal(calculateAgeOnDate("2026-02-30", new Date("2026-08-14T12:00:00Z")), null);

assert.deepEqual(calculateALevelPoints([
  { subject: "Mathematics", grade: "A" },
  { subject: "Physics", grade: "A" },
  { subject: "Chemistry", grade: "B" },
]), { points: 14, valid: true });
assert.equal(calculateALevelPoints([
  { subject: "Math", grade: "A" },
  { subject: "Math ", grade: "A" },
]).valid, false);

const policy = {
  maxAge: 35,
  minimumALevelPoints: 13,
  teachingQualifiedMinimumALevelPoints: 10,
  teachingQualificationExceptionEnabled: true,
};
const asOf = new Date("2026-08-14T12:00:00Z");
const results13 = [
  { subject: "Mathematics", grade: "A" },
  { subject: "Physics", grade: "A" },
  { subject: "Chemistry", grade: "C" },
];
const results10 = [
  { subject: "Mathematics", grade: "A" },
  { subject: "Physics", grade: "A" },
];
const results9 = [
  { subject: "Mathematics", grade: "A" },
  { subject: "Physics", grade: "B" },
];

assert.equal(evaluateHighSchoolEligibility({ dateOfBirth: "1991-08-14", aLevelResults: results13, holdsTeachingQualification: false, teachingCertificateUploaded: false, policy, asOf }).route, "standard");
assert.equal(evaluateHighSchoolEligibility({ dateOfBirth: "1991-08-14", aLevelResults: results10, holdsTeachingQualification: true, teachingCertificateUploaded: true, policy, asOf }).route, "teaching_qualification_exception");
assert.deepEqual(evaluateHighSchoolEligibility({ dateOfBirth: "1991-08-14", aLevelResults: results10, holdsTeachingQualification: true, teachingCertificateUploaded: false, policy, asOf }).failedCodes, ["core:teaching_certificate_required"]);
assert.deepEqual(evaluateHighSchoolEligibility({ dateOfBirth: "1991-08-14", aLevelResults: results9, holdsTeachingQualification: true, teachingCertificateUploaded: true, policy, asOf }).failedCodes, ["core:insufficient_a_level_points"]);
assert.ok(evaluateHighSchoolEligibility({ dateOfBirth: "1990-08-14", aLevelResults: results13, holdsTeachingQualification: true, teachingCertificateUploaded: true, policy, asOf }).failedCodes.includes("core:age_over_limit"));

const publicPolicy = publicHighSchoolEligibilityPolicy(policy) as Record<string, unknown>;
assert.equal(publicPolicy.minimumALevelPoints, 13);
assert.equal("teachingQualifiedMinimumALevelPoints" in publicPolicy, false);
assert.equal("teachingQualificationExceptionEnabled" in publicPolicy, false);

const highSchoolDocuments = coreRecruitmentDocumentRequirements("high_school_teaching", true);
assert.equal(highSchoolDocuments.find((document) => document.code === "teaching_certificate")?.isRequired, true);
assert.equal(coreRecruitmentDocumentRequirements("primary_teaching").find((document) => document.code === "teaching_certificate")?.isRequired, true);

console.log("Recruitment screening logic tests passed.");
