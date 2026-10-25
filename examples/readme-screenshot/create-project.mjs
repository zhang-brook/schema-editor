import { mkdir, writeFile, rm } from 'node:fs/promises'
import path, { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

function parseArgs(argv) {
  let out = path.join(repoRoot, '.fixtures', 'readme-screenshot', 'project')
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') {
      const value = argv[i + 1]
      if (!value) throw new Error('--out needs a value')
      out = resolve(value)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node examples/readme-screenshot/create-project.mjs [--out <dir>]')
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return out
}

const root = parseArgs(process.argv.slice(2))

const field = (name, unified_type, extra = {}) => ({ field_name: name, unified_type, ...extra })

const idField = field('id', 'BigInt', { not_null: true, primary_key: true, comment: 'Primary key' })

function fkField(name, comment) {
  return field(name, 'BigInt', { not_null: true, comment })
}

const timestamps = [
  field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Created at' }),
  field('updated_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', on_update_current_timestamp: true, comment: 'Updated at' }),
]

const tables = {
  customers: {
    name: 'customers',
    comment: 'Storefront accounts',
    fields: [
      idField,
      field('email', 'String', { field_length: 255, not_null: true, comment: 'Login email, unique per account' }),
      field('full_name', 'String', { field_length: 120, not_null: true, comment: 'Display name' }),
      field('phone', 'String', { field_length: 32, comment: 'E.164 contact number' }),
      field('locale', 'String', { field_length: 10, not_null: true, default: 'en-US', comment: 'Preferred UI locale' }),
      field('marketing_opt_in', 'Boolean', { not_null: true, default: false, comment: 'Marketing email consent' }),
      field('lifetime_value', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, default: 0, comment: 'Total net revenue' }),
      field('last_order_at', 'DateTime', { comment: 'Most recent checkout' }),
      ...timestamps,
    ],
    indexes: [
      { type: 'unique', name: 'uk_customers_email', columns: [{ name: 'email' }], comment: 'Unique login identity' },
      { type: 'index', name: 'idx_customers_created_at', columns: [{ name: 'created_at', sort_order: 'DESC' }], comment: 'Newest signups' },
    ],
  },
  addresses: {
    name: 'addresses',
    comment: 'Shipping addresses',
    fields: [
      idField,
      fkField('customer_id', 'Owning customer'),
      field('line1', 'String', { field_length: 160, not_null: true, comment: 'Street address' }),
      field('line2', 'String', { field_length: 160, comment: 'Apartment, suite, unit' }),
      field('city', 'String', { field_length: 80, not_null: true, comment: 'City' }),
      field('region', 'String', { field_length: 80, comment: 'State or province' }),
      field('postal_code', 'String', { field_length: 20, not_null: true, comment: 'Postal code' }),
      field('country_code', 'String', { field_length: 2, not_null: true, comment: 'ISO 3166-1 alpha-2' }),
      field('is_default', 'Boolean', { not_null: true, default: false, comment: 'Default shipping address' }),
      field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Created at' }),
    ],
    indexes: [
      { type: 'index', name: 'idx_addresses_customer', columns: [{ name: 'customer_id' }], comment: 'Addresses by customer' },
    ],
  },
  products: {
    name: 'products',
    comment: 'Catalog items',
    fields: [
      idField,
      field('sku', 'String', { field_length: 64, not_null: true, comment: 'Stock keeping unit' }),
      field('name', 'String', { field_length: 160, not_null: true, comment: 'Product name' }),
      field('slug', 'String', { field_length: 160, not_null: true, comment: 'URL slug' }),
      field('description', 'Text', { comment: 'Long description' }),
      field('price', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, comment: 'List price' }),
      field('currency', 'String', { field_length: 3, not_null: true, default: 'USD', comment: 'ISO 4217 currency code' }),
      field('stock_quantity', 'Integer', { not_null: true, default: 0, comment: 'Units on hand' }),
      field('status', 'String', { field_length: 20, not_null: true, default: 'draft', comment: 'Catalog state' }),
      ...timestamps,
    ],
    indexes: [
      { type: 'unique', name: 'uk_products_sku', columns: [{ name: 'sku' }], comment: 'Unique SKU' },
      { type: 'index', name: 'idx_products_status_created', columns: [{ name: 'status' }, { name: 'created_at', sort_order: 'DESC' }], comment: 'Catalog listing' },
    ],
  },
  orders: {
    name: 'orders',
    comment: 'Checkout orders',
    fields: [
      idField,
      field('order_no', 'String', { field_length: 32, not_null: true, comment: 'Public order number' }),
      fkField('customer_id', 'Customer reference'),
      field('status', 'String', { field_length: 20, not_null: true, default: 'pending', comment: 'Lifecycle state' }),
      field('payment_status', 'String', { field_length: 20, not_null: true, default: 'unpaid', comment: 'Payment state' }),
      field('currency', 'String', { field_length: 3, not_null: true, default: 'USD', comment: 'ISO 4217 currency code' }),
      field('subtotal', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, default: 0, comment: 'Line item subtotal' }),
      field('discount_total', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, default: 0, comment: 'Discounts applied' }),
      field('shipping_fee', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, default: 0, comment: 'Shipping charged' }),
      field('tax_total', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, default: 0, comment: 'Sales tax' }),
      field('grand_total', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, comment: 'Amount due' }),
      field('placed_at', 'DateTime', { not_null: true, comment: 'Checkout time' }),
      field('paid_at', 'DateTime', { comment: 'Capture time' }),
      ...timestamps,
    ],
    indexes: [
      { type: 'unique', name: 'uk_orders_order_no', columns: [{ name: 'order_no' }], comment: 'Public order number' },
      { type: 'index', name: 'idx_orders_customer_placed', columns: [{ name: 'customer_id' }, { name: 'placed_at', sort_order: 'DESC' }], comment: 'Customer order history' },
      { type: 'index', name: 'idx_orders_status_placed', columns: [{ name: 'status' }, { name: 'placed_at', sort_order: 'DESC' }], comment: 'Fulfilment queue' },
    ],
  },
  order_items: {
    name: 'order_items',
    comment: 'Checkout line items',
    fields: [
      idField,
      fkField('order_id', 'Parent order'),
      fkField('product_id', 'Purchased product'),
      field('sku', 'String', { field_length: 64, not_null: true, comment: 'SKU snapshot' }),
      field('quantity', 'Integer', { not_null: true, default: 1, comment: 'Units purchased' }),
      field('unit_price', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, comment: 'Price per unit' }),
      field('discount_amount', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, default: 0, comment: 'Line discount' }),
      field('line_total', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, comment: 'Net line amount' }),
      field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Created at' }),
    ],
    indexes: [
      { type: 'index', name: 'idx_order_items_order', columns: [{ name: 'order_id' }], comment: 'Items by order' },
      { type: 'index', name: 'idx_order_items_product', columns: [{ name: 'product_id' }], comment: 'Items by product' },
    ],
  },
  payments: {
    name: 'payments',
    comment: 'Payment attempts',
    fields: [
      idField,
      fkField('order_id', 'Parent order'),
      field('provider', 'String', { field_length: 32, not_null: true, comment: 'Payment provider' }),
      field('provider_ref', 'String', { field_length: 120, not_null: true, comment: 'Provider transaction id' }),
      field('amount', 'Decimal', { field_length: 12, field_scale: 2, not_null: true, comment: 'Captured amount' }),
      field('currency', 'String', { field_length: 3, not_null: true, comment: 'ISO 4217 currency code' }),
      field('status', 'String', { field_length: 20, not_null: true, default: 'pending', comment: 'Provider state' }),
      field('captured_at', 'DateTime', { comment: 'Capture time' }),
      field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Created at' }),
    ],
    indexes: [
      { type: 'unique', name: 'uk_payments_provider_ref', columns: [{ name: 'provider' }, { name: 'provider_ref' }], comment: 'Idempotency key' },
      { type: 'index', name: 'idx_payments_order', columns: [{ name: 'order_id' }], comment: 'Payments by order' },
    ],
  },
  coupons: {
    name: 'coupons',
    comment: 'Promotion codes',
    fields: [
      idField,
      field('code', 'String', { field_length: 40, not_null: true, comment: 'Customer-facing code' }),
      field('kind', 'String', { field_length: 20, not_null: true, default: 'percent', comment: 'Discount kind' }),
      field('value', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, comment: 'Percent or fixed amount' }),
      field('min_subtotal', 'Decimal', { field_length: 10, field_scale: 2, not_null: true, default: 0, comment: 'Minimum basket' }),
      field('stackable', 'Boolean', { not_null: true, default: false, comment: 'Can combine with other codes' }),
      field('starts_at', 'DateTime', { not_null: true, comment: 'Valid from' }),
      field('ends_at', 'DateTime', { comment: 'Valid until' }),
      field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Created at' }),
    ],
    indexes: [
      { type: 'unique', name: 'uk_coupons_code', columns: [{ name: 'code' }], comment: 'Unique code' },
    ],
  },
}

