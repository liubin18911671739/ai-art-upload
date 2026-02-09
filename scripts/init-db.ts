import { getDb } from '../lib/db'

const ORDER_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const

type OrderStatus = (typeof ORDER_STATUSES)[number]

function toSqlEnumValues(values: readonly OrderStatus[]) {
  return values.map((value) => `'${value}'`).join(', ')
}

async function initDb() {
  const db = getDb()
  const client = await db.connect()

  const orderStatusSql = toSqlEnumValues(ORDER_STATUSES)

  try {
    await client.query('BEGIN')

    await client.query(`
      DO $$
      BEGIN
        CREATE TYPE order_status AS ENUM (${orderStatusSql});
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        shopify_order_id TEXT UNIQUE NOT NULL,
        image_url TEXT NOT NULL,
        style TEXT NOT NULL,
        status order_status NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT orders_id_format_chk
          CHECK (id ~ '^ORD-[0-9]{8}-[A-Z0-9]{4}$')
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        runpod_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        output_image_url TEXT,
        output_video_url TEXT
      );
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS jobs_order_id_idx ON jobs(order_id);
    `)

    await client.query('COMMIT')
    process.stdout.write('Database initialization completed.\n')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await db.end()
  }
}

void initDb().catch((error) => {
  process.stderr.write(`Database initialization failed: ${String(error)}\n`)
  process.exitCode = 1
})
