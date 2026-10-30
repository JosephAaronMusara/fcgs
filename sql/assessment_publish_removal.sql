BEGIN;

UPDATE assessments
SET is_published = TRUE
WHERE is_published IS DISTINCT FROM TRUE;

ALTER TABLE assessments
ALTER COLUMN is_published SET DEFAULT TRUE;

COMMIT;