const analyticsTables = {
  events: {
    name: 'events',
    comment: 'Interaction events',
    fields: [
      idField,
      field('event_name', 'String', { field_length: 80, not_null: true, comment: 'Event identifier' }),
      field('session_id', 'String', { field_length: 64, not_null: true, comment: 'Anonymous session' }),
      fkField('customer_id', 'Customer when signed in'),
      field('properties', 'JSON', { comment: 'Event payload' }),
      field('occurred_at', 'DateTime', { not_null: true, comment: 'Client timestamp' }),
      field('created_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', comment: 'Ingested at' }),
    ],
    indexes: [
      { type: 'index', name: 'idx_events_name_occurred', columns: [{ name: 'event_name' }, { name: 'occurred_at', sort_order: 'DESC' }], comment: 'Event timeline' },
      { type: 'index', name: 'idx_events_session', columns: [{ name: 'session_id' }], comment: 'Session replay' },
    ],
  },
  daily_revenue: {
    name: 'daily_revenue',
    comment: 'Revenue rollups',
    fields: [
      field('day', 'Date', { not_null: true, primary_key: true, comment: 'Reporting day' }),
      field('gross_revenue', 'Decimal', { field_length: 14, field_scale: 2, not_null: true, default: 0, comment: 'Gross revenue' }),
      field('net_revenue', 'Decimal', { field_length: 14, field_scale: 2, not_null: true, default: 0, comment: 'Net revenue' }),
      field('refunds', 'Decimal', { field_length: 14, field_scale: 2, not_null: true, default: 0, comment: 'Refunded amount' }),
      field('orders_count', 'Integer', { not_null: true, default: 0, comment: 'Orders placed' }),
      field('updated_at', 'DateTime', { not_null: true, default: 'CURRENT_TIMESTAMP', on_update_current_timestamp: true, comment: 'Last aggregation' }),
    ],
    indexes: [],
  },
}

