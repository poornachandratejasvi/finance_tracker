import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import {
  listTransactions, createTransaction, updateTransaction, deleteTransaction,
  CreateTransactionPayload, UpdateTransactionPayload,
} from "../api/transactions";
import { listBanks, getExternalBank } from "../api/banks";
import { listCategories } from "../api/categories";
import { listLabels } from "../api/labels";
import { Transaction } from "../types";
import {
  upsertTransactions, upsertBanks, upsertCategories, upsertLabels,
  getLastTransactionSyncAt, setLastTransactionSyncAt,
  getCachedBanks,
  insertPendingTransaction, replacePendingTransaction, applyPendingTransactionUpdate, deleteCachedTransaction,
  enqueuePendingWrite, getPendingWrites, markPendingWriteDone,
  markPendingWriteRetried, markPendingWriteFailed,
} from "./db";

let isFlushing = false;

// Queue a transaction created while offline (or whose request failed with no
// server response at all -- a genuine network failure, not a validation
// rejection). Never queues something the server already told us is invalid.
// `clientUuid` can be supplied by a caller that already minted one (e.g. the
// native-intent drain below) so re-running the drain after a crash can't
// double-submit -- the server dedupes on client_uuid either way.
export async function queueOfflineTransaction(
  payload: CreateTransactionPayload,
  clientUuid: string = Crypto.randomUUID()
): Promise<Transaction> {
  const localId = `local-${clientUuid}`;
  const now = new Date().toISOString();
  const shadow: Transaction = {
    id: localId,
    user_id: 0,
    bank_id: payload.bank_id,
    bank_name: null,
    bank_type: null,
    currency_code: null,
    transaction_date: payload.transaction_date,
    description: payload.description,
    amount: payload.amount,
    transaction_type: payload.transaction_type,
    category: payload.category ?? null,
    notes: payload.notes ?? null,
    from_account: null,
    to_account: null,
    is_duplicate: false,
    is_manual: true,
    is_confirmed: false,
    source: "manual",
    client_uuid: clientUuid,
    is_pending_sync: true,
    labels: [],
    created_at: now,
    updated_at: now,
  };
  await insertPendingTransaction(localId, clientUuid, shadow);
  await enqueuePendingWrite(clientUuid, "transaction", "create", { ...payload, client_uuid: clientUuid });
  return shadow;
}

// Queue an edit made while offline (or whose request failed with no server
// response). Only ever called for an already-synced transaction (numeric id)
// -- a not-yet-synced local-<uuid> row has no server row to edit yet, so
// EditTransactionScreen blocks editing until that create has flushed.
export async function queueOfflineUpdate(id: number, payload: UpdateTransactionPayload): Promise<void> {
  await applyPendingTransactionUpdate(id, payload);
  await enqueuePendingWrite(Crypto.randomUUID(), "transaction", "update", { id, ...payload });
}

// Queue a delete made while offline. Removes the local row immediately (the
// confirm dialog already told the user "This can't be undone") and lets the
// queued write make it permanent server-side once reconnected.
export async function queueOfflineDelete(id: number): Promise<void> {
  await deleteCachedTransaction(id);
  await enqueuePendingWrite(Crypto.randomUUID(), "transaction", "delete", { id });
}

async function flushPendingWrites(): Promise<void> {
  const writes = await getPendingWrites();
  for (const write of writes) {
    if (write.entity_type !== "transaction") continue;
    try {
      if (write.op === "create") {
        const payload: CreateTransactionPayload = JSON.parse(write.payload_json);
        const localId = `local-${write.client_uuid}`;
        const created = await createTransaction(payload);
        await replacePendingTransaction(localId, created);
      } else if (write.op === "update") {
        const { id, ...payload } = JSON.parse(write.payload_json);
        const updated = await updateTransaction(id, payload);
        await upsertTransactions([updated]);
      } else if (write.op === "delete") {
        const { id } = JSON.parse(write.payload_json);
        await deleteTransaction(id);
      } else {
        continue;
      }
      await markPendingWriteDone(write.id);
    } catch (err: any) {
      if (write.op === "delete" && err?.response?.status === 404) {
        // Already gone server-side -- the delete already achieved its goal.
        await markPendingWriteDone(write.id);
      } else if (err?.response) {
        // The server responded (even with an error) -- this request is
        // resolved, just not successfully. Retrying it won't help.
        await markPendingWriteFailed(write.id, String(err.response.status));
      } else {
        // No response at all -- still offline/transient. Leave it queued;
        // the next reconnect/foreground trigger will retry it.
        await markPendingWriteRetried(write.id);
      }
    }
  }
}

async function pullTransactions(): Promise<void> {
  const since = await getLastTransactionSyncAt();
  const startedAt = new Date().toISOString();
  let skip = 0;
  const limit = 200;
  // First-ever sync on a device has no `since` -- a full pull, acceptable at
  // this app's personal/household data scale (see mobile/src/offline/db.ts).
  for (;;) {
    const page = await listTransactions({ skip, limit, updated_since: since ?? undefined });
    await upsertTransactions(page.items);
    if (page.items.length < limit) break;
    skip += limit;
  }
  await setLastTransactionSyncAt(startedAt);
}

