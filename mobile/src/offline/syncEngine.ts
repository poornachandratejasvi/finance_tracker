import * as Crypto from "expo-crypto";

import { listTransactions, createTransaction, CreateTransactionPayload } from "../api/transactions";
import { listBanks } from "../api/banks";
import { listCategories } from "../api/categories";
import { listLabels } from "../api/labels";
import { Transaction } from "../types";
import {
  upsertTransactions, upsertBanks, upsertCategories, upsertLabels,
  getLastTransactionSyncAt, setLastTransactionSyncAt,
  insertPendingTransaction, replacePendingTransaction,
  enqueuePendingWrite, getPendingWrites, markPendingWriteDone,
  markPendingWriteRetried, markPendingWriteFailed,
} from "./db";

let isFlushing = false;

// Queue a transaction created while offline (or whose request failed with no
// server response at all -- a genuine network failure, not a validation
// rejection). Never queues something the server already told us is invalid.
export async function queueOfflineTransaction(payload: CreateTransactionPayload): Promise<Transaction> {
  const clientUuid = Crypto.randomUUID();
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

async function flushPendingWrites(): Promise<void> {
  const writes = await getPendingWrites();
  for (const write of writes) {
    if (write.entity_type !== "transaction" || write.op !== "create") continue;
    const payload: CreateTransactionPayload = JSON.parse(write.payload_json);
    const localId = `local-${write.client_uuid}`;
    try {
      const created = await createTransaction(payload);
      await replacePendingTransaction(localId, created);
      await markPendingWriteDone(write.id);
    } catch (err: any) {
      if (err?.response) {
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

export async function syncNow(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
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
