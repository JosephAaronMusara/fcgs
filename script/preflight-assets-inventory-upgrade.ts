import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { RBAC_PERMISSIONS_DATA } from "../server/rbac-config";

const requiredTables = [
  "asset_centres",
  "asset_inventory_settings",
  "asset_inventory_categories",
  "asset_inventory_locations",
  "inventory_suppliers",
  "asset_register",
  "asset_vehicle_details",
  "inventory_items",
  "inventory_batches",
  "inventory_movements",
  "inventory_returnable_issues",
  "asset_assignments",
  "asset_maintenance_records",
  "asset_damage_cases",
  "asset_damage_recoveries",
  "inventory_stocktakes",
  "inventory_stocktake_lines",
  "inventory_low_stock_alerts",
  "inventory_purchase_requests",
  "inventory_purchase_request_lines",
  "inventory_purchase_orders",
  "inventory_purchase_order_lines",
  "inventory_goods_receipts",
  "inventory_goods_receipt_lines",
  "asset_centre_transfers",
  "asset_centre_transfer_lines",
];

const requiredColumns: Array<[string, string]> = [
  ["parents", "photo"],
  ["users", "photo"],
  ["asset_register", "asset_class"],
  ["asset_register", "owning_centre_id"],
  ["asset_register", "current_centre_id"],
  ["inventory_items", "centre_id"],
  ["inventory_items", "item_type"],
  ["inventory_items", "reorder_enabled"],
  ["inventory_items", "target_stock_level"],
  ["inventory_purchase_orders", "purchase_request_id"],
  ["asset_centre_transfers", "source_centre_id"],
  ["asset_centre_transfers", "destination_centre_id"],
];

const requiredPermissionPrefixes = ["assets.", "inventory.", "damage."];
const explicitPermissions = [
  "students.manage_photo",
  "staff.manage_photo",
  "parents.manage_photo",
  "users.manage_photo",
  "transport.organization.view",
  "transport.organization.reports",
  "transport.organization.export",
  "transport.organization.manage",
];
const requiredPermissions = Array.from(new Set([
  ...RBAC_PERMISSIONS_DATA.filter((permission) => requiredPermissionPrefixes.some((prefix) => permission.code.startsWith(prefix))).map((permission) => permission.code),
  ...explicitPermissions,
]));

async function count(query: ReturnType<typeof sql>) {
  const result = await db.execute(query);
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count || 0);
}

async function main() {
  const tableRows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const presentTables = new Set((tableRows.rows as Array<{ tablename: string }>).map((row) => row.tablename));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));

  const columnRows = await db.execute(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  const presentColumns = new Set((columnRows.rows as Array<{ table_name: string; column_name: string }>).map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = requiredColumns
    .filter(([table, column]) => !presentColumns.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);

  const permissionRows = await db.execute(sql`select code from permissions`);
  const presentPermissions = new Set((permissionRows.rows as Array<{ code: string }>).map((row) => row.code));
  const missingPermissions = requiredPermissions.filter((permission) => !presentPermissions.has(permission));

  const checks = {
    negativeStockRows: presentTables.has("inventory_items")
      ? await count(sql`select count(*) from inventory_items where quantity_on_hand < 0`)
      : 0,
    invalidReturnableRows: presentTables.has("inventory_returnable_issues")
      ? await count(sql`select count(*) from inventory_returnable_issues where quantity_returned < 0 or quantity_returned > quantity_issued`)
      : 0,
    duplicateFleetReadyVehicleDetails: presentTables.has("asset_vehicle_details")
      ? await count(sql`select count(*) from (select asset_id from asset_vehicle_details group by asset_id having count(*) > 1) duplicates`)
      : 0,
    vehicleDetailsOnNonVehicleAssets: presentTables.has("asset_vehicle_details") && presentTables.has("asset_register") && presentColumns.has("asset_register.asset_class")
      ? await count(sql`
          select count(*)
          from asset_vehicle_details details
          join asset_register assets on assets.id = details.asset_id
          where assets.asset_class <> 'vehicle'
        `)
      : 0,
    organizationsWithoutHqAssetCentre: presentTables.has("asset_centres")
      ? await count(sql`
          select count(*)
          from organizations organizations
          where not exists (
            select 1 from asset_centres centres
            where centres.organization_id = organizations.id
              and centres.centre_type = 'hq'
              and centres.is_active = true
          )
        `)
      : 0,
    organizationsWithoutInventorySettings: presentTables.has("asset_inventory_settings")
      ? await count(sql`
          select count(*)
          from organizations organizations
          where not exists (
            select 1 from asset_inventory_settings settings
            where settings.organization_id = organizations.id
          )
        `)
      : 0,
    missingAssetsOfficerGroup: presentTables.has("access_groups")
      ? await count(sql`select case when exists (select 1 from access_groups where name = 'Assets & Inventory Officer') then 0 else 1 end as count`)
      : 0,
  };

  const blockingCheckNames = Object.entries(checks)
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
    status: missingTables.length || missingColumns.length || missingPermissions.length || blockingCheckNames.length ? "BLOCKED" : "READY",
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "READY") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
