const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('saas-backend/src/db/migrate.js');
const saas = read('saas-backend/src/routes/onlineOrdering.js');
const pos = read('pos-app/backend/server.js');
const qr = read('saas-backend/public/js/qr-public.js');
const qrHtml = read('saas-backend/public/qr-menu.html');

const contracts = [
  ['central customer table', migration.includes('CREATE TABLE IF NOT EXISTS loyalty_customers')],
  ['immutable central ledger', migration.includes('CREATE TABLE IF NOT EXISTS loyalty_ledger')],
  ['organization or tenant scope', migration.includes("scope_type IN ('ORGANIZATION', 'TENANT')")],
  ['idempotency enforced in database', migration.includes('UNIQUE(scope_id, idempotency_key)')],
  ['branch attribution retained', migration.includes('tenant_id UUID NOT NULL REFERENCES tenants')],
  ['atomic customer lock', saas.includes('pg_advisory_xact_lock')],
  ['central redemption balance validation', saas.includes('Insufficient central loyalty balance')],
  ['earning based on settled amount', saas.includes("Math.floor(money(paidAmount) / Number(program.earn_amount")],
  ['POS settlement calls central ledger', pos.includes("settleCentralLoyalty(db, restaurantId")],
  ['POS blocks when SaaS unavailable', pos.includes('Rewards require an internet connection')],
  ['POS local ledger remains idempotent mirror', pos.includes("type = 'REDEEM' LIMIT 1")],
  ['QR central status lookup', qr.includes('/loyalty-status')],
  ['QR requires new-customer consent', qr.includes('Rewards consent is required for a new customer')],
  ['QR sends consent to SaaS', qr.includes('loyaltyConsent: state.loyaltyExisting || qrLoyaltyConsent.checked')],
  ['QR explains settlement-only earning', saas.includes('after settlement')],
  ['QR explains cashier redemption', saas.includes('redeemed by the cashier during billing')],
  ['QR consent control present', qrHtml.includes('id="qrLoyaltyConsent"')]
];

for (const [name, ok] of contracts) assert.ok(ok, `Missing contract: ${name}`);
console.log(`Central loyalty regression passed (${contracts.length} contracts).`);