async function pullReferenceLists(): Promise<void> {
  const [banks, categories, labels] = await Promise.all([
    listBanks().catch(() => []),
    listCategories().catch(() => []),
    listLabels().catch(() => []),
  ]);
  await Promise.all([upsertBanks(banks), upsertCategories(categories), upsertLabels(labels)]);
}

const NATIVE_INTENT_QUEUE_FILE = `${FileSystem.documentDirectory}pending_intent_transactions.json`;

interface NativeIntentEntry {
  client_uuid: string;
  amount: number;
  description: string;
  type: string; // Swift sends the enum's raw value: "expense" | "income"
  category?: string;
  account_hint?: string;
  transaction_date: string;
  notes?: string;
}

// The iOS "Add Transaction" App Intent (Shortcuts/Siri/Automation) runs in this
// same app process, but can't reach this queue directly from Swift -- it writes
// failed submissions to a shared JSON file instead (see
// mobile/ios-native/AddTransactionIntent.swift: PendingIntentQueue). This
// promotes anything found there into the normal offline queue so it gets the
// exact same retry/dedup handling as an in-app offline save, then clears the
// file so it isn't drained twice.
async function drainNativeIntentQueue(): Promise<void> {
  const info = await FileSystem.getInfoAsync(NATIVE_INTENT_QUEUE_FILE);
  if (!info.exists) return;

  let entries: NativeIntentEntry[] = [];
  try {
    entries = JSON.parse(await FileSystem.readAsStringAsync(NATIVE_INTENT_QUEUE_FILE));
  } catch {
    // Corrupt/partial file -- drop it rather than looping on it forever.
    await FileSystem.deleteAsync(NATIVE_INTENT_QUEUE_FILE, { idempotent: true });
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    await FileSystem.deleteAsync(NATIVE_INTENT_QUEUE_FILE, { idempotent: true });
    return;
  }

  // Prefer a live fetch over the cache: on a fresh install (or right after
  // reinstalling a new build), the local bank cache is empty until the first
  // full syncNow() pass finishes -- which happens AFTER this drain step in the
  // very same call -- so relying on the cache here would silently no-op a
  // queued native-intent transaction on exactly the first app open after it
  // was created, looking indistinguishable from data loss.
  const banks = await listBanks().catch(() => getCachedBanks().catch(() => []));

  // No accounts synced to this device yet -- can't resolve any account, so leave
  // the file untouched entirely rather than losing these entries.
  if (banks.length === 0) return;

  // Only fetched if actually needed (an account_hint that matches nothing), and
  // only once per drain pass, not per entry.
  let externalBankId: number | null = null;
  const getExternalBankId = async (): Promise<number | null> => {
    if (externalBankId !== null) return externalBankId;
    try {
      externalBankId = (await getExternalBank()).id;
    } catch {
      externalBankId = null;
    }
    return externalBankId;
  };

  const unresolved: NativeIntentEntry[] = [];

  for (const entry of entries) {
    const hint = (entry.account_hint || "").trim();
    let bankId: number | null;
    let note = entry.notes;
    if (!hint) {
      // No account specified at all -- same "just pick the first one" default
      // the in-app Add Transaction screen uses, not an unmatched-account case.
      bankId = banks[0]?.id ?? null;
    } else {
      const low = hint.toLowerCase();
      const match = banks.find((b) => b.name.toLowerCase().includes(low) || low.includes(b.name.toLowerCase()));
      if (match) {
        bankId = match.id;
      } else {
        // Never silently misattribute an unrecognized account to some unrelated
        // real account -- file it under "External" for review instead, same
        // fallback /api/ingest/transaction uses for the exact same situation.
        bankId = await getExternalBankId();
        const flag = `Account "${hint}" didn't match any bank — filed under External for review.`;
        note = note ? `${note}\n${flag}` : flag;
      }
    }
    if (!bankId) {
      // Couldn't even resolve/create External (offline right now) -- keep this
      // entry queued for the next drain instead of losing it.
      unresolved.push(entry);
      continue;
    }
    const payload: CreateTransactionPayload = {
      bank_id: bankId,
      transaction_date: entry.transaction_date,
      description: entry.description,
      // Sign is carried by transaction_type, never by amount -- Shortcuts'
      // own "Amount" variable can come through signed (negative for an
      // expense) depending on how the Automation/Shortcut built it, unlike
      // the live AddTransactionIntent.swift path which posts straight to
      // /api/ingest/transaction and gets normalized there by _coerce_amount.
      amount: Math.abs(entry.amount),
      transaction_type: entry.type === "income" ? "credit" : "debit",
      category: entry.category,
      notes: note,
    };
    await queueOfflineTransaction(payload, entry.client_uuid);
  }

  if (unresolved.length > 0) {
    await FileSystem.writeAsStringAsync(NATIVE_INTENT_QUEUE_FILE, JSON.stringify(unresolved));
  } else {
    await FileSystem.deleteAsync(NATIVE_INTENT_QUEUE_FILE, { idempotent: true });
  }
}

export async function syncNow(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    await drainNativeIntentQueue();
    await flushPendingWrites();
    await pullTransactions();
    await pullReferenceLists();
  } catch {
    // Best-effort -- a failed sync pass just means the next trigger retries.
    // Never surface this as a user-facing error; cached data stays usable.
  } finally {
    isFlushing = false;
  }
}