const initialData = {
  'commerce/products': {
    insert_mode: 'ignore',
    rows: [
      { data: { id: '1', sku: 'NS-TEE-001', name: 'Northstar Heavyweight Tee', slug: 'northstar-heavyweight-tee', description: '240 gsm organic cotton tee.', price: '38.00', currency: 'USD', stock_quantity: '128', status: 'active' }, row_comment: 'Core apparel' },
      { data: { id: '2', sku: 'NS-HOOD-002', name: 'Northstar Field Hoodie', slug: 'northstar-field-hoodie', description: 'Brushed fleece hoodie.', price: '96.00', currency: 'USD', stock_quantity: '64', status: 'active' }, row_comment: 'Core apparel' },
      { data: { id: '3', sku: 'NS-MUG-003', name: 'Enamel Camp Mug', slug: 'enamel-camp-mug', description: '12 oz enamel mug.', price: '22.00', currency: 'USD', stock_quantity: '240', status: 'active' } },
      { data: { id: '4', sku: 'NS-CAP-004', name: 'Trail Cap', slug: 'trail-cap', description: 'Water-resistant six-panel cap.', price: '34.00', currency: 'USD', stock_quantity: '0', status: 'draft' } },
    ],
  },
  'commerce/coupons': {
    insert_mode: 'ignore',
    rows: [
      { data: { id: '1', code: 'WELCOME10', kind: 'percent', value: '10.00', min_subtotal: '50.00', stackable: 'false', starts_at: '2026-01-01 00:00:00', ends_at: '2026-12-31 23:59:59' } },
      { data: { id: '2', code: 'FREESHIP', kind: 'fixed', value: '8.00', min_subtotal: '40.00', stackable: 'false', starts_at: '2026-03-01 00:00:00' } },
    ],
  },
  'commerce/orders': {
    insert_mode: 'ignore',
    rows: [
      { data: { id: '1001', order_no: 'NS-2026-004182', customer_id: '42', status: 'fulfilled', payment_status: 'paid', currency: 'USD', subtotal: '134.00', discount_total: '13.40', shipping_fee: '0.00', tax_total: '10.85', grand_total: '131.45', placed_at: '2026-10-21 14:32:08', paid_at: '2026-10-21 14:32:41' } },
      { data: { id: '1002', order_no: 'NS-2026-004183', customer_id: '57', status: 'paid', payment_status: 'paid', currency: 'USD', subtotal: '96.00', discount_total: '0.00', shipping_fee: '8.00', tax_total: '9.36', grand_total: '113.36', placed_at: '2026-10-22 09:05:17', paid_at: '2026-10-22 09:05:59' } },
      { data: { id: '1003', order_no: 'NS-2026-004184', customer_id: '42', status: 'pending', payment_status: 'unpaid', currency: 'USD', subtotal: '22.00', discount_total: '0.00', shipping_fee: '8.00', tax_total: '2.70', grand_total: '32.70', placed_at: '2026-10-23 18:44:02' }, row_comment: 'Awaiting capture' },
    ],
  },
  'analytics/daily_revenue': {
    insert_mode: 'overwrite',
    rows: [
      { data: { day: '2026-10-20', gross_revenue: '18420.00', net_revenue: '16208.40', refunds: '310.00', orders_count: '184' } },
      { data: { day: '2026-10-21', gross_revenue: '20115.50', net_revenue: '17742.65', refunds: '184.00', orders_count: '197' } },
      { data: { day: '2026-10-22', gross_revenue: '19360.00', net_revenue: '17088.10', refunds: '0.00', orders_count: '171' } },
    ],
  },
}

