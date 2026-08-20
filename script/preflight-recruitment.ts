import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { RBAC_PERMISSIONS_DATA } from "../server/rbac-config";

const requiredTables = [
  "recruitment_settings",
  "recruitment_vacancies",
  "recruitment_requirements",
  "recruitment_document_categories",
  "recruitment_applications",
  "recruitment_application_answers",
  "recruitment_application_documents",
  "recruitment_application_status_history",
  "recruitment_rejection_attempts",
  "recruitment_interviews",
];

const requiredColumns: Array<[string, string]> = [
  ["recruitment_settings", "attachment_size_limit_mb"],
  ["recruitment_settings", "general_application_categories"],
  ["recruitment_settings", "high_school_max_age"],
  ["recruitment_settings", "high_school_minimum_a_level_points"],
  ["recruitment_settings", "high_school_teaching_qualified_minimum_a_level_points"],
  ["recruitment_settings", "high_school_teaching_qualification_exception_enabled"],
  ["recruitment_vacancies", "organization_id"],
  ["recruitment_vacancies", "status"],
  ["recruitment_requirements", "scope_key"],
  ["recruitment_requirements", "auto_reject_on_fail"],
  ["recruitment_requirements", "alternative_pass_keywords"],
  ["recruitment_requirements", "alternative_pass_note"],
  ["recruitment_document_categories", "scope_key"],
  ["recruitment_applications", "normalized_email"],
  ["recruitment_applications", "normalized_phone"],
  ["recruitment_applications", "normalized_national_id"],
  ["recruitment_applications", "eligibility_status"],
  ["recruitment_applications", "age_at_submission"],
  ["recruitment_applications", "a_level_results"],
  ["recruitment_applications", "a_level_points"],
  ["recruitment_applications", "holds_teaching_qualification"],
  ["recruitment_applications", "eligibility_route"],
  ["recruitment_application_answers", "alternative_accepted"],
  ["recruitment_application_answers", "evaluation_note"],
  ["recruitment_application_documents", "is_active"],
  ["recruitment_application_documents", "archived_at"],
  ["recruitment_application_status_history", "actor_type"],
  ["recruitment_application_status_history", "actor_label"],
  ["recruitment_rejection_attempts", "reason_code"],
  ["recruitment_rejection_attempts", "screening_details"],
  ["recruitment_interviews", "outcome"],
];

const requiredPermissions = RBAC_PERMISSIONS_DATA
  .filter((permission) => permission.code.startsWith("recruitment."))
  .map((permission) => permission.code);

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(query);
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count || 0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Run: npx dotenv -e .env -- npm run recruitment:preflight");
  }

  const tableRows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const presentTables = new Set((tableRows.rows as Array<{ tablename: string }>).map((row) => row.tablename));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));

  const columnRows = await db.execute(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  const presentColumns = new Set(
    (columnRows.rows as Array<{ table_name: string; column_name: string }>).map((row) => `${row.table_name}.${row.column_name}`),
  );
  const missingColumns = requiredColumns
    .filter(([table, column]) => !presentColumns.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);

  const permissionRows = presentTables.has("permissions")
    ? await db.execute(sql`select code from permissions where code like 'recruitment.%'`)
    : { rows: [] };
  const presentPermissions = new Set((permissionRows.rows as Array<{ code: string }>).map((row) => row.code));
  const missingPermissions = requiredPermissions.filter((permission) => !presentPermissions.has(permission));

  const checks = {
    settingsWithoutGeneralApplicationCategories: presentColumns.has("recruitment_settings.general_application_categories")
      ? await count(sql`
          select count(*)
          from recruitment_settings
          where jsonb_typeof(general_application_categories) <> 'array'
             or jsonb_array_length(general_application_categories) = 0
        `)
      : 0,
    alternativeAnswersMarkedFailed: presentColumns.has("recruitment_application_answers.alternative_accepted")
      ? await count(sql`
          select count(*)
          from recruitment_application_answers
          where alternative_accepted = true and passed = false
        `)
      : 0,
    duplicateNormalizedEmails: presentTables.has("recruitment_applications")
      ? await count(sql`
          select count(*) from (
            select organization_id, normalized_email
            from recruitment_applications
            group by organization_id, normalized_email
            having count(*) > 1
          ) duplicate_rows
        `)
      : 0,
    duplicateNormalizedPhones: presentTables.has("recruitment_applications")
      ? await count(sql`
          select count(*) from (
            select organization_id, normalized_phone
            from recruitment_applications
            group by organization_id, normalized_phone
            having count(*) > 1
          ) duplicate_rows
        `)
      : 0,
    duplicateNormalizedNationalIds: presentTables.has("recruitment_applications")
      ? await count(sql`
          select count(*) from (
            select organization_id, normalized_national_id
            from recruitment_applications
            group by organization_id, normalized_national_id
            having count(*) > 1
          ) duplicate_rows
        `)
      : 0,
    vacancySchoolOrganizationMismatches: presentTables.has("recruitment_vacancies")
      ? await count(sql`
          select count(*)
          from recruitment_vacancies vacancies
          join schools on schools.id = vacancies.school_id
          where vacancies.school_id is not null
            and schools.organization_id <> vacancies.organization_id
        `)
      : 0,
    applicationSchoolOrganizationMismatches: presentTables.has("recruitment_applications")
      ? await count(sql`
          select count(*)
          from recruitment_applications applications
          join schools on schools.id = applications.school_id
          where applications.school_id is not null
            and schools.organization_id <> applications.organization_id
        `)
      : 0,
    activeDocumentsMissingFiles: presentTables.has("recruitment_application_documents")
      ? await count(sql`
          select count(*)
          from recruitment_application_documents
          where is_active = true
            and (storage_key is null or trim(storage_key) = '')
        `)
      : 0,
    invalidHighSchoolPolicies: presentColumns.has("recruitment_settings.high_school_max_age")
      ? await count(sql`
          select count(*)
          from recruitment_settings
          where high_school_max_age < 18
             or high_school_minimum_a_level_points < 0
             or high_school_teaching_qualified_minimum_a_level_points < 0
             or high_school_teaching_qualified_minimum_a_level_points > high_school_minimum_a_level_points
        `)
      : 0,
  };

  const blockingChecks = Object.entries(checks)
    .filter(([, value]) => value > 0)
    .map(([name]) => name);

  const result = {
    requiredTables: requiredTables.length,
    missingTables,
    requiredColumns: requiredColumns.length,
    missingColumns,
    requiredPermissions: requiredPermissions.length,
    missingPermissions,
    checks,
    status: missingTables.length || missingColumns.length || missingPermissions.length || blockingChecks.length
      ? "BLOCKED"
      : "READY",
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "READY") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
