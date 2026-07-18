const fs = require('fs');
const path = require('path');
const http = require('http');

const testDataDir = path.join(__dirname, '..', '.codex-pos-kot-sequence-test');
fs.rmSync(testDataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = testDataDir;
process.env.PORT = '3403';
process.env.POS_HEARTBEAT_DISABLED = '1';
const actor = { id: 1, role: 'OWNER' };
const restaurantId = 'RESTOWHITELABEL';
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
const { seedWhitelabelDemoData } = require('../pos-app/backend/services/whitelabelDemoSeed');
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force: true });
seedDb.close();
require('../pos-app/backend/server');

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port: 3403, path: url, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function post(url, body) {
  const response = await request('POST', url, { restaurantId, actor, ...body });
  if (response.status >= 400 || response.data.success === false) throw new Error(`${url}: ${JSON.stringify(response.data)}`);
  return response.data;
}

(async () => {
  const bootstrap = await request('GET', `/pos/bootstrap?restaurantId=${restaurantId}`);
  const table = bootstrap.data.tables.find((row) => row.status === 'AVAILABLE') || bootstrap.data.tables[0];
  const menuItems = bootstrap.data.items.slice(0, 2);
  if (menuItems.length < 2) throw new Error(`Test database needs two active items; received ${JSON.stringify(bootstrap.data)}`);
  const first = await post('/orders/save', { orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name, items: [{ itemId: menuItems[0].id, quantity: 1, notes: 'No onion', modifiers: [] }] });
  await post('/orders/submit-kot', { orderId: first.orderId });
  const openAfterFirst = await request('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${first.orderId}`);
  const original = openAfterFirst.data.items[0];
  const afterFirstDb = openDatabase(restaurantId);
  const firstJobs = afterFirstDb.prepare("SELECT id, payload FROM print_jobs WHERE type = 'KOT' AND ref_id = ? ORDER BY id").all(first.orderId);
  afterFirstDb.close();
  if (firstJobs.length === 0) throw new Error('First KOT did not create a print job');
  if (!JSON.parse(firstJobs[0].payload).items?.some((item) => item.notes === 'No onion')) throw new Error('Item special note was not preserved in the KOT print payload');
  const pendingPrintJobs = await request('GET', `/print-jobs/pending?restaurantId=${restaurantId}`);
  if (!pendingPrintJobs.data.jobs?.some((job) => Number(job.id) === Number(firstJobs[0].id))) throw new Error('Desktop print worker cannot retrieve the queued KOT');

  // Saving an already-submitted order must never create or resend a KOT.
  await post('/orders/save', { orderId: first.orderId, orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name, items: [
    { orderItemId: original.order_item_id, itemId: original.id, quantity: original.quantity, notes: original.notes, modifiers: [] }
  ] });
  const afterUnchangedSaveDb = openDatabase(restaurantId);
  const unchangedJobCount = afterUnchangedSaveDb.prepare("SELECT COUNT(*) AS total FROM print_jobs WHERE type = 'KOT' AND ref_id = ?").get(first.orderId).total;
  afterUnchangedSaveDb.close();
  if (unchangedJobCount !== firstJobs.length) throw new Error('Saving an already-submitted order created another KOT print job');

  const second = await post('/orders/save', { orderId: first.orderId, orderType: 'DINE_IN', tableId: table.id, tableName: table.table_name, items: [
    { orderItemId: original.order_item_id, itemId: original.id, quantity: original.quantity, notes: original.notes, modifiers: [] },
    { itemId: menuItems[1].id, quantity: 1, modifiers: [] }
  ] });
  const afterDraftSave = await request('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${first.orderId}`);
  const draft = afterDraftSave.data.items.find((item) => !item.kot_id);
  if (!draft || Number(draft.id) !== Number(menuItems[1].id)) throw new Error('New saved line was not retained as an unsubmitted draft');
  const afterDraftSaveDb = openDatabase(restaurantId);
  const draftSaveJobCount = afterDraftSaveDb.prepare("SELECT COUNT(*) AS total FROM print_jobs WHERE type = 'KOT' AND ref_id = ?").get(first.orderId).total;
  afterDraftSaveDb.close();
  if (draftSaveJobCount !== firstJobs.length) throw new Error('Save sent draft lines to KOT before Submit KOT was clicked');

  await post('/orders/submit-kot', { orderId: second.orderId });
  const finalOrder = await request('GET', `/orders/open?restaurantId=${restaurantId}&orderId=${first.orderId}`);
  const submitted = finalOrder.data.items.filter((item) => item.kot_id);
  if (submitted.length !== 2) throw new Error(`Expected two submitted lines, got ${submitted.length}`);
  const finalDb = openDatabase(restaurantId);
  const allJobs = finalDb.prepare("SELECT id, payload FROM print_jobs WHERE type = 'KOT' AND ref_id = ? ORDER BY id").all(first.orderId);
  finalDb.close();
  const secondSubmissionItems = allJobs.slice(firstJobs.length).flatMap((job) => JSON.parse(job.payload).items || []);
  if (secondSubmissionItems.length === 0) throw new Error('Second KOT created no printable items');
  if (secondSubmissionItems.some((item) => Number(item.order_item_id) === Number(original.order_item_id))) {
    throw new Error('Second KOT resent an item from the first KOT');
  }
  if (!secondSubmissionItems.some((item) => Number(item.order_item_id) === Number(draft.order_item_id))) {
    throw new Error('Second KOT omitted the newly saved draft item');
  }
  const printerDb = openDatabase(restaurantId);
  printerDb.prepare("INSERT INTO printers (name, type, connection, address, active) VALUES ('Regression USB Bill', 'BILL', 'USB', 'Regression USB Bill', 1)").run();
  printerDb.close();
  const payable = submitted.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const settlement = await post('/orders/settle', { orderId: first.orderId, payments: [{ method: 'CASH', amount: payable }], printBill: true });
  if (!settlement.printQueued) throw new Error('Settle & Print did not queue the configured BILL printer');
  const printedDb = openDatabase(restaurantId);
  const billJob = printedDb.prepare("SELECT payload FROM print_jobs WHERE type = 'BILL' AND ref_id = ? ORDER BY id DESC LIMIT 1").get(first.orderId);
  printedDb.close();
  const billPayload = JSON.parse(billJob?.payload || '{}');
  if (!billPayload.restaurantProfile?.gstin || !billPayload.restaurantProfile?.fssaiLicenseNo) throw new Error('Bill print payload omitted GSTIN or FSSAI');
  if (!billPayload.kotReferences) throw new Error('Bill print payload omitted KOT numbers');
  const invoice = await request('GET', `/orders/invoices/${first.orderId}?restaurantId=${restaurantId}`);
  if (!invoice.data.invoice?.kot_references) throw new Error('Invoice detail omitted KOT numbers');
  console.log(JSON.stringify({ success: true, orderId: first.orderId, submittedLines: submitted.length, saveCreatedKot: false, secondKotOnlyNewLines: true, billPrintQueued: true, complianceFieldsIncluded: true, kotReferencesIncluded: true }));
  process.exit(0);
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
