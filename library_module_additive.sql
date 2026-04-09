BEGIN;

ALTER TABLE public.library_loans
  ADD COLUMN IF NOT EXISTS condition_on_return text,
  ADD COLUMN IF NOT EXISTS marked_lost_at timestamp,
  ADD COLUMN IF NOT EXISTS marked_recovered_at timestamp;

DO $fcgs$
DECLARE
  due_date_type text;
BEGIN
  SELECT data_type INTO due_date_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'library_loans'
    AND column_name = 'due_date';

  IF due_date_type = 'date' THEN
    EXECUTE '
      ALTER TABLE public.library_loans
      ALTER COLUMN due_date TYPE timestamp
      USING (due_date::timestamp + interval ''23 hours 59 minutes 59 seconds'')
    ';
  END IF;
END
$fcgs$;

COMMIT;
