const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const files = {
  routes: read('server/routes.ts'),
  storage: read('server/storage.ts'),
  schema: read('shared/schema.ts'),
  studentsUi: read('client/src/pages/students.tsx'),
  staffUi: read('client/src/pages/staff.tsx'),
  transfersUi: read('client/src/pages/internal-transfers.tsx'),
  numbering: read('server/person-numbering.ts'),
  sequenceSync: read('script/sync-person-number-sequences.ts'),
};

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const notContains = (text, needle, message) => expect(!text.includes(needle), message);
const contains = (text, needle, message) => expect(text.includes(needle), message);

notContains(files.routes, 'getNextAdmissionNo()', 'Found getNextAdmissionNo() without explicit options.');
notContains(files.routes, 'getNextStaffNo()', 'Found getNextStaffNo() without explicit options.');
notContains(files.routes, 'data.admissionNo ||', 'Normal Student create still trusts a client admission number.');
notContains(files.routes, 'data.staffNo ||', 'Normal Staff create still trusts a client staff number.');
notContains(files.routes, 'FCGSM', 'Legacy FCGSM generation is still present in live routes.');
contains(files.routes, 'Admission numbers are assigned automatically by the server', 'Student create API is missing the manual-number rejection guard.');
contains(files.routes, 'Staff numbers are assigned automatically by the server', 'Staff create API is missing the manual-number rejection guard.');
contains(files.routes, 'Admission numbers are permanent and cannot be edited', 'Student update API is missing the immutable-number guard.');
contains(files.routes, 'Staff numbers are permanent and cannot be edited', 'Staff update API is missing the immutable-number guard.');
contains(files.routes, 'Use Internal Transfers to move a student between schools', 'Student school changes are not protected by the transfer workflow.');
contains(files.routes, 'Use Internal Transfers to move a staff member between schools', 'Staff school changes are not protected by the transfer workflow.');

notContains(files.studentsUi, 'name="admissionNo"', 'Student form still submits admissionNo.');
notContains(files.studentsUi, 'formData.get("admissionNo")', 'Student form handler still reads admissionNo.');
notContains(files.staffUi, 'name="staffNo"', 'Staff form still submits staffNo.');
notContains(files.staffUi, 'formData.get("staffNo")', 'Staff form handler still reads staffNo.');
notContains(files.transfersUi, 'New admission number', 'Internal transfer UI still offers a replacement admission number.');
notContains(files.transfersUi, 'studentForm.admissionNo', 'Internal transfer request still carries a replacement admission number.');

contains(files.schema, 'staffNo: true', 'insertStaffSchema does not omit staffNo.');
contains(files.schema, 'admissionNo: true', 'insertStudentSchema does not omit admissionNo.');
contains(files.schema, 'person_number_sequences', 'Persistent person-number sequence table is missing.');
contains(files.schema, 'students_admission_no_normalized_uidx', 'Normalized Student number unique index is missing.');
contains(files.schema, 'staff_staff_no_normalized_uidx', 'Normalized Staff number unique index is missing.');
contains(files.schema, 'students_admission_no_canonical_chk', 'Canonical Student number DB check is missing.');
contains(files.schema, 'staff_staff_no_canonical_chk', 'Canonical Staff number DB check is missing.');

contains(files.storage, 'pg_advisory_xact_lock', 'Allocator is missing the transaction-scoped concurrency lock.');
contains(files.storage, 'personNumberSequences', 'Allocator is not using the persistent sequence state.');
contains(files.storage, 'Math.max(storedSequence, consumedSequence) + 1', 'Allocator does not reconcile counter state with globally consumed numbers.');
contains(files.storage, 'const nextAdmissionNo = existing.admissionNo;', 'Student transfers do not explicitly preserve the original admission number.');
contains(files.storage, 'schoolId: _blockedSchoolId', 'Storage update path is not stripping direct school changes.');
contains(files.numbering, '[0-9]{4,}', 'Person number parser must support four or more sequence digits.');
contains(files.numbering, 'padStart(4, "0")', 'Person number formatter must preserve four-digit minimum formatting.');
contains(files.numbering, 'schoolIdFromSequenceCode', 'Sequence-code reverse mapping is missing for high-water synchronization.');
contains(files.sequenceSync, 'personNumberSequences', 'Sequence high-water synchronization is missing the persistent sequence table.');
contains(files.sequenceSync, 'parsePersonNumber', 'Sequence high-water synchronization is not deriving state from canonical issued identifiers.');

if (failures.length) {
  console.error('Person-numbering hardening source validation FAILED:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Person-numbering hardening source validation passed.');