const common = {
  struct_version: '1.0',
  project_name: 'Northstar Commerce',
  project_description: 'Operational schema for the Northstar storefront, payments, and analytics warehouse.',
  enabled_dialects: ['mysql', 'postgresql'],
  default_config: {
    table_ddl_mode: 'create',
    mysql: {
      database: {},
      table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_0900_ai_ci' },
    },
    postgresql: { quote_identifiers: true },
    sqlite: { quote_identifiers: true },
  },
  common_used_fields: {},
  type_case: 'keep',
  generate_ai_guide: false,
  initial_data_insert_mode: 'insert',
}

async function main() {
  await rm(root, { recursive: true, force: true })
  await mkdir(`${root}/current/schemas`, { recursive: true })
  const write = (relative, value) => writeFile(path.join(root, relative), `${JSON.stringify(value, null, 4)}\n`, 'utf8')

  await write('common.json', common)
  await write('current/database.json', { schema_order: ['commerce', 'analytics'] })

  const bySchema = { commerce: tables, analytics: analyticsTables }
  for (const [schemaName, schemaTables] of Object.entries(bySchema)) {
    const names = Object.keys(schemaTables)
    const dir = `current/schemas/${schemaName}`
    await mkdir(path.join(root, dir), { recursive: true })
    await write(`${dir}/schema.json`, { schema: schemaName, table_order: names })
    for (const name of names) {
      const table = schemaTables[name]
      await mkdir(path.join(root, `${dir}/${name}`), { recursive: true })
      await write(`${dir}/${name}/table.json`, table)
      const initial = initialData[`${schemaName}/${name}`]
      if (initial) await write(`${dir}/${name}/initial-data.json`, initial)
    }
  }
  console.log(`created ${root}`)
}

await main()
