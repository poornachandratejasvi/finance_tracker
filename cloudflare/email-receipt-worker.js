/**
 * Cloudflare Email Worker: forwards a receipt emailed to a dedicated address
 * (e.g. receipts@061295.xyz) straight into Finance Tracker's ingest pipeline.
 *
 * Deliberately does NOT parse the email itself -- Cloudflare's dashboard
 * Quick Edit has no npm/bundler support, so a from-scratch MIME parser here
 * would be both fragile and hard to maintain. Instead this just forwards the
 * raw RFC822 message bytes to the backend, which parses it with Python's
 * battle-tested stdlib `email` module (see POST /api/ingest/receipt-email in
 * backend/app/api/endpoints/ingest.py) and extracts the first image/PDF
 * attachment from there.
 *
 * Setup (Cloudflare dashboard, no wrangler/CLI needed):
 *   1. Email -> Email Routing on the zone -> Enable.
 *   2. Create a route: receipts@061295.xyz -> Action: Send to a Worker.
 *   3. Create a Worker, paste this file's contents in, deploy.
 *   4. Worker -> Settings -> Variables -> add FINANCE_API_URL and
 *      FINANCE_API_TOKEN as secrets (never hardcode them here).
 */

export default {
  async email(message, env, ctx) {
    if (!env.FINANCE_API_URL || !env.FINANCE_API_TOKEN) {
      console.error("FINANCE_API_URL / FINANCE_API_TOKEN not configured on this Worker.");
      return;
    }

    try {
      const res = await fetch(`${env.FINANCE_API_URL}/api/ingest/receipt-email`, {
        method: "POST",
        headers: {
          "X-API-Key": env.FINANCE_API_TOKEN,
          "Content-Type": "message/rfc822",
        },
        body: message.raw,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`Ingest failed (${res.status}): ${body.slice(0, 300)}`);
      }
    } catch (err) {
      console.error(`Failed to forward email to Finance Tracker: ${err.message}`);
    }

    // No reply/reject -- the Transactions list in the app is the confirmation.
    // (Email Routing has no "reply to sender" primitive the way the WhatsApp
    // bridge can just send a message back.)
  },
};
