# Receipt archiving with Paperless-ngx

Scanned receipts (mobile's Scan Receipt flow) get archived to a
[Paperless-ngx](https://docs.paperless-ngx.com/) instance instead of this app
trying to be its own document store — OCR, full-text search, and long-term
storage are Paperless's job, not this app's. The finance app links each
transaction to the resulting document once Paperless finishes processing it.

This is **entirely optional**. With nothing configured, receipt scanning still
works exactly as before (OCR → draft transaction for you to review) — it just
won't archive the photo anywhere afterward.

Two independent pieces:
1. **The Paperless-ngx container itself** — added to both `docker-compose.traefik.yml`
   and `docker-compose.prod.yml` as a `paperless` service, sharing this stack's
   existing Postgres and Redis rather than running a second instance of either.
2. **This app's connection to it** (its URL + an API token) — configured live from
   **Settings → External Accounts → Paperless-ngx**, *not* from `.env`. Nothing here
   requires a container restart to change.

---

## 1. Bring up the `paperless` service

Add these to your `.env` (see `.env.example` for the full annotated list):

```bash
PAPERLESS_DB_NAME=paperless
PAPERLESS_SECRET_KEY=   # generate: python3 -c "import secrets; print(secrets.token_urlsafe(64))"
PAPERLESS_ADMIN_USER=admin
PAPERLESS_ADMIN_PASSWORD=some-strong-password
PAPERLESS_TIME_ZONE=Asia/Kolkata
PAPERLESS_OCR_LANGUAGE=eng
```

**Never commit `.env`** (it's already gitignored) — only `.env.example`'s blank
placeholders belong in git.

### With Traefik (`docker-compose.traefik.yml`)

Also set:

```bash
PAPERLESS_TRAEFIK_DOMAIN=paperless.yourdomain.com
```

Add a DNS record for that subdomain pointing at the same host as your main
`TRAEFIK_DOMAIN` (same setup — e.g. proxied through Cloudflare if that's what
you're already using), then:

```bash
docker compose -f docker-compose.traefik.yml up -d paperless-db-init paperless
```

Paperless will be reachable at `https://paperless.yourdomain.com`. `paperless-db-init`
is a one-shot helper that creates the `paperless` database on your existing Postgres
server if it doesn't already exist — safe to leave in the stack permanently, it's a
no-op after the first run.

### Without Traefik (`docker-compose.prod.yml`)

No DNS/subdomain needed. Optionally set a custom port (default `8010`):

```bash
PAPERLESS_PORT=8010
```

```bash
docker compose -f docker-compose.prod.yml up -d paperless-db-init paperless
```

Paperless will be reachable at `http://<this-host>:8010`. If you're putting your
own reverse proxy in front of it instead, set `PAPERLESS_URL` to whatever external
URL you're exposing it under.

### First login

Visit Paperless at whichever URL applies above, and log in with
`PAPERLESS_ADMIN_USER` / `PAPERLESS_ADMIN_PASSWORD`.

---

## 2. Connect the finance app to it

1. In Paperless: **Settings → My Profile Settings → API Tokens** (or `/api/token/`
   via the API) → create a token.
2. In the finance app: **Settings → External Accounts → Paperless-ngx** → enter
   the URL from step 1 above (e.g. `https://paperless.yourdomain.com` or
   `http://<host>:8010`) and the API token → **Save** → **Test connection**.

The URL you enter here is only ever used to build the "View Receipt" link a
person clicks (it has to be one their browser can reach). The backend's own
API calls (upload, task polling, the connection test itself) go over Docker's
internal network instead by default (`http://paperless:8000` — the Docker
service name, works automatically since both containers share `finance-network`)
rather than round-tripping out through Cloudflare/Traefik and back in. See
`PAPERLESS_INTERNAL_URL` in `.env.example` if Paperless runs somewhere that
default can't reach.

That's it — the next scanned-and-saved receipt (mobile) gets archived
automatically, and its transaction shows a "View Receipt" link once Paperless
finishes OCR/indexing it (usually a few seconds, occasionally longer on a slow
instance — the app polls in the background rather than blocking).

---

## Notes

- Paperless-ngx's own Postgres database (`paperless`) and Redis usage (logical DB
  index `1`, vs. this app's `0`) live on the SAME `db`/`redis` containers as the
  finance app — no second database/cache server to run or back up separately
  (your existing Postgres backup already covers it).
- The finance app never reads Paperless's admin credentials or database directly —
  only the REST API, using the token you create in step 2.
- Removing the integration: clear the URL/token in Settings → External Accounts.
  Existing `receipt_url` links on past transactions will just stop resolving if you
  also tear down the `paperless` container — the transactions themselves are
  unaffected either way.
