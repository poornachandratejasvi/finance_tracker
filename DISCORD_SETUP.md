# Discord Integration Setup Guide

## Overview
The Finance Tracker now sends real-time notifications to Discord when:
- ✅ New transaction data is obtained from PDFs
- ❌ Errors occur during sync/parsing
- 🟡 Sync operations start
- ✅ Sync operations complete with summary

## Setup Steps

### 1. Create Discord Webhook

1. Open your Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **"New Webhook"** or select existing webhook
4. Configure webhook:
   - Name: `Finance Tracker Bot` (or any name)
   - Channel: Select channel for notifications (e.g., `#finance-alerts`)
   - Avatar: Optional custom icon
5. Click **"Copy Webhook URL"**
6. The URL format: `https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN`

### 2. Add Webhook to Environment

Add to your `.env` file in the project root:

```env
# Discord Integration
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

**Example**:
```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789012345678/abcdef1234567890ABCDEF1234567890abcdefABCDEF12345
```

### 3. Restart Backend

```bash
cd /home/tejasvim/personal_files/cred_transaction
docker restart finance_tracker_backend
```

Wait 10-15 seconds for backend to fully restart.

### 4. Verify Setup

Check backend logs:
```bash
docker logs finance_tracker_backend | grep -i discord
```

Should see: `Discord webhook configured` or similar.

## Notification Types

### 🟡 Sync Started
**When**: Resync PDFs operation begins
**Color**: Yellow (warning)
**Contains**:
- Bank name or "All Banks"
- Start timestamp
- User who initiated

**Example**:
```
📊 Sync Started
Syncing: HDFC Bank
Started: 2024-01-15 10:30:45
```

### ✅ New Data Obtained
**When**: PDF successfully parsed with new transactions
**Color**: Green (success)
**Contains**:
- Bank name
- Transaction count
- PDF filename
- Timestamp

**Example**:
```
💰 New Data Obtained
Bank: HDFC Bank
Transactions: 15 new
PDF: hdfc_statement_jan2024.pdf
Time: 2024-01-15 10:31:12
```

### ❌ Error Occurred
**When**: PDF parsing fails or sync error
**Color**: Red (error)
**Contains**:
- Bank name
- Error message
- Operation that failed
- Timestamp

**Example**:
```
⚠️ Error Occurred
Bank: ICICI Bank
Operation: PDF Parsing
Error: Invalid password
Time: 2024-01-15 10:32:05
```

### ✅ Sync Completed
**When**: Full resync operation finishes
**Color**: Green (success)
**Contains**:
- Bank name
- New transactions added
- Total transactions in system
- Timestamp

**Example**:
```
✨ Sync Completed
Bank: SBI Bank
New Transactions: 23
Total Transactions: 1,234
Time: 2024-01-15 10:35:00
```

## Customization

### Change Notification Channel

To send notifications to different channels, create multiple webhooks:

```env
# General notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID1/TOKEN1

# Error-only channel (requires code modification)
DISCORD_ERROR_WEBHOOK_URL=https://discord.com/api/webhooks/ID2/TOKEN2
```

### Disable Notifications

Remove or comment out the webhook URL:
```env
# DISCORD_WEBHOOK_URL=...
```

Or leave it empty:
```env
DISCORD_WEBHOOK_URL=
```

### Custom Notification Format

Edit `backend/app/services/discord_notifier.py` to customize:

```python
def notify_new_data(self, bank_name: str, transaction_count: int, pdf_file: str = None):
    fields = [
        {"name": "🏦 Bank", "value": bank_name, "inline": True},
        {"name": "💰 Transactions", "value": str(transaction_count), "inline": True},
        {"name": "📄 File", "value": pdf_file or "N/A", "inline": False},
        # Add more fields here
    ]
    # ...
```

## Testing Notifications

### Method 1: Trigger Resync
1. Login to Finance Tracker
2. Go to **Banks** page
3. Click **"Resync PDFs"** button
4. Check Discord channel for notifications

### Method 2: Manual Test Script
Create `test_discord.py`:
```python
from app.services.discord_notifier import discord_notifier

discord_notifier.notify_new_data(
    bank_name="Test Bank",
    transaction_count=5,
    pdf_file="test.pdf"
)
```

Run:
```bash
cd backend
python3 test_discord.py
```

### Method 3: Direct Webhook Test
Use curl:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "embeds": [{
      "title": "Test Notification",
      "description": "Testing Discord integration",
      "color": 3066993
    }]
  }'
```

## Troubleshooting

### Issue: No notifications appearing

**Check 1**: Webhook URL configured?
```bash
grep DISCORD_WEBHOOK_URL .env
```

