# Connecting an external tool (packages, subscriptions, calendar)

For automation tools or a second app (e.g. an assistant/agent framework you run
elsewhere) that wants to read or write package-tracking, subscription, or
calendar data directly, without going through the browser session.

## 1. Get an API token (one time)

Same mechanism as the [iOS Shortcut integration](ios-shortcut.md): a long-lived
API token, not your password.

- In the app: **API Access** (left nav) → **Create token** → name it (e.g.
  `openclaw`) → copy the token shown once (`ft_...`, not shown again).
- Or via the API:

  ```bash
  curl -s -X POST https://your-domain/api/api-tokens/ \
    -H "Authorization: Bearer <your_session_access_token>" \
    -H "Content-Type: application/json" \
    -d '{"name":"openclaw"}'
  # -> { "id": 1, "token": "ft_XXXXXXXX...", ... }
  ```

Keep this token secret — anyone with it can read/create packages, subscriptions,
and calendar entries on your account.

## 2. Authenticate requests

Send the token either as `X-API-Key: ft_...` or `Authorization: Bearer ft_...`
— whichever your tool's HTTP client makes easier. Both work identically on
every endpoint below.

## 3. Endpoints

Full OpenAPI schema (request/response models, all fields) is browsable live at
`/docs` on your instance. Summary of the package-tracking + calendar surface:

**Packages** (`/api/packages`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List all tracked packages |
| POST | `/` | Add a package manually (`carrier`, `tracking_number`, `merchant`, `item_description`, `expected_delivery_date`, `tracking_url`, `notes`) |
| PUT | `/{id}` | Edit a package |
| DELETE | `/{id}` | Remove a package |
| POST | `/{id}/refresh-now` | Force a live tracking-status check (`has_live_tracking: true` carriers), or queue an external browser-automation lookup (`has_external_lookup: true` carriers — see section 5) |
| GET | `/carriers` | List known carrier keys/labels + which support live tracking / external lookup |

`carrier` accepts any string — not limited to the listed keys — so any courier
not in the fixed list can be tracked under its own name (e.g.
`shree_maruti_courier`); it just won't have live-tracking refresh, only
whatever you set manually.

**Subscriptions / calendar items** (`/api/subscriptions`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List all tracked subscriptions/bills/reminders |
| POST | `/` | Add one (`name`, `item_type`: subscription/bill/custom, `amount`, `due_date`, `recurrence`: none/weekly/monthly/yearly, `notes`) |
| PUT | `/{id}` | Edit |
| DELETE | `/{id}` | Remove |
| POST | `/from-pattern` | Create one from a detected recurring-transaction pattern (see `GET /api/watchers/detect-recurring`) |

**Calendar** (`/api/calendar`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/?days_ahead=60` | Merged, server-sorted feed of upcoming package deliveries + subscription/bill occurrences (recurrence already expanded) within the window. Each item: `{type, id, date, title, subtitle, amount, link, is_overdue}` |

This is the single endpoint an external "what's coming up" surface (a
dashboard widget, a daily digest, an agent doing a morning briefing) should
poll — it already merges and sorts everything, no client-side joining needed.

## 4. Example: fetch what's due this week

```bash
curl -s "https://your-domain/api/calendar/?days_ahead=7" \
  -H "Authorization: Bearer ft_XXXXXXXX..."
```

## 5. External Lookups — handing browser-automation work to an agent (OpenClaw)

Some couriers (currently Bluedart, DTDC) have no captcha-free tracking API at
all — Bluedart's known API keys are revoked and its web tracker is
hCaptcha-gated; DTDC's tracking calls require a token minted by solving a
captcha first. Rather than give up on these, Finance Tracker queues the work
for an agent that *can* drive a real browser (OpenClaw) to pull the answer.

This queue (`/api/external-lookups`) is generic by design — `courier_tracking`
is the only request type today, but a future need (checking a page behind a
login, anything else only a real browser can do) reuses the same two
endpoints, not a new pair each time.

**How it fills up:** every 6 hours, and whenever you tap "Queue lookup" on a
Bluedart/DTDC package in the Packages page, a pending request is created (deduped
— a package with one already pending doesn't get a second).

**Polling loop for OpenClaw:**

```bash
# 1. See what's waiting
curl -s "https://your-domain/api/external-lookups/pending?request_type=courier_tracking" \
  -H "Authorization: Bearer ft_XXXXXXXX..."
# -> [{"id": 12, "request_type": "courier_tracking", "status": "pending",
#      "input": {"carrier": "bluedart", "tracking_number": "..."}, ...}]
```

For each pending request: use `input.carrier` + `input.tracking_number` to
know what to look up (open the carrier's tracking page, solve whatever's in
the way, read the result), then post it back:

```bash
curl -s -X POST "https://your-domain/api/external-lookups/12/complete" \
  -H "Authorization: Bearer ft_XXXXXXXX..." \
  -H "Content-Type: application/json" \
  -d '{"result": {"status": "out_for_delivery", "expected_delivery_date": "2026-09-05T00:00:00", "current_location": "Bengaluru Hub"}}'
```

`result.status` should be one of `ordered|shipped|out_for_delivery|delivered`
(anything else is ignored, leaving the package's current status alone).
`expected_delivery_date`/`actual_delivery_date` are optional ISO date strings.
Completing the request immediately updates the matching Package — no separate
step needed. If the lookup genuinely can't be completed (site down, AWB not
found), post `{"error": "reason"}` instead of `result` to mark it failed
rather than leaving it pending forever.

A request can only be completed once (`400` if already completed/failed) — no
need to guard against double-processing on your end.
