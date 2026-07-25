# UI Button and Feature Validation Checklist

## How to Test Every Button and Feature

### 🔐 Login Page
- [ ] Username field accepts input
- [ ] Password field accepts input and masks characters
- [ ] "Login" button clickable and submits form
- [ ] Shows error message on invalid credentials
- [ ] Redirects to dashboard on successful login

---

### 🏠 Dashboard / Analytics Page
- [ ] Page loads without errors
- [ ] Shows data immediately (income, expense, balance)
- [ ] **Filters Section**:
  - [ ] Bank dropdown populated with banks
  - [ ] Bank filter clickable and selectable
  - [ ] Start Date picker works
  - [ ] End Date picker works
  - [ ] Year dropdown selectable
  - [ ] Filters update charts when changed
- [ ] **Charts Display**:
  - [ ] Summary cards show correct data
  - [ ] Line/Area chart renders
  - [ ] Bar chart renders
  - [ ] Pie chart renders
  - [ ] Charts update when filters change
- [ ] **Auto-Refresh**:
  - [ ] Toggle switch works
  - [ ] Interval selector works (15/30/60 sec)
  - [ ] Refresh icon button works
- [ ] **Dark Mode**:
  - [ ] Moon/Sun icon in header clickable
  - [ ] Entire page changes theme (not just components)
  - [ ] Theme persists on page reload

---

### 💳 Transactions Page
- [ ] Page loads transaction list
- [ ] Table shows all columns including "Account Type"
- [ ] **Filters**:
  - [ ] Bank filter dropdown works
  - [ ] Date range filters work
  - [ ] Category filter works
  - [ ] Search box works
  - [ ] Apply button updates results
- [ ] **Table Features**:
  - [ ] Sticky header stays on scroll
  - [ ] Table scrollable when many transactions
  - [ ] Checkbox for selecting transactions
  - [ ] Select all checkbox works
  - [ ] Account Type shows colored chip (Savings/Credit Card/Other)
- [ ] **Actions**:
  - [ ] Edit button opens edit dialog
  - [ ] Delete button deletes transaction
  - [ ] Bulk edit button (if selected multiple)
  - [ ] Export button works
- [ ] **Pagination**:
  - [ ] Next/Previous buttons work
  - [ ] Rows per page selector works
  - [ ] Page numbers clickable

---

### 🏦 Banks Page
- [ ] Page loads banks list
- [ ] **Add Bank Button**:
  - [ ] Opens add bank dialog
  - [ ] **Form Fields**:
    - [ ] Bank Name field accepts input
    - [ ] Bank Code field accepts input
    - [ ] Sender Email field accepts email
    - [ ] **Additional Sender Emails field**:
      - [ ] Accepts comma-separated emails
      - [ ] Placeholder shows format: "email1@bank.com, email2@bank.com"
    - [ ] **Account Type dropdown**:
      - [ ] Shows Savings/Credit Card/Other options
      - [ ] Selectable
      - [ ] Defaults to "Savings"
    - [ ] Account Number field accepts input
    - [ ] Account Password field accepts input and masks
  - [ ] **Dialog Buttons**:
    - [ ] Cancel button closes dialog
    - [ ] Add Bank button disabled when required fields empty
    - [ ] Add Bank button saves and closes on click
- [ ] **Bank Cards**:
  - [ ] Shows bank name, code, email
  - [ ] Edit button opens edit dialog
  - [ ] Delete button deletes bank
  - [ ] Sync button starts sync
  - [ ] Resync PDFs button works
  - [ ] Upload PDF button opens upload dialog
- [ ] **Edit Bank**:
  - [ ] Opens dialog with pre-filled data
  - [ ] Multiple emails display as comma-separated
  - [ ] Account type shows current selection
  - [ ] Update button saves changes
  - [ ] Changes persist after save
- [ ] **Auto-Refresh**:
  - [ ] Toggle switch enables/disables
  - [ ] Interval selector works
  - [ ] Auto-refresh triggers both UI refresh AND Gmail sync
- [ ] **Gmail Section**:
  - [ ] Add Gmail button opens dialog
  - [ ] Connect Gmail button works
  - [ ] Gmail accounts list shows
  - [ ] Remove Gmail account works

---

