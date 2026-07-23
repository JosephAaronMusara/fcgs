import pg from "pg";
import { RBAC_PERMISSIONS_DATA } from "../server/rbac-config";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Run through dotenv, for example:\n" +
      "  npx dotenv -e .env -- npx tsx script/repair-assets-inventory-additive.ts",
  );
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

const repairSql = String.raw`
BEGIN;

-- Prevent two upgrade processes from running against the same database.
SELECT pg_advisory_xact_lock(73426012);

-- People-record quick-photo support.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo text;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS photo text;

-- Organisation centres and organisation-level module settings.
CREATE TABLE IF NOT EXISTS asset_centres (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_type text NOT NULL DEFAULT 'school',
  name text NOT NULL,
  code text NOT NULL,
  address text,
  phone text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_centres_org_code_uq ON asset_centres (organization_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS asset_centres_school_uq ON asset_centres (school_id);
CREATE INDEX IF NOT EXISTS asset_centres_org_idx ON asset_centres (organization_id, is_active);

CREATE TABLE IF NOT EXISTS asset_inventory_settings (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  currency text NOT NULL DEFAULT 'USD',
  purchase_request_approval_threshold numeric(14,2) NOT NULL DEFAULT 100,
  purchase_order_hq_threshold numeric(14,2) NOT NULL DEFAULT 1000,
  low_stock_notifications_enabled boolean NOT NULL DEFAULT true,
  default_supplier_lead_time_days integer NOT NULL DEFAULT 7,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_inventory_settings_org_uq ON asset_inventory_settings (organization_id);

CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  registration_number text,
  tax_number text,
  goods_services text,
  payment_terms text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_suppliers_org_name_uq ON inventory_suppliers (organization_id, name);

-- Bootstrap the first-generation Assets & Inventory tables when this is the
-- module's first production deployment. CREATE TABLE IF NOT EXISTS keeps this
-- safe on databases where the initial module was already installed.
CREATE TABLE IF NOT EXISTS asset_inventory_categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  kind text NOT NULL,
  name text NOT NULL,
  code text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_inventory_categories_scope_name_uq
  ON asset_inventory_categories (organization_id, school_id, kind, name);
CREATE INDEX IF NOT EXISTS asset_inventory_categories_centre_idx
  ON asset_inventory_categories (centre_id, kind, name);

CREATE TABLE IF NOT EXISTS asset_inventory_locations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  name text NOT NULL,
  code text,
  location_type text NOT NULL DEFAULT 'general',
  description text,
  is_store boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_inventory_locations_school_name_uq
  ON asset_inventory_locations (school_id, name);
CREATE INDEX IF NOT EXISTS asset_inventory_locations_centre_idx
  ON asset_inventory_locations (centre_id, name);

CREATE TABLE IF NOT EXISTS asset_register (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  owning_centre_id integer REFERENCES asset_centres(id),
  current_centre_id integer REFERENCES asset_centres(id),
  asset_number text NOT NULL,
  asset_class text NOT NULL DEFAULT 'general',
  name text NOT NULL,
  category_id integer REFERENCES asset_inventory_categories(id),
  location_id integer REFERENCES asset_inventory_locations(id),
  supplier_id integer REFERENCES inventory_suppliers(id),
  serial_number text,
  description text,
  acquisition_date date,
  acquisition_cost numeric(14,2) NOT NULL DEFAULT 0,
  current_value numeric(14,2) NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'good',
  status text NOT NULL DEFAULT 'available',
  warranty_expiry date,
  supplier text,
  procurement_reference text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_register_school_number_uq
  ON asset_register (school_id, asset_number);
CREATE UNIQUE INDEX IF NOT EXISTS asset_register_centre_number_uq
  ON asset_register (current_centre_id, asset_number);
CREATE INDEX IF NOT EXISTS asset_register_school_idx ON asset_register (school_id);
CREATE INDEX IF NOT EXISTS asset_register_centre_idx ON asset_register (current_centre_id, status);

CREATE TABLE IF NOT EXISTS inventory_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  sku text NOT NULL,
  name text NOT NULL,
  item_type text NOT NULL DEFAULT 'consumable',
  category_id integer REFERENCES asset_inventory_categories(id),
  default_location_id integer REFERENCES asset_inventory_locations(id),
  preferred_supplier_id integer REFERENCES inventory_suppliers(id),
  unit_of_measure text NOT NULL DEFAULT 'unit',
  purchase_unit text,
  issue_unit text,
  unit_conversion_factor numeric(14,4) NOT NULL DEFAULT 1,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,
  reorder_enabled boolean NOT NULL DEFAULT true,
  reorder_level numeric(14,3) NOT NULL DEFAULT 0,
  critical_stock_level numeric(14,3) NOT NULL DEFAULT 0,
  target_stock_level numeric(14,3) NOT NULL DEFAULT 0,
  preferred_reorder_quantity numeric(14,3) NOT NULL DEFAULT 0,
  supplier_lead_time_days integer NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  batch_tracking_enabled boolean NOT NULL DEFAULT false,
  expiry_tracking_enabled boolean NOT NULL DEFAULT false,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_school_sku_uq
  ON inventory_items (school_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_centre_sku_uq
  ON inventory_items (centre_id, sku);
CREATE INDEX IF NOT EXISTS inventory_items_school_idx ON inventory_items (school_id);
CREATE INDEX IF NOT EXISTS inventory_items_centre_idx ON inventory_items (centre_id, is_active);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  movement_type text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  quantity_before numeric(14,3) NOT NULL,
  quantity_after numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  from_location_id integer REFERENCES asset_inventory_locations(id),
  to_location_id integer REFERENCES asset_inventory_locations(id),
  recipient_type text,
  recipient_id integer,
  reason text,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_school_reference_uq
  ON inventory_movements (school_id, reference_number);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx
  ON inventory_movements (item_id, created_at);

CREATE TABLE IF NOT EXISTS asset_assignments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  asset_id integer NOT NULL REFERENCES asset_register(id),
  assignee_type text NOT NULL,
  assignee_id integer,
  assignee_name text NOT NULL,
  assigned_at timestamp without time zone NOT NULL DEFAULT now(),
  expected_return_date date,
  returned_at timestamp without time zone,
  condition_out text NOT NULL DEFAULT 'good',
  condition_in text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by_user_id integer REFERENCES users(id),
  returned_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_assignments_school_reference_uq
  ON asset_assignments (school_id, reference_number);
CREATE INDEX IF NOT EXISTS asset_assignments_asset_status_idx
  ON asset_assignments (asset_id, status);

CREATE TABLE IF NOT EXISTS asset_maintenance_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  asset_id integer NOT NULL REFERENCES asset_register(id),
  issue_description text NOT NULL,
  service_provider text,
  status text NOT NULL DEFAULT 'reported',
  date_reported date NOT NULL,
  date_sent date,
  date_returned date,
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0,
  actual_cost numeric(14,2) NOT NULL DEFAULT 0,
  work_completed text,
  next_service_date date,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_damage_cases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  asset_id integer REFERENCES asset_register(id),
  inventory_item_id integer REFERENCES inventory_items(id),
  incident_date date NOT NULL,
  incident_type text NOT NULL DEFAULT 'breakage',
  location_id integer REFERENCES asset_inventory_locations(id),
  description text NOT NULL,
  classification text NOT NULL DEFAULT 'unconfirmed',
  responsible_party_type text,
  responsible_party_id integer,
  responsible_party_name text,
  findings text,
  status text NOT NULL DEFAULT 'reported',
  proposed_charge numeric(14,2) NOT NULL DEFAULT 0,
  approved_charge numeric(14,2) NOT NULL DEFAULT 0,
  amount_recovered numeric(14,2) NOT NULL DEFAULT 0,
  approval_notes text,
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamp without time zone,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_damage_cases_school_reference_uq
  ON asset_damage_cases (school_id, reference_number);

CREATE TABLE IF NOT EXISTS asset_damage_recoveries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  damage_case_id integer NOT NULL REFERENCES asset_damage_cases(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  receipt_number text,
  notes text,
  received_by_user_id integer REFERENCES users(id),
  received_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_stocktakes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  location_id integer REFERENCES asset_inventory_locations(id),
  status text NOT NULL DEFAULT 'draft',
  count_date date NOT NULL,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_stocktake_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stocktake_id integer NOT NULL REFERENCES inventory_stocktakes(id),
  item_id integer NOT NULL REFERENCES inventory_items(id),
  expected_quantity numeric(14,3) NOT NULL,
  counted_quantity numeric(14,3),
  variance_quantity numeric(14,3),
  notes text
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stocktake_lines_item_uq
  ON inventory_stocktake_lines (stocktake_id, item_id);

-- Existing Assets & Inventory records: additive centre-aware fields only.
ALTER TABLE asset_inventory_categories
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);
CREATE INDEX IF NOT EXISTS asset_inventory_categories_centre_idx
  ON asset_inventory_categories (centre_id, kind, name);

ALTER TABLE asset_inventory_locations ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_inventory_locations
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);
CREATE INDEX IF NOT EXISTS asset_inventory_locations_centre_idx
  ON asset_inventory_locations (centre_id, name);

ALTER TABLE asset_register ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_register
  ADD COLUMN IF NOT EXISTS owning_centre_id integer REFERENCES asset_centres(id),
  ADD COLUMN IF NOT EXISTS current_centre_id integer REFERENCES asset_centres(id),
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES inventory_suppliers(id),
  ADD COLUMN IF NOT EXISTS procurement_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS asset_register_centre_number_uq
  ON asset_register (current_centre_id, asset_number);
CREATE INDEX IF NOT EXISTS asset_register_centre_idx
  ON asset_register (current_centre_id, status);

CREATE TABLE IF NOT EXISTS asset_vehicle_details (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id integer NOT NULL REFERENCES asset_register(id),
  registration_number text,
  vin text,
  engine_number text,
  make text,
  model text,
  manufacture_year integer,
  colour text,
  fuel_type text,
  vehicle_class text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_vehicle_details_asset_uq ON asset_vehicle_details (asset_id);
CREATE INDEX IF NOT EXISTS asset_vehicle_details_registration_idx ON asset_vehicle_details (registration_number);

ALTER TABLE inventory_items ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id),
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'consumable',
  ADD COLUMN IF NOT EXISTS preferred_supplier_id integer REFERENCES inventory_suppliers(id),
  ADD COLUMN IF NOT EXISTS purchase_unit text,
  ADD COLUMN IF NOT EXISTS issue_unit text,
  ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reorder_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS critical_stock_level numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_stock_level numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_reorder_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_lead_time_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expiry_tracking_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_centre_sku_uq ON inventory_items (centre_id, sku);
CREATE INDEX IF NOT EXISTS inventory_items_centre_idx ON inventory_items (centre_id, is_active);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  centre_id integer REFERENCES asset_centres(id),
  location_id integer REFERENCES asset_inventory_locations(id),
  batch_number text NOT NULL,
  manufacture_date date,
  expiry_date date,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,
  supplier_id integer REFERENCES inventory_suppliers(id),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_batches_item_batch_uq
  ON inventory_batches (item_id, batch_number, location_id);
CREATE INDEX IF NOT EXISTS inventory_batches_expiry_idx ON inventory_batches (expiry_date);

ALTER TABLE inventory_movements ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id),
  ADD COLUMN IF NOT EXISTS batch_id integer REFERENCES inventory_batches(id),
  ADD COLUMN IF NOT EXISTS source_document_type text,
  ADD COLUMN IF NOT EXISTS source_document_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_centre_reference_uq
  ON inventory_movements (centre_id, reference_number);

CREATE TABLE IF NOT EXISTS inventory_returnable_issues (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer NOT NULL REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  quantity_issued numeric(14,3) NOT NULL,
  quantity_returned numeric(14,3) NOT NULL DEFAULT 0,
  recipient_type text NOT NULL,
  recipient_id integer,
  recipient_name text NOT NULL,
  issued_at timestamp without time zone NOT NULL DEFAULT now(),
  expected_return_date date,
  last_returned_at timestamp without time zone,
  status text NOT NULL DEFAULT 'issued',
  notes text,
  created_by_user_id integer REFERENCES users(id),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_returnable_issues_centre_reference_uq
  ON inventory_returnable_issues (centre_id, reference_number);
CREATE INDEX IF NOT EXISTS inventory_returnable_issues_item_status_idx
  ON inventory_returnable_issues (item_id, status);
CREATE INDEX IF NOT EXISTS inventory_returnable_issues_due_idx
  ON inventory_returnable_issues (expected_return_date, status);

ALTER TABLE asset_assignments ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_assignments
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);
CREATE UNIQUE INDEX IF NOT EXISTS asset_assignments_centre_reference_uq
  ON asset_assignments (centre_id, reference_number);

ALTER TABLE asset_maintenance_records ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_maintenance_records
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);

ALTER TABLE asset_damage_cases ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_damage_cases
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);
CREATE UNIQUE INDEX IF NOT EXISTS asset_damage_cases_centre_reference_uq
  ON asset_damage_cases (centre_id, reference_number);

ALTER TABLE asset_damage_recoveries ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE asset_damage_recoveries
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);

ALTER TABLE inventory_stocktakes ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE inventory_stocktakes
  ADD COLUMN IF NOT EXISTS centre_id integer REFERENCES asset_centres(id);

CREATE TABLE IF NOT EXISTS inventory_low_stock_alerts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer REFERENCES asset_centres(id),
  item_id integer NOT NULL REFERENCES inventory_items(id),
  status text NOT NULL DEFAULT 'open',
  severity text NOT NULL DEFAULT 'low',
  quantity_at_trigger numeric(14,3) NOT NULL,
  reorder_level numeric(14,3) NOT NULL,
  suggested_quantity numeric(14,3) NOT NULL DEFAULT 0,
  acknowledged_by_user_id integer REFERENCES users(id),
  acknowledged_at timestamp without time zone,
  resolved_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_low_stock_alert_item_status_uq
  ON inventory_low_stock_alerts (item_id, status);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alert_centre_idx
  ON inventory_low_stock_alerts (centre_id, status, severity);

-- Procurement and goods-receiving workflow.
CREATE TABLE IF NOT EXISTS inventory_purchase_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer NOT NULL REFERENCES asset_centres(id),
  reference_number text NOT NULL,
  department text,
  required_date date,
  justification text NOT NULL,
  urgency text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'draft',
  estimated_total numeric(14,2) NOT NULL DEFAULT 0,
  requested_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamp without time zone,
  approval_notes text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_purchase_requests_centre_ref_uq
  ON inventory_purchase_requests (centre_id, reference_number);

CREATE TABLE IF NOT EXISTS inventory_purchase_request_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id integer NOT NULL REFERENCES inventory_purchase_requests(id),
  item_id integer REFERENCES inventory_items(id),
  item_name text NOT NULL,
  item_type text NOT NULL DEFAULT 'consumable',
  quantity numeric(14,3) NOT NULL,
  unit_of_measure text NOT NULL DEFAULT 'unit',
  estimated_unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  preferred_supplier_id integer REFERENCES inventory_suppliers(id),
  notes text
);

CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer NOT NULL REFERENCES asset_centres(id),
  purchase_request_id integer REFERENCES inventory_purchase_requests(id),
  supplier_id integer NOT NULL REFERENCES inventory_suppliers(id),
  reference_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  expected_delivery_date date,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  terms text,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_purchase_orders_centre_ref_uq
  ON inventory_purchase_orders (centre_id, reference_number);

CREATE TABLE IF NOT EXISTS inventory_purchase_order_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id integer NOT NULL REFERENCES inventory_purchase_orders(id),
  request_line_id integer REFERENCES inventory_purchase_request_lines(id),
  item_id integer REFERENCES inventory_items(id),
  item_name text NOT NULL,
  item_type text NOT NULL DEFAULT 'consumable',
  ordered_quantity numeric(14,3) NOT NULL,
  received_quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit_of_measure text NOT NULL DEFAULT 'unit',
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS inventory_goods_receipts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer REFERENCES schools(id),
  centre_id integer NOT NULL REFERENCES asset_centres(id),
  purchase_order_id integer REFERENCES inventory_purchase_orders(id),
  supplier_id integer REFERENCES inventory_suppliers(id),
  reference_number text NOT NULL,
  delivery_note_number text,
  received_date date NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  inspection_notes text,
  received_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_goods_receipts_centre_ref_uq
  ON inventory_goods_receipts (centre_id, reference_number);

CREATE TABLE IF NOT EXISTS inventory_goods_receipt_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  goods_receipt_id integer NOT NULL REFERENCES inventory_goods_receipts(id),
  purchase_order_line_id integer REFERENCES inventory_purchase_order_lines(id),
  item_id integer REFERENCES inventory_items(id),
  item_name text NOT NULL,
  item_type text NOT NULL DEFAULT 'consumable',
  quantity_delivered numeric(14,3) NOT NULL,
  quantity_accepted numeric(14,3) NOT NULL,
  quantity_rejected numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  batch_number text,
  expiry_date date,
  rejection_reason text
);

-- Formal inter-centre movement workflow.
CREATE TABLE IF NOT EXISTS asset_centre_transfers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  reference_number text NOT NULL,
  source_centre_id integer NOT NULL REFERENCES asset_centres(id),
  destination_centre_id integer NOT NULL REFERENCES asset_centres(id),
  source_location_id integer REFERENCES asset_inventory_locations(id),
  destination_location_id integer REFERENCES asset_inventory_locations(id),
  status text NOT NULL DEFAULT 'draft',
  requested_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  dispatched_by_user_id integer REFERENCES users(id),
  received_by_user_id integer REFERENCES users(id),
  approved_at timestamp without time zone,
  dispatched_at timestamp without time zone,
  received_at timestamp without time zone,
  transport_details text,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_centre_transfers_org_ref_uq
  ON asset_centre_transfers (organization_id, reference_number);
CREATE INDEX IF NOT EXISTS asset_centre_transfers_status_idx
  ON asset_centre_transfers (organization_id, status);

CREATE TABLE IF NOT EXISTS asset_centre_transfer_lines (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id integer NOT NULL REFERENCES asset_centre_transfers(id),
  line_type text NOT NULL,
  asset_id integer REFERENCES asset_register(id),
  item_id integer REFERENCES inventory_items(id),
  destination_item_id integer REFERENCES inventory_items(id),
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  condition_dispatched text,
  condition_received text,
  quantity_received numeric(14,3),
  variance_notes text,
  status text NOT NULL DEFAULT 'pending'
);

-- Every organisation receives an HQ centre and settings row.
INSERT INTO asset_centres (organization_id, school_id, centre_type, name, code, address, phone, email)
SELECT organizations.id, NULL, 'hq', organizations.name || ' HQ', 'HQ', organizations.address, organizations.phone, organizations.email
FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO asset_inventory_settings (organization_id)
SELECT id FROM organizations
ON CONFLICT DO NOTHING;

-- Every school receives a stable centre without changing any academic school record.
INSERT INTO asset_centres (organization_id, school_id, centre_type, name, code, address, phone, email)
SELECT
  schools.organization_id,
  schools.id,
  'school',
  schools.name,
  COALESCE(NULLIF(UPPER(REGEXP_REPLACE(schools.short_code, '[^A-Za-z0-9]+', '-', 'g')), ''), 'SCH') || '-' || schools.id::text,
  schools.address,
  schools.phone,
  schools.email
FROM schools
WHERE schools.organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill all previously school-scoped records to their matching centre.
UPDATE asset_inventory_categories rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_inventory_locations rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_register rows
SET owning_centre_id = COALESCE(rows.owning_centre_id, centres.id),
    current_centre_id = COALESCE(rows.current_centre_id, centres.id)
FROM asset_centres centres
WHERE rows.school_id = centres.school_id
  AND (rows.owning_centre_id IS NULL OR rows.current_centre_id IS NULL);

UPDATE inventory_items rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE inventory_movements rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_assignments rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_maintenance_records rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_damage_cases rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

UPDATE asset_damage_recoveries rows
SET centre_id = cases.centre_id
FROM asset_damage_cases cases
WHERE rows.centre_id IS NULL AND rows.damage_case_id = cases.id;

UPDATE inventory_stocktakes rows
SET centre_id = centres.id
FROM asset_centres centres
WHERE rows.centre_id IS NULL AND rows.school_id = centres.school_id;

COMMIT;
`;

