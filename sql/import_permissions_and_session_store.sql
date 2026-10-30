BEGIN;

INSERT INTO permissions (code, name, description, category)
VALUES
  ('students.import', 'Import Students', 'Import student records from spreadsheets', 'Students'),
  ('parents.import', 'Import Parents', 'Import parent and guardian records from spreadsheets', 'Parents'),
  ('staff.import', 'Import Staff', 'Import staff records from spreadsheets', 'Staff'),
  ('clinic.import', 'Import Clinic Records', 'Import clinic and health records from spreadsheets', 'Clinic'),
  ('fees.import', 'Import Fees', 'Import fee balances and payment data from spreadsheets', 'Finance')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO access_group_permissions (access_group_id, permission_id)
SELECT ag.id, p.id
FROM access_groups ag
JOIN permissions p ON p.code IN ('students.import', 'parents.import', 'staff.import', 'clinic.import', 'fees.import')
WHERE ag.name IN ('School Admin', 'Org HQ')
ON CONFLICT DO NOTHING;

INSERT INTO access_group_permissions (access_group_id, permission_id)
SELECT ag.id, p.id
FROM access_groups ag
JOIN permissions p ON p.code = 'fees.import'
WHERE ag.name = 'Accountant'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'session_pkey'
      AND conrelid = 'session'::regclass
  ) THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

COMMIT;
