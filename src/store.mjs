import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const schema = `
  CREATE TABLE IF NOT EXISTS mandates (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, tools TEXT NOT NULL,
    created_at TEXT NOT NULL, tx_hash TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'local', state TEXT NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    mandate_id TEXT NOT NULL REFERENCES mandates(id), nonce INTEGER NOT NULL,
    cost TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL,
    receipt TEXT NOT NULL, signature TEXT NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','anchored')),
    root TEXT, tx_hash TEXT, block_number INTEGER,
    scope TEXT NOT NULL DEFAULT 'local', client_request_id TEXT,
    UNIQUE(mandate_id, nonce)
  );
  CREATE TABLE IF NOT EXISTS batches (
    root TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, previous_root TEXT NOT NULL,
    count INTEGER NOT NULL, total_cost TEXT NOT NULL, gas_used TEXT NOT NULL,
    tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'local'
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, tool TEXT NOT NULL,
    decision TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'local'
  );
  CREATE TABLE IF NOT EXISTS submissions (
    tx_hash TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL,
    mandate_id TEXT NOT NULL, expected_root TEXT, tx_hash TEXT, raw_transaction TEXT,
    state TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_counters (
    subject TEXT NOT NULL, day TEXT NOT NULL, category TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY(subject, day, category)
  );
  CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS receipt_mandate_status ON receipts(mandate_id,status,nonce);
  CREATE INDEX IF NOT EXISTS operation_state ON operations(state);
`;

const additions = {
  mandates: { scope: "TEXT NOT NULL DEFAULT 'local'", state: "TEXT NOT NULL DEFAULT 'active'" },
  receipts: { scope: "TEXT NOT NULL DEFAULT 'local'", client_request_id: 'TEXT' },
  batches: { scope: "TEXT NOT NULL DEFAULT 'local'" },
  attempts: { scope: "TEXT NOT NULL DEFAULT 'local'" },
};

// Kept synchronous for the local adapter and existing direct SQLite diagnostics.
export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  db.exec(schema);
  for (const [table, columns] of Object.entries(additions)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const [name, type] of Object.entries(columns)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS receipt_scope ON receipts(scope,created_at); CREATE INDEX IF NOT EXISTS mandate_scope ON mandates(scope,created_at); CREATE INDEX IF NOT EXISTS attempt_scope ON attempts(scope,created_at);');
  return db;
}

export function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function postgresOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // pg connection-string SSL parameters can override an explicit ssl object.
  // Always authenticate the server certificate for remote (including Neon) hosts.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true },
    max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000,
    application_name: 'prooflane' };
}

export function createStore({ filename, databaseUrl, poolOptions = {} }) {
  const context = new AsyncLocalStorage();
  if (!databaseUrl) {
    const db = openStore(filename);
    return { kind: 'sqlite', db, async initialize() {},
      async all(sql, ...params) { return db.prepare(sql).all(...params); },
      async get(sql, ...params) { return db.prepare(sql).get(...params); },
      async run(sql, ...params) { return db.prepare(sql).run(...params); },
      async atomic(fn) {
        if (context.getStore()) return fn();
        db.exec('BEGIN IMMEDIATE');
        try { const result = await context.run(true, fn); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      async withLock(_key, fn) { return fn(); },
      async close() { db.close(); },
    };
  }
  const pool = new pg.Pool({ ...postgresOptions(databaseUrl), ...poolOptions });
  // An idle connection failure must not become an unhandled EventEmitter error.
  pool.on('error', () => {});
  const query = (sql, params) => {
    let index = 0;
    return (context.getStore() || pool).query(sql.replace(/\?/g, () => `$${++index}`), params);
  };
  const store = { kind: 'postgres', db: null,
    async initialize() {
      await store.withLock('prooflane:schema:v2', async () => {
        await pool.query(schema);
        for (const [table, columns] of Object.entries(additions)) {
          for (const [name, type] of Object.entries(columns)) await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
        }
        await pool.query('CREATE INDEX IF NOT EXISTS receipt_scope ON receipts(scope,created_at); CREATE INDEX IF NOT EXISTS mandate_scope ON mandates(scope,created_at); CREATE INDEX IF NOT EXISTS attempt_scope ON attempts(scope,created_at);');
      });
    },
    async all(sql, ...params) { return (await query(sql, params)).rows; },
    async get(sql, ...params) { return (await query(sql, params)).rows[0]; },
    async run(sql, ...params) { const result = await query(sql, params); return { changes: result.rowCount }; },
    async atomic(fn) {
      if (context.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '15s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        // This transaction owns only the lock. Mutations use other connections:
        // operation intents must commit before broadcasting an Ethereum transaction.
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
  return store;
}

export function receiptView(row) {
  if (!row) return null;
  return { id: row.id, requestId: row.client_request_id ?? row.request_id, mandateId: row.mandate_id, nonce: String(row.nonce), cost: row.cost, tool: row.tool,
    input: JSON.parse(row.input), output: JSON.parse(row.output), receipt: JSON.parse(row.receipt), signature: row.signature,
    createdAt: row.created_at, status: row.status, root: row.root, transactionHash: row.tx_hash, blockNumber: row.block_number };
}
