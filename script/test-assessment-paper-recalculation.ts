import assert from "node:assert/strict";
import { calculateWeightedAssessmentResult } from "../server/assessment-paper-calculation";
import { acquireAssessmentMutationLock } from "../server/assessment-mutation-lock";

async function main() {

  const original = calculateWeightedAssessmentResult(
    [
      { id: 1, paperName: "Paper 1", paperMarks: 100, paperWeightPct: 40 },
      { id: 2, paperName: "Paper 2", paperMarks: 100, paperWeightPct: 60 },
    ],
    [
      { assessmentPaperId: 1, markObtained: 80 },
      { assessmentPaperId: 2, markObtained: 60 },
    ],
  );
  assert.equal(original.complete, true);
  assert.equal(original.percentage, 68);

  const reweighted = calculateWeightedAssessmentResult(
    [
      { id: 1, paperName: "Paper 1", paperMarks: 100, paperWeightPct: 50 },
      { id: 2, paperName: "Paper 2", paperMarks: 100, paperWeightPct: 50 },
    ],
    [
      { assessmentPaperId: 1, markObtained: 80 },
      { assessmentPaperId: 2, markObtained: 60 },
    ],
  );
  assert.equal(reweighted.complete, true);
  assert.equal(reweighted.percentage, 70);

  const addedPaper = calculateWeightedAssessmentResult(
    [
      { id: 1, paperName: "Paper 1", paperMarks: 100, paperWeightPct: 40 },
      { id: 2, paperName: "Paper 2", paperMarks: 100, paperWeightPct: 40 },
      { id: 3, paperName: "Paper 3", paperMarks: 50, paperWeightPct: 20 },
    ],
    [
      { assessmentPaperId: 1, markObtained: 80 },
      { assessmentPaperId: 2, markObtained: 60 },
    ],
  );
  assert.equal(addedPaper.complete, false);
  assert.equal(addedPaper.percentage, null);
  assert.equal(addedPaper.hasAnyMark, true);

  const reducedMaximum = calculateWeightedAssessmentResult(
    [{ id: 1, paperName: "Paper 1", paperMarks: 50, paperWeightPct: 100 }],
    [{ assessmentPaperId: 1, markObtained: 80 }],
  );
  assert.equal(reducedMaximum.complete, false);
  assert.equal(reducedMaximum.marksOverMaximum.length, 1);

  const duplicateMarks = calculateWeightedAssessmentResult(
    [{ id: 1, paperName: "Paper 1", paperMarks: 100, paperWeightPct: 100 }],
    [
      { assessmentPaperId: 1, markObtained: 60 },
      { assessmentPaperId: 1, markObtained: 70 },
    ],
  );
  assert.deepEqual(duplicateMarks.duplicatePaperIds, [1]);
  assert.equal(duplicateMarks.complete, false);

  const releaseFirst = await acquireAssessmentMutationLock(999001);
  let secondEntered = false;
  const secondWaiter = (async () => {
    const releaseSecond = await acquireAssessmentMutationLock(999001);
    secondEntered = true;
    releaseSecond();
  })();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(secondEntered, false, "The second writer must wait for the first assessment lock");
  releaseFirst();
  await secondWaiter;
  assert.equal(secondEntered, true);

  console.log("Assessment paper recalculation and mutation-lock tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
