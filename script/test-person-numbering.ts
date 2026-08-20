import assert from "node:assert/strict";
import { buildPersonNumber, parsePersonNumber, personNumberPattern, requirePositiveSchoolId, schoolIdFromSequenceCode, schoolSequenceCode } from "../server/person-numbering";

assert.equal(schoolSequenceCode(1), "A");
assert.equal(schoolSequenceCode(26), "Z");
assert.equal(schoolSequenceCode(27), "AA");
assert.equal(schoolSequenceCode(52), "AZ");
assert.equal(schoolIdFromSequenceCode("A"), 1);
assert.equal(schoolIdFromSequenceCode("Z"), 26);
assert.equal(schoolIdFromSequenceCode("AA"), 27);
assert.equal(schoolIdFromSequenceCode("AZ"), 52);
assert.throws(() => schoolIdFromSequenceCode("A1"), /invalid school sequence code/i);
assert.throws(() => requirePositiveSchoolId(0), /valid school/i);
assert.throws(() => requirePositiveSchoolId(undefined), /valid school/i);

const date2026 = new Date("2026-08-20T10:00:00Z");
assert.equal(buildPersonNumber("student", 3, 1, date2026), "FCGS26S0001C");
assert.equal(buildPersonNumber("staff", 6, 2, date2026), "FCGS26E0002F");
assert.equal(buildPersonNumber("student", 3, 9999, date2026), "FCGS26S9999C");
assert.equal(buildPersonNumber("student", 3, 10000, date2026), "FCGS26S10000C");

const parsed = parsePersonNumber(" FCGS26S10000C ");
assert.ok(parsed);
assert.equal(parsed?.sequence, 10000);
assert.equal(parsed?.schoolCode, "C");
assert.equal(parsed?.kind, "student");
assert.equal(parsePersonNumber("FCGSM0001"), null);
assert.equal(parsePersonNumber("FCGS26S123C"), null);
assert.match("FCGS26S10000C", new RegExp(personNumberPattern("student", 3, date2026), "i"));

console.log("Person numbering logic tests passed.");
