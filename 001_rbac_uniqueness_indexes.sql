-- Clean duplicate RBAC mappings before adding unique indexes
DELETE FROM access_group_permissions a
USING access_group_permissions b
WHERE a.id > b.id
  AND a.access_group_id = b.access_group_id
  AND a.permission_id = b.permission_id;

DELETE FROM user_access_groups a
USING user_access_groups b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.access_group_id = b.access_group_id;

DELETE FROM user_permission_overrides a
USING user_permission_overrides b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.permission_id = b.permission_id;

CREATE UNIQUE INDEX IF NOT EXISTS access_group_permissions_group_permission_uidx
  ON access_group_permissions (access_group_id, permission_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_access_groups_user_group_uidx
  ON user_access_groups (user_id, access_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_user_permission_uidx
  ON user_permission_overrides (user_id, permission_id);
