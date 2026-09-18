import assert from "node:assert/strict";
import {
  calculateAgeOnDate,
  calculateALevelPoints,
  evaluateHighSchoolEligibility,
  evaluatePrimarySchoolEligibility,
  evaluateRecruitmentRequirement,
  publicHighSchoolEligibilityPolicy,
  publicPrimarySchoolEligibilityPolicy,
} from "../server/recruitment-screening";
import {
  coreRecruitmentDocumentRequirements,
  examBoardMatches,
  isHighSchoolCoreRequirementDefinition,
  isPrimarySchoolCoreRequirementDefinition,
  normalizeExamBoardList,
  recruitmentCategoryCode,
} from "../shared/recruitment";

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
assert.equal(isPrimarySchoolCoreRequirementDefinition({ code: "primary_teaching_qualification", label: "Teaching qualification" }), true);
assert.equal(isPrimarySchoolCoreRequirementDefinition({ code: "o_level_sittings", label: "Maximum O-Level sittings" }), true);
assert.equal(isPrimarySchoolCoreRequirementDefinition({ code: "minimum_o_level_subjects", label: "5 O-Level subjects" }), true);
assert.equal(isPrimarySchoolCoreRequirementDefinition({ code: "english_pass", label: "English C or better" }), true);
assert.equal(isPrimarySchoolCoreRequirementDefinition({ code: "years_experience", label: "Minimum years of experience" }), false);

// Applicant examination boards are a real multi-select. Historical "Both" remains compatible
// with the two boards it represented at the time and never behaves as a third board.
assert.deepEqual(normalizeExamBoardList("Both"), ["ZIMSEC", "Cambridge"]);
assert.deepEqual(normalizeExamBoardList(["Cambridge", "ZIMSEC", "cambridge"]), ["Cambridge", "ZIMSEC"]);
assert.equal(examBoardMatches(["ZIMSEC", "Cambridge"], "Cambridge"), true);
assert.equal(examBoardMatches(["ZIMSEC", "Cambridge"], "ZIMSEC"), true);
assert.equal(examBoardMatches(["Cambridge"], "ZIMSEC"), false);
assert.equal(examBoardMatches("Both", "Cambridge"), true);
assert.equal(examBoardMatches("Both", "ZIMSEC"), true);
assert.equal(examBoardMatches("Both", "Future Board"), false);

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

const primaryPolicy = {
  teachingQualificationRequired: true,
  maximumOLevelSittings: 2,
  minimumOLevelSubjects: 5,
  minimumOLevelGrade: "C",
  mandatoryOLevelSubjects: ["Mathematics", "Science", "English"],
  mandatoryOLevelGrade: "C",
};
const eligiblePrimaryResults = [
  { subject: "Maths", grade: "B", sitting: 1 },
  { subject: "English", grade: "C", sitting: 1 },
  { subject: "Science", grade: "A", sitting: 1 },
  { subject: "Geography", grade: "C", sitting: 2 },
  { subject: "History", grade: "B", sitting: 2 },
];
const primaryPass = evaluatePrimarySchoolEligibility({
  oLevelResults: eligiblePrimaryResults,
  holdsTeachingQualification: true,
  policy: primaryPolicy,
});
assert.equal(primaryPass.passed, true);
assert.equal(primaryPass.route, "primary_policy");
assert.equal(primaryPass.oLevelSittingCount, 2);
assert.equal(primaryPass.oLevelQualifyingSubjectCount, 5);

const noPrimaryQualification = evaluatePrimarySchoolEligibility({
  oLevelResults: eligiblePrimaryResults,
  holdsTeachingQualification: false,
  policy: primaryPolicy,
});
assert.ok(noPrimaryQualification.failedCodes.includes("core:primary_teaching_qualification_required"));

const tooManySittings = evaluatePrimarySchoolEligibility({
  oLevelResults: [...eligiblePrimaryResults, { subject: "Shona", grade: "C", sitting: 3 }],
  holdsTeachingQualification: true,
  policy: primaryPolicy,
});
assert.ok(tooManySittings.failedCodes.includes("core:o_level_too_many_sittings"));

const scienceBelowMinimum = evaluatePrimarySchoolEligibility({
  oLevelResults: eligiblePrimaryResults.map((row) => row.subject === "Science" ? { ...row, grade: "D" } : row),
  holdsTeachingQualification: true,
  policy: primaryPolicy,
});
assert.ok(scienceBelowMinimum.failedCodes.includes("core:o_level_science_required_or_below_minimum"));
assert.ok(scienceBelowMinimum.failedCodes.includes("core:o_level_insufficient_qualifying_subjects"));

const insufficientSubjects = evaluatePrimarySchoolEligibility({
  oLevelResults: eligiblePrimaryResults.slice(0, 4),
  holdsTeachingQualification: true,
  policy: primaryPolicy,
});
assert.ok(insufficientSubjects.failedCodes.includes("core:o_level_insufficient_qualifying_subjects"));

const primaryPublicPolicy = publicPrimarySchoolEligibilityPolicy(primaryPolicy);
assert.equal(primaryPublicPolicy.maximumOLevelSittings, 2);
assert.equal(primaryPublicPolicy.minimumOLevelSubjects, 5);
assert.deepEqual(primaryPublicPolicy.mandatoryOLevelSubjects, ["Mathematics", "Science", "English"]);
assert.ok(primaryPublicPolicy.gradeOptions.includes("C"));

const highSchoolDocuments = coreRecruitmentDocumentRequirements("high_school_teaching", true);
assert.equal(highSchoolDocuments.find((document) => document.code === "teaching_certificate")?.isRequired, true);
assert.equal(coreRecruitmentDocumentRequirements("primary_teaching", false, true).find((document) => document.code === "teaching_certificate")?.isRequired, true);
assert.equal(coreRecruitmentDocumentRequirements("primary_teaching", false, false).find((document) => document.code === "teaching_certificate")?.isRequired, false);
assert.equal(coreRecruitmentDocumentRequirements("primary_teaching", true, false).find((document) => document.code === "teaching_certificate")?.isRequired, true);

console.log("Recruitment screening logic tests passed.");