**Check 2**: Backend restarted?
```bash
docker restart finance_tracker_backend
docker logs finance_tracker_backend | tail -20
```

**Check 3**: Webhook valid?
Test with curl (see Method 3 above)

**Check 4**: Discord webhook active?
- Go to Discord Server Settings → Integrations → Webhooks
- Verify webhook exists and channel is correct

### Issue: Notifications work but missing data

**Check**: Backend logs for errors
```bash
docker logs finance_tracker_backend | grep -i "discord\|error"
```

### Issue: Too many notifications

**Solution**: Adjust notification frequency by:
1. Reducing auto-refresh interval
2. Disabling auto-refresh
3. Modifying notification conditions in `discord_notifier.py`

## Security Considerations

### 🔒 Webhook URL is Sensitive
- **Never commit** `.env` to git
- **Never share** webhook URL publicly
- **Rotate webhook** if exposed (delete and create new)

### Access Control
- Webhook can post to Discord without authentication
- Anyone with URL can send messages
- Use Discord channel permissions to control who sees notifications

### Rate Limits
Discord has rate limits:
- **50 requests per second** per webhook
- **30 messages per 60 seconds** per channel

If hit, notifications will fail. Solution:
- Add delay between notifications
- Queue notifications
- Use different webhooks for different operations

## Advanced: Multiple Webhook Channels

Modify `discord_notifier.py` to support multiple channels:

```python
class DiscordNotifier:
    def __init__(self):
        self.webhook_urls = {
            'general': os.getenv("DISCORD_WEBHOOK_GENERAL"),
            'errors': os.getenv("DISCORD_WEBHOOK_ERRORS"),
            'success': os.getenv("DISCORD_WEBHOOK_SUCCESS"),
        }
    
    def send_notification(self, title, description, color, fields=None, channel='general'):
        webhook_url = self.webhook_urls.get(channel)
        if not webhook_url:
            return
        # ... rest of code
```

Then in `.env`:
```env
DISCORD_WEBHOOK_GENERAL=https://discord.com/api/webhooks/ID1/TOKEN1
DISCORD_WEBHOOK_ERRORS=https://discord.com/api/webhooks/ID2/TOKEN2
DISCORD_WEBHOOK_SUCCESS=https://discord.com/api/webhooks/ID3/TOKEN3
```

## Notification Examples in Discord

### Successful Sync
![](https://via.placeholder.com/400x200/00ff00/000000?text=✅+15+transactions+from+HDFC+Bank)

### Error Notification
![](https://via.placeholder.com/400x200/ff0000/ffffff?text=❌+PDF+parsing+failed)

### Sync Started
![](https://via.placeholder.com/400x200/ffaa00/000000?text=🟡+Sync+started+for+All+Banks)

## API Reference

### DiscordNotifier Class

#### `notify_new_data(bank_name, transaction_count, pdf_file=None)`
Send notification when new data obtained.
- **bank_name** (str): Name of bank
- **transaction_count** (int): Number of new transactions
- **pdf_file** (str, optional): PDF filename

#### `notify_error(bank_name, error_message, operation="sync")`
Send error notification.
- **bank_name** (str): Bank where error occurred
- **error_message** (str): Error details
- **operation** (str): Operation that failed

#### `notify_sync_started(bank_name)`
Send notification when sync starts.
- **bank_name** (str): Bank being synced or "All Banks"

#### `notify_sync_completed(bank_name, new_transactions, total_transactions)`
Send notification when sync completes.
- **bank_name** (str): Bank synced
- **new_transactions** (int): New transactions added
- **total_transactions** (int): Total transactions in system

#### `send_notification(title, description, color, fields=None)`
Generic notification method.
- **title** (str): Embed title
- **description** (str): Embed description
- **color** (int): Embed color (RGB int)
- **fields** (list, optional): List of field dicts

## Color Codes

```python
# Green (success)
0x00ff00  # 65280

# Red (error)
0xff0000  # 16711680

# Yellow (warning)
0xffaa00  # 16755200

# Blue (info)
0x0088ff  # 34815

# Purple
0x9c27b0  # 10233776
```

## Support

For issues with Discord integration:
1. Check webhook URL is correct
2. Verify backend restarted
3. Check Discord webhook is active
4. Review backend logs for errors
5. Test webhook directly with curl

For Discord API documentation:
https://discord.com/developers/docs/resources/webhook

## Changelog

### v1.0.0 (2024-01-15)
- Initial Discord integration
- 4 notification types (started, success, error, completed)
- Embedded rich messages with colors
- Configurable via environment variable