const requiredTables = [
  "asset_centres",
  "asset_inventory_settings",
  "inventory_suppliers",
  "asset_vehicle_details",
  "inventory_batches",
  "inventory_returnable_issues",
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
  ["users", "photo"],
  ["parents", "photo"],
  ["asset_register", "asset_class"],
  ["asset_register", "owning_centre_id"],
  ["asset_register", "current_centre_id"],
  ["inventory_items", "centre_id"],
  ["inventory_items", "item_type"],
  ["inventory_items", "reorder_enabled"],
  ["inventory_items", "target_stock_level"],
  ["inventory_movements", "centre_id"],
  ["asset_assignments", "centre_id"],
  ["asset_damage_cases", "centre_id"],
];

async function upsertPermissions() {
  for (const permission of RBAC_PERMISSIONS_DATA) {
    await client.query(
      `INSERT INTO permissions (code, name, description, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category`,
      [permission.code, permission.name, permission.description, permission.category],
    );
  }

  await client.query(
    `INSERT INTO access_groups (name, description, is_system_default)
     VALUES ('Assets & Inventory Officer',
       'Manages asset registers, stores, stock movements, procurement receipts, centre transfers, maintenance and damage reporting.',
       true)
     ON CONFLICT (name) DO NOTHING`,
  );
}

