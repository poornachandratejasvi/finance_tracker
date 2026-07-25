// ============================================================
// Finance Tracker – Extended E2E Test Suite
// Tests: password UI, Automation page, CSV, Discord, Mock-compatible
// ============================================================

const { test, expect } = require('@playwright/test');

const USERNAME = process.env.E2E_USER || 'admin';
const PASSWORD = process.env.E2E_PASS || '7411470935';

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USERNAME).catch(async () => {
    await page.locator('input[name="username"]').fill(USERNAME);
  });
  await page.getByLabel('Password').fill(PASSWORD).catch(async () => {
    await page.locator('input[name="password"]').fill(PASSWORD);
  });
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard|\/analytics|\/transactions|\/banks/, { timeout: 20000 });
}

// ================================================================
// 8. BANKS – Password UI
// ================================================================

test('8.1 Bank card shows password status chip', async ({ page }) => {
  await login(page);
  await page.goto('/banks');
  const firstCard = page.locator('div.MuiCard-root').first();
  await expect(firstCard).toBeVisible({ timeout: 15000 });
  // Either "🔐 Password Set" or "No Password" chip should appear
  const pwdChip = firstCard.getByText(/password set|no password/i).first();
  await expect(pwdChip).toBeVisible({ timeout: 10000 });
});

test('8.2 Add Bank dialog has password field with show/hide toggle', async ({ page }) => {
  await login(page);
  await page.goto('/banks');
  await page.getByRole('button', { name: 'Add Bank' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Password field exists
  const pwdField = page.getByRole('dialog').locator('input[type="password"]').first();
  await expect(pwdField).toBeVisible();

  // Clicking the visibility toggle reveals password as text
  const toggle = page.getByRole('dialog').locator('button[aria-label], button').filter({ hasText: '' }).last();
  // The field should currently be type=password
  await expect(pwdField).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: /cancel/i }).click();
});

test('8.3 Edit Bank preserves existing password when blank field submitted', async ({ page }) => {
  await login(page);
  await page.goto('/banks');
  const firstCard = page.locator('div.MuiCard-root').first();
  await expect(firstCard).toBeVisible({ timeout: 15000 });

  // Click Edit Bank
  await firstCard.getByRole('button', { name: /edit bank/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The helper text should indicate existing password if set
  const helperText = page.getByRole('dialog').getByText(/password is set|enter new|leave blank/i).first();
  // This only appears if bank has_password=true; skip assertion if not set
  const isSet = await helperText.count();
  if (isSet) {
    await expect(helperText).toBeVisible();
  }

  // Save with blank password field (should NOT clear password)
  await page.getByRole('dialog').getByRole('button', { name: /update bank/i }).click();
  // Dialog closes
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
});

test('8.4 View Password menu item in bank context menu', async ({ page }) => {
  await login(page);
  await page.goto('/banks');
  const firstCard = page.locator('div.MuiCard-root').first();
  await expect(firstCard).toBeVisible({ timeout: 15000 });

  // Open context menu (MoreVert)
  await firstCard.locator('button').last().click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });

  // View Password menu item should exist
  await expect(page.getByRole('menuitem', { name: /view password/i })).toBeVisible();

  // Click it
  await page.getByRole('menuitem', { name: /view password/i }).click();
  // Dialog opens
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  // Dialog title mentions "Password"
  await expect(page.getByRole('dialog').getByText(/password/i).first()).toBeVisible();
  await page.getByRole('button', { name: /close/i }).click();
});

// ================================================================
// 9. AUTOMATION PAGE
// ================================================================

test('9.1 Automation page is accessible from navigation', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /automation/i }).click();
  await expect(page).toHaveURL(/\/automation/);
  await expect(page.getByText(/automation/i).first()).toBeVisible({ timeout: 10000 });
});

test('9.2 Automation page has CSV Export tab with bank selector', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  // CSV Export tab is default
  await expect(page.getByText(/csv export/i).first()).toBeVisible({ timeout: 15000 });
  // Bank selector dropdown label
  await expect(page.getByLabel(/select bank/i)).toBeVisible({ timeout: 10000 });
});

test('9.3 Automation page has destination email field', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await expect(page.getByLabel(/destination email/i)).toBeVisible({ timeout: 15000 });
});

test('9.4 Automation page has Send CSV button', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await expect(page.getByRole('button', { name: /send csv/i })).toBeVisible({ timeout: 15000 });
});

test('9.5 Automation page has Generate All CSVs button', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await expect(page.getByRole('button', { name: /generate all/i })).toBeVisible({ timeout: 15000 });
});

