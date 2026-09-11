import { DatabaseSync } from 'node:sqlite';

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, tools TEXT NOT NULL,
      created_at TEXT NOT NULL, tx_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
      mandate_id TEXT NOT NULL REFERENCES mandates(id), nonce INTEGER NOT NULL,
      cost TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL,
      receipt TEXT NOT NULL, signature TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','anchored')),
      root TEXT, tx_hash TEXT, block_number INTEGER,
      UNIQUE(mandate_id, nonce)
    );
    CREATE TABLE IF NOT EXISTS batches (
      root TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, previous_root TEXT NOT NULL,
      count INTEGER NOT NULL, total_cost TEXT NOT NULL, gas_used TEXT NOT NULL,
      tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, tool TEXT NOT NULL,
      decision TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      tx_hash TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipt_mandate_status ON receipts(mandate_id,status,nonce);
  `);
  return db;
}

export function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function receiptView(row) {
  if (!row) return null;
  return { id: row.id, requestId: row.request_id, mandateId: row.mandate_id, nonce: String(row.nonce), cost: row.cost, tool: row.tool,
    input: JSON.parse(row.input), output: JSON.parse(row.output), receipt: JSON.parse(row.receipt), signature: row.signature,
    createdAt: row.created_at, status: row.status, root: row.root, transactionHash: row.tx_hash, blockNumber: row.block_number };
}