async function verifyRepair() {
  const tables = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [requiredTables],
  );
  const presentTables = new Set(tables.rows.map((row) => row.tablename));

  const columns = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  const presentColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));

  const centreCounts = await client.query<{
    hq_centres: string;
    school_centres: string;
    organizations: string;
    schools: string;
  }>(
    `SELECT
       (SELECT count(*) FROM asset_centres WHERE centre_type = 'hq')::text AS hq_centres,
       (SELECT count(*) FROM asset_centres WHERE centre_type = 'school')::text AS school_centres,
       (SELECT count(*) FROM organizations)::text AS organizations,
       (SELECT count(*) FROM schools WHERE organization_id IS NOT NULL)::text AS schools`,
  );

  const enumRows = await client.query<{ enumlabel: string }>(
    `SELECT enumlabel
     FROM pg_enum
     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = 'user_role'
     ORDER BY enumsortorder`,
  );

  const missingTables = requiredTables.filter((table) => !presentTables.has(table));
  const missingColumns = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((entry) => !presentColumns.has(entry));

  console.log("\nVerification");
  console.table([
    { check: "Required tables", result: missingTables.length ? `MISSING: ${missingTables.join(", ")}` : "OK" },
    { check: "Required columns", result: missingColumns.length ? `MISSING: ${missingColumns.join(", ")}` : "OK" },
    {
      check: "Organisation centres",
      result: `${centreCounts.rows[0]?.hq_centres ?? 0}/${centreCounts.rows[0]?.organizations ?? 0} HQ; ${centreCounts.rows[0]?.school_centres ?? 0}/${centreCounts.rows[0]?.schools ?? 0} schools`,
    },
    { check: "user_role enum", result: `UNCHANGED (${enumRows.rows.map((row) => row.enumlabel).join(", ")})` },
  ]);

  if (missingTables.length || missingColumns.length) {
    throw new Error("Additive repair finished but required database objects are still missing.");
  }
}

async function main() {
  await client.connect();
  const dbInfo = await client.query<{ database: string; server: string | null; port: number | null }>(
    "SELECT current_database() AS database, inet_server_addr()::text AS server, inet_server_port() AS port",
  );

  console.log("\nFCGS Assets & Inventory additive database repair");
  console.log(`Database: ${dbInfo.rows[0]?.database}`);
  console.log(`Server:   ${dbInfo.rows[0]?.server ?? "local socket"}:${dbInfo.rows[0]?.port ?? ""}`);
  console.log("Mode:     additive only (no DROP, DELETE, TRUNCATE or enum replacement)\n");

  await client.query(repairSql);
  await upsertPermissions();
  await verifyRepair();

  console.log("\nAssets & Inventory additive repair completed successfully.");
  console.log("Next: npm run assets-inventory:preflight");
}

main()
  .catch((error) => {
    console.error("\nAssets & Inventory additive repair failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
