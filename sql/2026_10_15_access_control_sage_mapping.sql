-- Additive: never overwrites existing accounts, balances, timestamps or RBAC selections.
BEGIN;
ALTER TABLE fees_import_items ADD COLUMN IF NOT EXISTS balance_provided boolean NOT NULL DEFAULT true;
ALTER TABLE fees_import_items ADD COLUMN IF NOT EXISTS matching_candidates jsonb;
ALTER TABLE fees_import_items ADD COLUMN IF NOT EXISTS mapping_state text NOT NULL DEFAULT 'unresolved';
CREATE TABLE IF NOT EXISTS sage_identity_links (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 school_id integer NOT NULL REFERENCES schools(id),
 student_id integer NOT NULL REFERENCES students(id),
 customer_code text NOT NULL,
 normalized_code text NOT NULL,
 confirmed_by_user_id integer REFERENCES users(id),
 confirmed_at timestamp NOT NULL DEFAULT now(),
 source text NOT NULL DEFAULT 'reconciliation',
 CONSTRAINT sage_identity_links_code_not_empty CHECK (length(trim(normalized_code)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS sage_identity_links_school_code_uidx ON sage_identity_links (school_id, normalized_code);
CREATE UNIQUE INDEX IF NOT EXISTS sage_identity_links_school_student_uidx ON sage_identity_links (school_id, student_id);
COMMIT;