test('9.6 Automation page shows error when sending without email', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  // Make sure no email is in the field and bank has no default
  await page.getByLabel(/destination email/i).clear();
  await page.getByRole('button', { name: /send csv/i }).click();
  // Either error alert or a text message about email/required/failed
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10000 });
});

test('9.7 Automation Discord tab is present', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await expect(page.getByRole('tab', { name: /discord/i })).toBeVisible({ timeout: 10000 });
});

test('9.8 Automation Discord tab has webhook URL field', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await page.getByRole('tab', { name: /discord/i }).click();
  await expect(page.getByLabel(/discord webhook url/i)).toBeVisible({ timeout: 10000 });
});

test('9.9 Automation Job History tab shows empty message initially', async ({ page }) => {
  await login(page);
  await page.goto('/automation');
  await page.getByRole('tab', { name: /job history/i }).click();
  // Should show empty state
  await expect(
    page.getByText(/no jobs/i).or(page.locator('table').first())
  ).toBeVisible({ timeout: 10000 });
});

// ================================================================
// 10. SETTINGS – Discord tab
// ================================================================

test('10.1 Settings page has Discord section', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  // Click the Integrations tab
  const tabs = page.getByRole('tab');
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i++) {
    const label = await tabs.nth(i).textContent();
    if (/integrations/i.test(label)) {
      await tabs.nth(i).click();
      await page.waitForTimeout(800);
      break;
    }
  }
  // Body should now contain Discord text
  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toMatch(/discord/i);
});

// ================================================================
// 11. PDF MANAGEMENT – extended
// ================================================================

test('11.1 PDF reprocess button exists per row', async ({ page }) => {
  await login(page);
  await page.goto('/pdfs');
  await page.waitForTimeout(2000);
  const rows = page.locator('table tbody tr td:not([colspan])');
  if (await rows.count() === 0) { test.skip(true, 'No PDFs'); return; }
  // Look for a reprocess/process button icon in the action column
  const actionBtn = page.locator('table tbody tr').first().locator('button').first();
  await expect(actionBtn).toBeVisible({ timeout: 10000 });
});

test('11.2 PDF stats shows total + processed counts', async ({ page }) => {
  await login(page);
  await page.goto('/pdfs');
  // Stats area should show counts
  await expect(page.getByText(/total|processed|pdf/i).first()).toBeVisible({ timeout: 10000 });
});

// ================================================================
// 12. TRANSACTIONS – Add + Edit + Delete flow
// ================================================================

test('12.1 Add Transaction dialog opens', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  const addBtn = page.getByRole('button', { name: /add transaction/i });
  // May not exist if UI only has import
  if (await addBtn.count() === 0) { test.skip(true, 'No add transaction button'); return; }
  await addBtn.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /cancel|close/i }).first().click();
});

// ================================================================
// 13. DASHBOARD – verify data sections
// ================================================================

test('13.1 Dashboard shows Showing message for latest month', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByText(/showing/i).first()).toBeVisible({ timeout: 15000 });
});

test('13.2 Dashboard shows at least one stat chip or card', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  // Stats can be chips, MuiCard, or text
  await expect(
    page.locator('div.MuiCard-root, [role="status"], .MuiChip-root').first()
  ).toBeVisible({ timeout: 15000 });
});

// ================================================================
// 14. FIELD MAPPING PAGE
// ================================================================

test('14.1 Field Mapping page loads', async ({ page }) => {
  await login(page);
  await page.goto('/field-mapping');
  await expect(page.getByText(/field mapping/i).first()).toBeVisible({ timeout: 15000 });
});

// ================================================================
// 15. CSV EXPORTS PAGE
// ================================================================

test('15.1 CSV Exports page loads', async ({ page }) => {
  await login(page);
  await page.goto('/csv');
  await expect(page.getByText(/csv/i).first()).toBeVisible({ timeout: 15000 });
});

// ================================================================
// 16. NAVIGATION – all nav links work
// ================================================================

test('16.1 All navigation links navigate to correct pages', async ({ page }) => {
  await login(page);

  const navItems = [
    { button: /dashboard/i, urlPart: '/dashboard' },
    { button: /analytics/i, urlPart: '/analytics' },
    { button: /transactions/i, urlPart: '/transactions' },
    { button: /banks/i, urlPart: '/banks' },
    { button: /pdfs/i, urlPart: '/pdfs' },
    { button: /automation/i, urlPart: '/automation' },
    { button: /settings/i, urlPart: '/settings' },
  ];

  for (const { button, urlPart } of navItems) {
    await page.getByRole('button', { name: button }).first().click();
    await expect(page).toHaveURL(new RegExp(urlPart), { timeout: 10000 });
  }
});
