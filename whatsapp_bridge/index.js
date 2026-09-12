"use strict";

/**
 * Self-hosted WhatsApp bridge for Finance Tracker.
 *
 * Connects as a linked device (Baileys) on a DEDICATED WhatsApp number/line --
 * not the account owner's own personal WhatsApp -- and forwards whatever it
 * receives there into the backend's existing ingest endpoints:
 *   - a text message -> POST /api/ingest/sms (source="whatsapp")
 *   - a photo        -> POST /api/ingest/receipt (source="whatsapp")
 * Both endpoints already do the real extraction (regex/AI for text, OCR+AI
 * for photos) and create an unconfirmed transaction for later review in the
 * app -- this bridge is intentionally thin, just message plumbing + a reply.
 *
 * First run: no auth session exists yet, so a pairing QR code is printed to
 * stdout (`docker logs -f whatsapp-bridge`) -- scan it from the DEDICATED
 * number's WhatsApp app (Settings > Linked Devices). The session is then
 * persisted to AUTH_DIR so this never needs to happen again unless that
 * volume is wiped or the device is unlinked from the phone.
 */

const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const AUTH_DIR = process.env.AUTH_DIR || "/data/auth";
const FINANCE_API_URL = (process.env.FINANCE_API_URL || "").replace(/\/$/, "");
const FINANCE_API_TOKEN = process.env.FINANCE_API_TOKEN || "";
// Optional: restrict processing to one sender JID (e.g. "919876543210@s.whatsapp.net"),
// the account owner's own number, so anyone else who somehow gets this number
// can't log fake expenses. Unset = process every message this line receives,
// which is fine when the whole number is dedicated to this one purpose.
const ALLOWED_SENDER_JID = process.env.ALLOWED_SENDER_JID || null;

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

if (!FINANCE_API_URL || !FINANCE_API_TOKEN) {
  logger.error("FINANCE_API_URL and FINANCE_API_TOKEN are required -- set them in the environment.");
  process.exit(1);
}

function apiHeaders(extra) {
  return { "X-API-Key": FINANCE_API_TOKEN, ...extra };
}

async function ingestText(text) {
  const res = await fetch(`${FINANCE_API_URL}/api/ingest/sms`, {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, sender: "whatsapp", source: "whatsapp" }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function ingestReceipt(buffer, mimetype) {
  const form = new FormData();
  const ext = mimetype === "application/pdf" ? "pdf" : "jpg";
  form.append("file", new Blob([buffer], { type: mimetype }), `receipt.${ext}`);
  const res = await fetch(`${FINANCE_API_URL}/api/ingest/receipt?source=whatsapp`, {
    method: "POST",
    headers: apiHeaders(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Both /ingest/sms and /ingest/receipt return enough of the parsed record to
// build a useful confirmation without a second round-trip.
function replyTextFor(result) {
  if (!result.ok) {
    return "Couldn't log that -- the server rejected it. Check the app or try again.";
  }
  const { data } = result;
  if (data.created === false) {
    if (data.reason === "no_text" || data.reason === "no_amount_found") {
      return "Couldn't read an amount from that -- try a clearer photo, or add it manually in the app.";
    }
    if (data.skipped_duplicate) {
      return "Looks like that's already logged (duplicate) -- skipped.";
    }
    return "Couldn't log that one. Check the app or try again.";
  }
  const amount = data.amount != null ? `₹${data.amount}` : "an amount";
  const merchant = data.description ? ` at ${data.description}` : "";
  const category = data.category ? ` (${data.category})` : "";
  return `Logged: ${amount}${merchant}${category}`;
}

async function handleMessage(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || msg.key.fromMe) return;
  if (ALLOWED_SENDER_JID && remoteJid !== ALLOWED_SENDER_JID) {
    logger.info({ remoteJid }, "Ignoring message from non-allowed sender");
    return;
  }

  const message = msg.message;
  if (!message) return;

  try {
    const text =
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      null;

    if (message.imageMessage) {
      const buffer = await downloadMediaMessage(msg, "buffer", {});
      const result = await ingestReceipt(buffer, message.imageMessage.mimetype || "image/jpeg");
      await sock.sendMessage(remoteJid, { text: replyTextFor(result) });
      return;
    }

    if (message.documentMessage && (message.documentMessage.mimetype || "").includes("pdf")) {
      const buffer = await downloadMediaMessage(msg, "buffer", {});
      const result = await ingestReceipt(buffer, "application/pdf");
      await sock.sendMessage(remoteJid, { text: replyTextFor(result) });
      return;
    }

    if (text && text.trim()) {
      const result = await ingestText(text.trim());
      await sock.sendMessage(remoteJid, { text: replyTextFor(result) });
      return;
    }
  } catch (err) {
    logger.error({ err: err.message }, "Failed to process WhatsApp message");
    try {
      await sock.sendMessage(remoteJid, { text: "Something went wrong logging that -- try again shortly." });
    } catch {
      // Ignore -- a failed reply-send is logged, not fatal (see module docstring above).
    }
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(AUTH_DIR));

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info("Scan this QR code from the dedicated WhatsApp number's Linked Devices screen:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, "Connection closed");
      if (shouldReconnect) {
        start().catch((err) => logger.error({ err: err.message }, "Reconnect failed"));
      } else {
        logger.error("Logged out -- delete the auth volume and restart to re-pair.");
      }
    } else if (connection === "open") {
      logger.info("WhatsApp bridge connected.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleMessage(sock, msg);
    }
  });
}

start().catch((err) => {
  logger.error({ err: err.message }, "Fatal error starting WhatsApp bridge");
  process.exit(1);
});
