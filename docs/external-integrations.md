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
| POST | `/{id}/refresh-now` | Force a live tracking-status check (only for carriers with `has_live_tracking: true`) |
| GET | `/carriers` | List known carrier keys/labels + which support live tracking |

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

## 5. Notes for a push-based (webhook) integration

There is currently no outbound webhook — package/subscription due-date alerts
go out via the existing Discord/Apprise notification channel (Settings →
Notifications), not to arbitrary third-party endpoints. If a tool needs to be
*pushed to* rather than polling `/api/calendar`, that would need a small new
webhook-dispatch feature — not built yet, ask for it once the target tool's
expected payload shape is known.
