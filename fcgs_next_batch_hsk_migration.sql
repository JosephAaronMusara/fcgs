DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subject_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'subject_type' AND e.enumlabel = 'HSK'
     ) THEN
    ALTER TYPE subject_type ADD VALUE 'HSK';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grade_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'grade_type' AND e.enumlabel = 'HSK'
     ) THEN
    ALTER TYPE grade_type ADD VALUE 'HSK';
  END IF;
END $$;
