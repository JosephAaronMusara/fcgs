import assert from "node:assert/strict";
import { calculateConfiguredPositionMap, normalizeGradeStatus, resolveExactConfiguredGrade, type RankingCandidate } from "../server/grading-engine";
import { resolveGradeProfileKey } from "../shared/academic-profiles";
import { isTemporarilyExcludedFromStrictGrading } from "../server/grading-exclusions";

const grade = (id: number, name: string, points: number, rankOrder: number, lower: number, upper: number, status: "PASS" | "FAIL" = "PASS") => ({
  id,
  gradeName: name,
  gradeLevel: "SEC_CAM_IGCSE",
  lowerLimit: lower,
  upperLimit: upper,
  gradePoints: points,
  rankOrder,
  gradeStatus: status,
  appliesAll: true,
});

const aStar = grade(1, "A*", 5, 1, 90, 100);
const a = grade(2, "A", 5, 2, 80, 89);
const b = grade(3, "B", 4, 3, 70, 79);
const fail = grade(4, "U", 0, 4, 0, 69, "FAIL");

function candidate(id: number, rows: Array<[number, number, any]>): RankingCandidate {
  return {
    id,
    expectedSubjectIds: rows.map(([subjectId]) => subjectId),
    results: rows.map(([subjectId, percentage, configuredGrade]) => ({
      subjectId,
      percentage,
      grade: configuredGrade,
      profileKey: "SEC_CAM_IGCSE",
    })),
  };
}

const equalPointDifferentGrade = calculateConfiguredPositionMap({
  pointsDirection: "higher_is_better",
  candidates: [
    candidate(1, [[1, 92, aStar], [2, 82, a], [3, 72, b]]),
    candidate(2, [[1, 85, a], [2, 84, a], [3, 74, b]]),
  ],
});
assert.equal(equalPointDifferentGrade.map.get(1), "1/2", "A* must break an equal-points tie ahead of A");
assert.equal(equalPointDifferentGrade.map.get(2), "2/2");

const lowerIsBetter = calculateConfiguredPositionMap({
  pointsDirection: "lower_is_better",
  candidates: [
    candidate(1, [[1, 95, { ...aStar, gradePoints: 1 }], [2, 90, { ...aStar, gradePoints: 1 }]]),
    candidate(2, [[1, 85, { ...a, gradePoints: 2 }], [2, 82, { ...a, gradePoints: 2 }]]),
  ],
});
assert.equal(lowerIsBetter.map.get(1), "1/2", "lower total points must rank first when configured");

const averageTieBreak = calculateConfiguredPositionMap({
  pointsDirection: "higher_is_better",
  candidates: [
    candidate(1, [[1, 95, aStar], [2, 81, a]]),
    candidate(2, [[1, 91, aStar], [2, 80, a]]),
  ],
});
assert.equal(averageTieBreak.map.get(1), "1/2", "average percentage must break identical points and grade distributions");

const exactTie = calculateConfiguredPositionMap({
  pointsDirection: "higher_is_better",
  candidates: [
    candidate(1, [[1, 95, aStar], [2, 81, a]]),
    candidate(2, [[1, 95, aStar], [2, 81, a]]),
    candidate(3, [[1, 75, b], [2, 74, b]]),
  ],
});
assert.equal(exactTie.map.get(1), "1/3");
assert.equal(exactTie.map.get(2), "1/3");
assert.equal(exactTie.map.get(3), "3/3");

const incomplete = calculateConfiguredPositionMap({
  pointsDirection: "higher_is_better",
  candidates: [{
    id: 1,
    expectedSubjectIds: [1, 2],
    results: [
      { subjectId: 1, percentage: 90, grade: aStar, profileKey: "SEC_CAM_IGCSE" },
      { subjectId: 2, percentage: null, grade: null, profileKey: "SEC_CAM_IGCSE" },
    ],
  }],
});
assert.equal(incomplete.map.get(1), "1/1", "missing subjects must be ignored when at least one valid result exists");
assert.equal(incomplete.unresolved.has(1), false);

const exactResolution = resolveExactConfiguredGrade({
  percentage: 85,
  expectedProfileKey: "SEC_CAM_IGCSE",
  classId: 1,
  exactProfileGrades: [aStar, a, b, fail],
  storedGrade: { ...a, gradeLevel: "SEC_ZIM_O" },
});
assert.equal(exactResolution.grade?.id, a.id, "wrong-profile stored grade must be ignored and exact profile recalculated");
assert.equal(exactResolution.passStatus, "PASS");
assert.equal(normalizeGradeStatus(null), "UNRESOLVED");

const mixedSubjectSets = calculateConfiguredPositionMap({
  pointsDirection: "higher_is_better",
  candidates: [
    candidate(1, [[1, 95, aStar], [2, 81, a]]),
    candidate(2, [[1, 91, aStar], [3, 80, a], [4, 75, b]]),
  ],
});
assert.equal(mixedSubjectSets.size, 2, "different subject sets must share one ranking pool");
assert.equal(mixedSubjectSets.map.get(2), "1/2", "raw total points must decide position despite subject-count differences");
assert.equal(mixedSubjectSets.map.get(1), "2/2");

const noResults = calculateConfiguredPositionMap({
  pointsDirection: "lower_is_better",
  candidates: [{
    id: 1,
    expectedSubjectIds: [1, 2],
    results: [
      { subjectId: 1, percentage: null, grade: null, profileKey: "SEC_CAM_IGCSE" },
      { subjectId: 2, percentage: null, grade: null, profileKey: "SEC_CAM_IGCSE" },
    ],
  }],
});
assert.equal(noResults.map.has(1), false, "a zero-result learner must never rank first in a lower-is-better profile");
assert.deepEqual(noResults.unresolved.get(1), ["no_valid_results"]);


const crossBoardIgnored = resolveExactConfiguredGrade({
  percentage: 85,
  expectedProfileKey: "SEC_ZIM_O",
  classId: 1,
  exactProfileGrades: [{ ...a, id: 20, gradeLevel: "SEC_CAM_IGCSE" }],
  storedGrade: null,
});
assert.equal(crossBoardIgnored.grade, null, "a Cambridge grade must never satisfy a ZIMSEC exact profile");
assert.equal(crossBoardIgnored.passStatus, "UNRESOLVED");

assert.equal(resolveGradeProfileKey({
  schoolType: "secondary",
  examinationBoard: "ZIMSEC",
  streamName: "Form 3",
  subjectType: "Cambridge IGCSE",
}), null, "a subject from another board must not resolve inside a ZIMSEC school");
assert.equal(resolveGradeProfileKey({
  schoolType: "secondary",
  examinationBoard: null,
  streamName: "Form 3",
  subjectType: "ZIMSEC Ordinary Level",
}), null, "missing school board configuration must remain unresolved");

assert.equal(
  isTemporarilyExcludedFromStrictGrading("Computing – Lower Secondary"),
  true,
  "the temporary Lower Secondary exclusion must tolerate typographic dashes",
);
assert.equal(
  isTemporarilyExcludedFromStrictGrading({ name: "Mathematics" }),
  false,
  "unrelated subjects must remain inside strict grading",
);

console.log(JSON.stringify({ passed: true, tests: 15 }, null, 2));
