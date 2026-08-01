import assert from "node:assert/strict";
import { evaluateRecruitmentRequirement } from "../server/recruitment-screening";

const base = {
  inputType: "select",
  acceptedValues: ["Primary Teaching Certificate"],
  minimumNumber: null,
  maximumNumber: null,
  alternativePassKeywords: ["Bachelor of Education", "B.Ed"],
  alternativePassNote: "Equivalent teaching qualification accepted.",
};

assert.deepEqual(
  evaluateRecruitmentRequirement(base, "Primary Teaching Certificate", ""),
  { passed: true, alternativeAccepted: false, evaluationNote: null },
);

assert.deepEqual(
  evaluateRecruitmentRequirement(base, "Other", "Bachelor of Education in Primary Education"),
  { passed: true, alternativeAccepted: true, evaluationNote: "Equivalent teaching qualification accepted." },
);

assert.equal(
  evaluateRecruitmentRequirement(base, "Other", "BEd in Primary Education").alternativeAccepted,
  true,
);

assert.deepEqual(
  evaluateRecruitmentRequirement(base, "Other", "Diploma in Bookkeeping"),
  { passed: false, alternativeAccepted: false, evaluationNote: null },
);

assert.deepEqual(
  evaluateRecruitmentRequirement({ ...base, inputType: "number", acceptedValues: [], minimumNumber: 3, alternativePassKeywords: [] }, 4, ""),
  { passed: true, alternativeAccepted: false, evaluationNote: null },
);

console.log("Recruitment screening logic tests passed.");
