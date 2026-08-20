export type PersonNumberKind = "student" | "staff";

export function requirePositiveSchoolId(value: unknown): number {
  const schoolId = Number(value);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    throw new Error("A valid school is required before a person number can be allocated");
  }
  return schoolId;
}

export function schoolSequenceCode(schoolId: number): string {
  let remaining = requirePositiveSchoolId(schoolId);
  let result = "";
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    result = String.fromCharCode(65 + offset) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}

export function normalizeIssuanceDate(value?: string | Date | null): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function schoolIdFromSequenceCode(value: string): number {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error("Invalid school sequence code");
  }

  let schoolId = 0;
  for (const character of normalized) {
    schoolId = schoolId * 26 + (character.charCodeAt(0) - 64);
    if (!Number.isSafeInteger(schoolId)) {
      throw new Error("School sequence code is outside the supported range");
    }
  }
  return requirePositiveSchoolId(schoolId);
}

export function personNumberPrefix(kind: PersonNumberKind): "S" | "E" {
  return kind === "student" ? "S" : "E";
}

export function buildPersonNumber(
  kind: PersonNumberKind,
  schoolId: number,
  sequence: number,
  issuanceDate?: string | Date | null,
): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("Person number sequence must be a positive safe integer");
  }
  const date = normalizeIssuanceDate(issuanceDate);
  const yy = String(date.getFullYear()).slice(-2);
  const sequenceText = String(sequence).padStart(4, "0");
  return `FCGS${yy}${personNumberPrefix(kind)}${sequenceText}${schoolSequenceCode(schoolId)}`;
}

export function personNumberPattern(
  kind: PersonNumberKind,
  schoolId: number,
  issuanceDate?: string | Date | null,
): string {
  const date = normalizeIssuanceDate(issuanceDate);
  const yy = String(date.getFullYear()).slice(-2);
  return `^FCGS${yy}${personNumberPrefix(kind)}([0-9]+)${schoolSequenceCode(schoolId)}$`;
}

export type ParsedPersonNumber = {
  normalized: string;
  year2: string;
  kind: PersonNumberKind;
  sequence: number;
  sequenceText: string;
  schoolCode: string;
};

export function parsePersonNumber(value?: string | null): ParsedPersonNumber | null {
  const normalized = String(value || "").trim().toUpperCase();
  const match = normalized.match(/^FCGS([0-9]{2})([SE])([0-9]{4,})([A-Z]+)$/);
  if (!match) return null;
  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return null;
  return {
    normalized,
    year2: match[1],
    kind: match[2] === "S" ? "student" : "staff",
    sequence,
    sequenceText: match[3],
    schoolCode: match[4],
  };
}
