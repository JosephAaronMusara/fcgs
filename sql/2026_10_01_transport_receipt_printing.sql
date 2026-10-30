BEGIN;

ALTER TABLE transport_settings
  ADD COLUMN IF NOT EXISTS receipt_print_format text;

UPDATE transport_settings
SET receipt_print_format = 'a4'
WHERE receipt_print_format IS NULL
   OR receipt_print_format NOT IN ('a4', 'thermal80');

ALTER TABLE transport_settings
  ALTER COLUMN receipt_print_format SET DEFAULT 'a4',
  ALTER COLUMN receipt_print_format SET NOT NULL;

COMMIT;
