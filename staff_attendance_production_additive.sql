BEGIN;

-- 1) School geofence radius
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS school_radius_meters integer;

UPDATE schools
SET school_radius_meters = 100
WHERE school_radius_meters IS NULL;

ALTER TABLE schools
  ALTER COLUMN school_radius_meters SET DEFAULT 100;

-- 2) Staff attendance metadata
ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS auto_clocked_out boolean;

UPDATE staff_attendance_logs
SET auto_clocked_out = false
WHERE auto_clocked_out IS NULL;

ALTER TABLE staff_attendance_logs
  ALTER COLUMN auto_clocked_out SET DEFAULT false;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS clock_in_accuracy integer;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS clock_out_accuracy integer;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS device_signature text;

-- 3) Persistent blocking reason prompt fields
ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS reason_required boolean;

UPDATE staff_attendance_logs
SET reason_required = false
WHERE reason_required IS NULL;

ALTER TABLE staff_attendance_logs
  ALTER COLUMN reason_required SET DEFAULT false;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS reason_type text;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS reason_submitted_at timestamp;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS late_reason text;

ALTER TABLE staff_attendance_logs
  ADD COLUMN IF NOT EXISTS early_clock_out_reason text;

COMMIT;

-- 4) Permission for Reset Device ID button / action
INSERT INTO permissions (code, name, description, category)
SELECT 'staff_attendance.reset_device_id',
       'Reset Staff Attendance Device ID',
       'Reset a staff member''s attendance device binding',
       'Staff Attendance'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE code = 'staff_attendance.reset_device_id'
);
