/** Deterministic CANDIDATE generation. A score alone never authorises an account link. */
export function sageCode(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
export function cleanName(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
}
const noise = new Set(["mr", "mrs", "miss", "master", "ms", "jr", "jnr"]);
const nameTokens = (value: unknown) => cleanName(value).split(" ").filter(t => t && !noise.has(t));
export function sageForm(value: unknown): number | null {
  const txt = cleanName(value);
  const m = txt.match(/(?:form|frm|f)\s*([1-6])\b/) || txt.match(/^(?:l|u)\s*([56])(?:\b|(?=[a-z]))/);
  return m ? Number(m[1]) : null;
}
function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
export type SageCandidateStudent = { id: number; firstName: string; lastName: string; admissionNo?: string | null; status?: string | null; className?: string | null; streamName?: string | null };
export type SageCandidate = { studentId: number; name: string; admissionNo: string | null; score: number; evidence: string[] };
export function suggestSageStudents(name: string, group: string, area: string, students: SageCandidateStudent[]): SageCandidate[] {
  const rawTokens = nameTokens(name);
  if (!rawTokens.length) return [];
  const normalized = [...rawTokens].sort().join(" ");
  const form = sageForm(group);
  const areaNorm = cleanName(area);
  const output: SageCandidate[] = [];
  for (const student of students) {
    if (student.status && ["transferred", "internally_transferred", "graduated"].includes(student.status)) continue;
    const tokens = nameTokens(`${student.firstName} ${student.lastName}`);
    if (!tokens.length) continue;
    const joined = [...tokens].sort().join(" ");
    const exactOrderInsensitive = normalized === joined;
    let score = exactOrderInsensitive ? 95 : 0;
    const evidence = [] as string[];
    if (exactOrderInsensitive) evidence.push("Name matches regardless of word order/punctuation");
    if (!exactOrderInsensitive) {
      const shared = rawTokens.filter(x => tokens.includes(x)).length;
      // Short initials are supporting evidence, never a stand-alone identity.
      const initials = rawTokens.filter(x => x.length===1 && tokens.some(y=>y.length>1 && y.startsWith(x))).length;
      const typo = rawTokens.some(x => x.length >= 4 && tokens.some(y => Math.abs(y.length - x.length) <= 2 && editDistance(x,y) <= (x.length>=7 ? 2 : 1)));
      const surname = cleanName(student.lastName);
      const sageHasSurname = rawTokens.includes(surname) && surname.length>=3;
      score = Math.round((shared / Math.max(tokens.length,rawTokens.length)) * 78) + Math.min(12, initials*9) + (typo ? 8 : 0) + (sageHasSurname ? 12 : 0);
      if (shared) evidence.push(`${shared} shared name part(s)`);
      if (sageHasSurname) evidence.push("FCGS surname found in Sage name");
      if (typo) evidence.push("Possible spelling variance");
      if (initials) evidence.push(`${initials} matching initial(s)`);
    }
    if (form !== null) {
      const classForm = sageForm(student.className || "") ?? sageForm(student.streamName || "");
      if (classForm !== null && form !== classForm) continue;
      if (classForm === form) { score += 4; evidence.push("Matching form"); }
    }
    if (areaNorm.length >= 3 && [student.className, student.streamName].some(x => x && cleanName(x).includes(areaNorm))) { score += 3; evidence.push("Matching stream/class information"); }
    if (score < 58) continue;
    output.push({ studentId: student.id, name: `${student.firstName} ${student.lastName}`.trim(), admissionNo: student.admissionNo || null, score: Math.min(100,score), evidence });
  }
  return output.sort((a,b)=> b.score - a.score || a.studentId - b.studentId).slice(0,8);
}
