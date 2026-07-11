import { chromium } from '@playwright/test';

const baseURL = process.env.SHEETBASE_SMOKE_URL ?? 'http://127.0.0.1:18081';
const email = process.env.SHEETBASE_SMOKE_EMAIL ?? 'garethprice@me.com';
const password = process.env.SHEETBASE_SMOKE_PASSWORD ?? 'sheetbase8';
const runID = Date.now().toString(36);
const formName = `Smoke ${runID}`;
const stencilName = `stencil_${runID}`;
const company = `Acme ${runID}`;
const domain = `${runID}.example.test`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  if (await page.getByLabel(/email/i).count()) {
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForLoadState('networkidle');
  }

  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByLabel('Sheet Form name').fill(formName);
  await renameColumn(page, 'Field 1', 'Company');
  await renameColumn(page, 'Field 2', 'Domain');
  await setCell(page, 0, 0, company);
  await setCell(page, 0, 1, domain);
  await page.getByRole('button', { name: 'Save' }).click();

  const forms = await apiEventually(page, `/api/sheet_forms?name=eq.${encodeURIComponent(formName)}&select=generated_table_name`, (value) => value[0]?.generated_table_name);
  const tableName = forms[0]?.generated_table_name;
  if (!tableName) throw new Error(`saved form not found: ${formName}`);

  const rows = await apiEventually(page, `/api/${encodeURIComponent(tableName)}?domain=eq.${encodeURIComponent(domain)}&select=*`, (value) => value[0]?.company === company);
  if (rows[0]?.company !== company) {
    throw new Error(`saved row not found in ${tableName}`);
  }

  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${stencilName}.stencil.yaml`,
    mimeType: 'text/yaml',
    buffer: Buffer.from(`
name: ${stencilName}
versions:
  "v1.0":
    fields:
      full_name: { cell: A2 }
      contacts:
        range: A10:C
        type: table
        columns:
          A: Email
          B: Company
`),
  });
  await waitForColumnHeader(page, 0, 'Full Name');
  await page.getByRole('button', { name: 'Save' }).click();

  const stencilForms = await apiEventually(page, `/api/sheet_forms?name=eq.${encodeURIComponent(stencilName)}&select=id,generated_table_name`, (value) => value[0]?.generated_table_name);
  const stencilForm = stencilForms[0];
  if (!stencilForm?.generated_table_name) throw new Error(`saved Stencil form not found: ${stencilName}`);

  const stencilFields = await api(page, `/api/sheet_fields?sheet_form_id=eq.${stencilForm.id}&select=name,column_name&order=position.asc`);
  const stencilColumns = stencilFields.map((field) => field.column_name).join(',');
  if (stencilColumns !== 'full_name,email,company') {
    throw new Error(`unexpected Stencil columns: ${stencilColumns}`);
  }
  await api(page, `/api/${encodeURIComponent(stencilForm.generated_table_name)}?select=full_name,email,company&limit=1`);

  console.log(`browser smoke passed: ${formName} -> ${tableName}; ${stencilName} -> ${stencilForm.generated_table_name}`);
} finally {
  await browser.close();
}

async function renameColumn(page, currentName, nextName) {
  await page.getByRole('columnheader', { name: currentName, exact: true }).first().dblclick();
  const input = page.getByRole('textbox', { name: `Edit ${currentName} column header` });
  await input.fill(nextName);
  await input.press('Enter');
}

async function setCell(page, rowIndex, columnIndex, value) {
  const row = page.locator('.ht_master .htCore tbody tr').nth(rowIndex);
  await row.locator('td').nth(columnIndex).dblclick();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

async function api(page, path) {
  const response = await page.request.get(new URL(path, baseURL).toString());
  if (!response.ok()) {
    throw new Error(`${path} failed: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function apiEventually(page, path, done) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 15000) {
    last = await api(page, path);
    if (done(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`${path} did not become ready: ${JSON.stringify(last)}`);
}

async function waitForColumnHeader(page, columnIndex, value) {
  await page.waitForFunction(({ columnIndex: column, expected }) => {
    const header = document.querySelectorAll('.ht_clone_top .htCore thead th .colHeader')[column];
    return header?.textContent?.trim() === expected;
  }, { columnIndex, expected: value });
}
