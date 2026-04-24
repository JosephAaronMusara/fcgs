SELECT COUNT(*) AS total_classes,
       COUNT(school_id) AS classes_with_school_id
FROM classes;

SELECT id, class_name, school_id
FROM classes
ORDER BY id
LIMIT 20;

SELECT
  c.id,
  c.class_name,
  c.school_id,
  COUNT(DISTINCT s.school_id) AS student_school_count,
  MIN(s.school_id) AS inferred_school_id
FROM classes c
LEFT JOIN students s ON s.class_id = c.id
GROUP BY c.id, c.class_name, c.school_id
ORDER BY c.id
LIMIT 50;

UPDATE classes c
SET school_id = x.school_id
FROM (
  SELECT
    class_id,
    MIN(school_id) AS school_id
  FROM students
  WHERE class_id IS NOT NULL
    AND school_id IS NOT NULL
  GROUP BY class_id
  HAVING COUNT(DISTINCT school_id) = 1
) x
WHERE c.id = x.class_id
  AND c.school_id IS NULL;

SELECT COUNT(*) AS total_classes,
       COUNT(school_id) AS classes_with_school_id
FROM classes;
