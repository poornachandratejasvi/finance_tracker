import * as SQLite from "expo-sqlite";
import { Bank, Category, Label, Transaction } from "../types";

// Local mirror of the household's own data, so every screen can render
// something the instant it opens, offline or not, instead of a live network
// call being the only path to anything on screen. Deliberately mirrors the
// FULL transactions table (not just the last-fetched page) -- reasonable at
// this app's personal/household scale, and what makes the Transactions
// screen genuinely browsable/searchable offline, not just "last 30 items."
// If that scale assumption is ever wrong, this needs a rolling window later.

let dbInstance: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync("finance_tracker_offline.db");
    await dbInstance.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        client_uuid TEXT,
        bank_id INTEGER,
        bank_name TEXT,
        transaction_date TEXT,
        description TEXT,
        amount REAL,
        transaction_type TEXT,
        category TEXT,
        notes TEXT,
        is_confirmed INTEGER,
        is_manual INTEGER,
        source TEXT,
        is_pending_sync INTEGER DEFAULT 0,
        updated_at TEXT,
        json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_bank ON transactions (bank_id);

      CREATE TABLE IF NOT EXISTS banks (
        id INTEGER PRIMARY KEY,
        json TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        json TEXT
      );

      CREATE TABLE IF NOT EXISTS labels (
        id INTEGER PRIMARY KEY,
        json TEXT
      );

      CREATE TABLE IF NOT EXISTS response_cache (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_writes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_uuid TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        op TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }
  return dbInstance;
}

// ── Transactions ─────────────────────────────────────────────────────────

export async function upsertTransactions(items: Transaction[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const t of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO transactions
          (id, client_uuid, bank_id, bank_name, transaction_date, description, amount,
           transaction_type, category, notes, is_confirmed, is_manual, source,
           is_pending_sync, updated_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          String(t.id), t.client_uuid ?? null, t.bank_id, t.bank_name ?? null,
          t.transaction_date, t.description, t.amount, t.transaction_type,
          t.category ?? null, t.notes ?? null, t.is_confirmed ? 1 : 0,
          t.is_manual ? 1 : 0, t.source ?? null, t.updated_at,
          JSON.stringify(t),
        ]
      );
    }
  });
}

export async function insertPendingTransaction(localId: string, clientUuid: string, transaction: Transaction): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO transactions
      (id, client_uuid, bank_id, bank_name, transaction_date, description, amount,
       transaction_type, category, notes, is_confirmed, is_manual, source,
       is_pending_sync, updated_at, json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      localId, clientUuid, transaction.bank_id, transaction.bank_name ?? null,
      transaction.transaction_date, transaction.description, transaction.amount,
      transaction.transaction_type, transaction.category ?? null, transaction.notes ?? null,
      transaction.is_confirmed ? 1 : 0, 1, "manual", transaction.updated_at,
      JSON.stringify(transaction),
    ]
  );
}

export async function replacePendingTransaction(localId: string, serverTransaction: Transaction): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM transactions WHERE id = ?", [localId]);
  });
  await upsertTransactions([serverTransaction]);
}

export async function getCachedTransactions(limit = 500): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions ORDER BY transaction_date DESC LIMIT ?",
    [limit]
  );
  return rows.map((r) => JSON.parse(r.json));
}

export async function getLastTransactionSyncAt(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'transactions_updated_since'");
  return row?.value ?? null;
}

export async function setLastTransactionSyncAt(iso: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('transactions_updated_since', ?)", [iso]);
}

// ── Small reference lists (whole-list mirrors) ──────────────────────────

async function upsertList(table: "banks" | "categories" | "labels", items: Array<{ id: number }>): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(`INSERT OR REPLACE INTO ${table} (id, json) VALUES (?, ?)`, [item.id, JSON.stringify(item)]);
    }
  });
}

async function getList<T>(table: "banks" | "categories" | "labels"): Promise<T[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(`SELECT json FROM ${table}`);
  return rows.map((r) => JSON.parse(r.json));
}

export const upsertBanks = (items: Bank[]) => upsertList("banks", items);
export const getCachedBanks = () => getList<Bank>("banks");
export const upsertCategories = (items: Category[]) => upsertList("categories", items);
export const getCachedCategories = () => getList<Category>("categories");
export const upsertLabels = (items: Label[]) => upsertList("labels", items);
export const getCachedLabels = () => getList<Label>("labels");

// ── Tier-B: raw response snapshot cache (dashboard/analytics/etc.) ─────

export async function getCachedResponse<T>(key: string): Promise<{ data: T; fetchedAt: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string; fetched_at: string }>(
    "SELECT json, fetched_at FROM response_cache WHERE key = ?",
    [key]
  );
  if (!row) return null;
  return { data: JSON.parse(row.json), fetchedAt: row.fetched_at };
}

export async function setCachedResponse(key: string, data: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO response_cache (key, json, fetched_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

// ── Offline write queue ─────────────────────────────────────────────────

export interface PendingWrite {
  id: number;
  client_uuid: string;
  entity_type: string;
  op: string;
  payload_json: string;
  status: "pending" | "syncing" | "failed";
  retry_count: number;
}

export async function enqueuePendingWrite(clientUuid: string, entityType: string, op: string, payload: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO pending_writes (client_uuid, entity_type, op, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    [clientUuid, entityType, op, JSON.stringify(payload), new Date().toISOString()]
  );
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  const db = await getDb();
  return db.getAllAsync<PendingWrite>("SELECT * FROM pending_writes WHERE status = 'pending' ORDER BY created_at ASC");
}

export async function getPendingWriteCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) as n FROM pending_writes WHERE status = 'pending'");
  return row?.n ?? 0;
}

export async function markPendingWriteDone(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM pending_writes WHERE id = ?", [id]);
}

export async function markPendingWriteRetried(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE pending_writes SET retry_count = retry_count + 1, status = 'pending' WHERE id = ?", [id]);
}

export async function markPendingWriteFailed(id: number, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE pending_writes SET status = 'failed', last_error = ? WHERE id = ?", [error, id]);
}