### 📄 PDFs Page
- [ ] Page loads PDF list
- [ ] Table shows PDF files with details
- [ ] **Upload PDF**:
  - [ ] File picker opens
  - [ ] Selected file shows
  - [ ] Bank selector works
  - [ ] Password field works
  - [ ] Upload button uploads PDF
- [ ] **PDF Actions**:
  - [ ] View button opens PDF
  - [ ] Download button downloads PDF
  - [ ] Delete button deletes PDF
  - [ ] Reprocess button reparses PDF
- [ ] **Filters**:
  - [ ] Bank filter works
  - [ ] Status filter (Processed/Unprocessed) works
  - [ ] Date range filter works

---

### 🗺️ Field Mapping Page
- [ ] Page loads without errors
- [ ] **Bank Selector**:
  - [ ] Dropdown populated with banks ✅
  - [ ] Selecting bank loads fields
- [ ] **Field Mapping Form**:
  - [ ] Shows current mappings
  - [ ] Input fields editable
  - [ ] Add custom field button works
  - [ ] Remove field button works
  - [ ] Save button saves mappings
- [ ] **Test Button**:
  - [ ] Test mapping button works
  - [ ] Shows mapping results
  - [ ] Displays errors if any

---

### ⚙️ Settings Page
- [ ] Page loads settings
- [ ] **Profile Section**:
  - [ ] Username shows
  - [ ] Email field works
  - [ ] Update button saves
- [ ] **Preferences**:
  - [ ] Default currency selector works
  - [ ] Date format selector works
  - [ ] Timezone selector works
  - [ ] Save button works
- [ ] **Security**:
  - [ ] Change password button opens dialog
  - [ ] Old password field works
  - [ ] New password field works
  - [ ] Confirm password field works
  - [ ] Update password button works

---

### 🔔 Discord Notifications
- [ ] **Setup**:
  - [ ] DISCORD_WEBHOOK_URL in .env
  - [ ] Backend restarted after adding
- [ ] **Notifications Sent**:
  - [ ] Sync started (yellow embed)
  - [ ] New data obtained (green embed with count)
  - [ ] Sync completed (green embed with stats)
  - [ ] Errors (red embed with details)
- [ ] **Notification Content**:
  - [ ] Bank name shown
  - [ ] Transaction counts shown
  - [ ] PDF file names shown
  - [ ] Error messages shown
  - [ ] Timestamps included

---

### 📊 Bulk Edit (If applicable)
- [ ] Select multiple transactions
- [ ] Bulk Edit button appears
- [ ] Opens bulk edit dialog
- [ ] **Operations**:
  - [ ] Change category works
  - [ ] Add notes works
  - [ ] Delete selected works
  - [ ] Apply to all checkbox works
- [ ] Cancel button works
- [ ] Apply button updates transactions

---

### 🌓 Dark Mode (Comprehensive Check)
Toggle dark mode and verify:
- [ ] Header/AppBar changes color
- [ ] Main content background changes
- [ ] All pages change theme:
  - [ ] Dashboard/Analytics
  - [ ] Transactions
  - [ ] Banks
  - [ ] PDFs
  - [ ] Field Mapping
  - [ ] Settings
- [ ] Cards change background
- [ ] Tables change background
- [ ] Dialogs change background
- [ ] Text remains readable
- [ ] Buttons remain visible
- [ ] Charts adapt to theme
- [ ] No white/light areas remain
- [ ] Theme persists on navigation
- [ ] Theme persists on page reload

---

### 🔄 Auto-Refresh (Comprehensive Check)
- [ ] **Dashboard**:
  - [ ] Toggle enables refresh
  - [ ] Charts update at interval
  - [ ] Data fetches from API
- [ ] **Banks Page**:
  - [ ] Toggle enables refresh
  - [ ] Banks list updates
  - [ ] **Gmail sync triggered** ✅ (NEW)
  - [ ] Console shows "Auto-sync triggered"
  - [ ] New transactions appear
- [ ] **Interval Selection**:
  - [ ] 15 seconds works
  - [ ] 30 seconds works
  - [ ] 60 seconds works
  - [ ] Custom interval works

---

## Backend API Validation

### Test with curl:
```bash
# Health check
curl http://localhost:8000/health

# Login
curl -X POST http://localhost:8000/api/auth/login \
  -d "username=YOUR_USERNAME&password=YOUR_PASSWORD"

# Get token from response, then:
TOKEN="YOUR_ACCESS_TOKEN"

# Banks endpoint
curl http://localhost:8000/api/banks/ \
  -H "Authorization: Bearer $TOKEN"

# Dashboard summary
curl http://localhost:8000/api/dashboard/summary \
  -H "Authorization: Bearer $TOKEN"

# Transactions with bank_type
curl "http://localhost:8000/api/transactions?limit=5" \
  -H "Authorization: Bearer $TOKEN"

# Field mapping
curl http://localhost:8000/api/field-mapping \
  -H "Authorization: Bearer $TOKEN"

# Resync PDFs
curl -X POST http://localhost:8000/api/sync/resync-pdfs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force_all": false}'
```

---

## Validation Checklist Summary

### Critical Features (Must Work):
- [x] Login and authentication
- [x] Dark mode applies everywhere
- [x] Analytics shows data by default
- [x] Analytics filters work
- [x] Banks dropdown populated in all pages
- [x] Multiple sender emails saved and displayed
- [x] Bank type selector works and persists
- [x] Transactions show account type column
- [x] Auto-refresh triggers Gmail sync
- [x] Field mapping loads banks
- [x] Discord notifications send
- [x] All buttons clickable
- [x] All forms submittable
- [x] All dialogs open/close

### Nice-to-Have Features:
- [ ] Smooth animations
- [ ] Loading spinners
- [ ] Success/error toasts
- [ ] Keyboard shortcuts
- [ ] Mobile responsive
- [ ] Export functionality

---

## Common Issues and Solutions

### Issue: Banks dropdown empty
**Solution**: Check API path is `/api/banks/` not `/banks`

### Issue: Dark mode not applying
**Solution**: Ensure no hardcoded backgroundColor in Layout.js

### Issue: Analytics no data
**Solution**: Check useEffect is split - banks load on mount, data loads on filter change

### Issue: Multiple emails not saving
**Solution**: Verify frontend converts comma-separated string to JSON.stringify(array)

### Issue: Discord not sending
**Solution**: 
1. Check DISCORD_WEBHOOK_URL in .env
2. Restart backend: `docker restart finance_tracker_backend`
3. Check Discord webhook is active

### Issue: Auto-refresh not syncing Gmail
**Solution**: Verify startSync() is called in auto-refresh useEffect

### Issue: Bank type not showing
**Solution**: 
1. Check database column exists: `ALTER TABLE banks ADD COLUMN bank_type...`
2. Verify API returns bank_type in transactions endpoint
3. Check frontend displays the column

---

## Test Report Template

```
## UI Validation Report
Date: _______________
Tester: _______________

### Summary
- Total Features Tested: ___
- Passed: ___
- Failed: ___
- Blocked: ___

### Failed Items:
1. ________________
2. ________________

### Notes:
_______________________________
_______________________________

### Screenshots:
- [ ] Dark mode enabled
- [ ] Analytics with filters
- [ ] Transactions with bank_type
- [ ] Bank form with multiple emails
- [ ] Discord notifications
```

---

## Automated Testing

Run the validation script:
```bash
cd /home/tejasvim/personal_files/cred_transaction/backend
python3 -m app.tests.test_validator
```

This will generate a JSON report with all test results.

---

## Final Checklist

Before declaring "ALL WORKING":
- [ ] Can login successfully
- [ ] Dark mode changes ENTIRE page
- [ ] Analytics loads data immediately
- [ ] Can select bank in analytics
- [ ] Filters update charts
- [ ] Can add bank with multiple emails (comma-separated)
- [ ] Can select account type (Savings/Credit/Other)
- [ ] Multiple emails persist after save
- [ ] Transactions table shows "Account Type" column
- [ ] Account type chips colored correctly
- [ ] Auto-refresh triggers Gmail sync (not just UI refresh)
- [ ] Field mapping shows banks dropdown
- [ ] Can select bank in field mapping
- [ ] Resync PDFs button works
- [ ] Discord sends notification on sync
- [ ] Discord shows bank name and counts
- [ ] All pages maintain dark mode
- [ ] All buttons clickable
- [ ] All forms submittable
- [ ] No console errors
- [ ] Backend health check passes

**Sign-off**: ________________  
**Date**: ________________
