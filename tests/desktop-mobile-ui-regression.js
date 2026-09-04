const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const adminHtml = read('pos-app/backend/public/admin.html');
const adminJs = read('pos-app/backend/public/js/admin-dashboard.js');
const customerHtml = read('pos-app/backend/public/customer.html');
const style = read('pos-app/backend/public/css/style.css');
const waiterHtml = read('pos-app/backend/public/waiter.html');
const waiterJs = read('pos-app/backend/public/js/waiter.js');
const waiterCss = read('pos-app/backend/public/css/waiter.css');
const server = read('pos-app/backend/server.js');
const schema = read('pos-app/backend/services/schema.js');
const posHtml = read('pos-app/backend/public/pos-live.html');
const posJs = read('pos-app/backend/public/js/pos-live.js');
const billingHtml = read('pos-app/backend/public/billing.html');
const billingJs = read('pos-app/backend/public/js/billing.js');
const customerJs = read('pos-app/backend/public/js/customer.js');
const preload = read('pos-app/electron/preload.js');
const electron = read('pos-app/electron/main.js');
const loginJs = read('pos-app/backend/public/js/login.js');

const cases = [
  [adminJs.includes('await window.appConfirm(`Refund ${money(amount)}') && adminJs.includes('amount > remainingPaid') && !adminJs.includes('window.confirm(`Refund'), 'invoice refund uses focus-safe confirmation and the remaining refundable balance'],
  [style.includes('.admin-nav .nav-link {') && style.includes('text-decoration: none;'), 'admin links do not acquire browser underlines'],
  [style.includes('.admin-category-btn * { text-decoration: none !important; }') && style.includes('.admin-category-btn:visited'), 'all main admin category button states suppress underlines'],
  [style.includes('.invoice-detail-actions, .action-cell { column-gap:10px; row-gap:8px; }'), 'desktop action groups keep horizontal and vertical spacing'],
  [adminHtml.includes('data-nav-category="rewards"') && adminHtml.includes('data-nav-group="rewards"') && adminHtml.includes('data-settings-section="promos"') && adminHtml.includes('data-settings-section="reward-points"') && adminHtml.includes('data-settings-section="loyalty-program"'), 'Reward Management contains Promo Codes, Reward Points and Loyalty Program'],
  [!customerHtml.includes('loyaltySettingsForm') && adminHtml.includes('id="saveRewardPointSettings"'), 'reward point settings are removed from Customer Management and moved to Reward Management'],
  [schema.includes('CREATE TABLE IF NOT EXISTS loyalty_rules') && schema.includes('CREATE TABLE IF NOT EXISTS loyalty_rule_redemptions') && adminHtml.includes('id="saveLoyaltyRule"') && adminJs.includes('async function loadLoyaltyRules()'), 'Loyalty Program provides persisted rule management rather than design guidance'],
  [adminJs.includes('(state.admin?.items || [])') && adminJs.includes('(state.admin?.categories || [])') && !adminJs.includes('const itemOptions = (state.items || [])'), 'loyalty product and category selectors use the populated Admin bootstrap state'],
  [server.includes('function syncLoyaltyProgramDiscount') && server.includes("type = 'LOYALTY_PROGRAM'") && server.includes("syncLoyaltyProgramDiscount(db, id)") && server.includes('INSERT OR IGNORE INTO loyalty_rule_redemptions'), 'eligible loyalty benefits apply automatically and milestone use is recorded at settlement'],
  [waiterHtml.includes('id="cancelOrderDialog"') && waiterJs.includes('requestCancellationPin()') && waiterJs.includes('forcePin: true') && server.includes("UPPER(role) IN ('OWNER', 'ADMIN', 'MANAGER', 'MANAGER_1', 'MANAGER_2')") && !server.includes("configure the six-digit cancellation PIN first"), 'submitted mobile KOT cancellation uses an owner or manager login PIN rather than the unrelated invoice-reprint PIN'],
  [waiterJs.includes('const customerDraft = { phone: waiterCustomerPhone.value, name: waiterCustomerName.value };') && waiterJs.includes('waiterCustomerPhone.value = customerDraft.phone;'), 'mobile refresh preserves unsaved customer phone and name drafts'],
  [waiterHtml.includes('id="lockStatus" hidden aria-hidden="true"'), 'internal table-lock expiry is hidden from waiter users'],
  [(waiterJs.match(/waiterItemSearch\.value = "";/g) || []).length >= 2, 'item search is cleared when starting or returning from an order'],
  [waiterCss.includes('min-width:78px') && waiterCss.includes('white-space:nowrap') && waiterCss.includes('grid-template-columns:repeat(2,minmax(78px,auto))'), 'mobile Refresh and Logout retain stable readable widths'],
  [(waiterCss.match(/max\(22px,env\(safe-area-inset-bottom\)\)/g) || []).length === 3, 'all mobile bottom action bars clear Android gesture and three-button navigation'],
  [waiterCss.includes('.customer-controls { grid-template-columns:minmax(0,1fr) auto; align-items:end; }'), 'customer phone/search and name/create controls stay aligned']
  ,[server.includes("code: 'DRAFT_ITEMS_REQUIRE_DECISION'") && server.includes("['PROCEED', 'DISCARD'].includes(action)") && server.includes("'ORDER_DRAFT_ITEMS'") && server.includes("app.get('/orders/final-bill-readiness'"), 'Final Bill requires an explicit server-enforced decision when saved non-KOT items exist']
  ,[posHtml.includes('id="discardPosConfirm"') && posJs.includes('function askFinalBillDraftDecision') && posJs.includes('draftItemAction === "CANCEL"') && posJs.includes("postJson('/orders/final-bill', { orderId: state.orderId, draftItemAction })") && posJs.includes('async function fetchJson(url)') && posJs.includes('requestFinalBillAndPrint().catch((error) =>'), 'desktop POS loads readiness, offers Proceed, Discard and Cancel, and surfaces Final Bill failures']
  ,[posJs.includes('returnsToBilling || ["PARCEL", "PARTY"].includes(posMode)') && !posJs.includes('else if (["DINE_IN", "PARCEL", "PARTY"].includes(posMode))'), 'Submit KOT stays in normal Dine In and returns to Billing only for Parcel, Party, or Billing-launched Dine In']
  ,[waiterHtml.includes('id="finalBillDraftDialog"') && waiterJs.includes('function requestFinalBillDraftDecision') && waiterJs.includes('draftItemAction === "CANCEL"') && waiterJs.includes('draftItemAction });'), 'mobile POS offers the same Proceed, Discard and Cancel Final Bill decision']
  ,[waiterHtml.includes('id="finalCheckReviewDialog"') && waiterJs.includes('function requestFinalCheckReview()') && waiterJs.includes('["Dine In"') && waiterJs.includes('["Parcel"') && waiterJs.includes('if (!await requestFinalCheckReview()) return;'), 'mobile Final Check shows a confirm-or-go-back item review grouped by Dine In and Parcel']
  ,[posJs.includes('else if (kotStatus.textContent.startsWith("Final bill requested —"))') && /state\.orderReference = null;\s*state\.billingReady = false;\s*state\.dirty = false;/.test(posJs), 'available-table and new-check selection clear stale final-bill lock state and message']
  ,[adminHtml.includes('id="syncRestaurantProfile"') && adminJs.includes('window.posDesktop.refreshLicense()') && preload.includes("refreshLicense: () => ipcRenderer.invoke('pos:refresh-license')") && electron.includes("ipcMain.handle('pos:refresh-license'"), 'Restaurant Profile exposes secure cloud synchronization through the desktop license-validation bridge']
  ,[customerHtml.includes('id="customerSearch"') && customerHtml.includes('id="searchCustomers"') && customerJs.includes('function filteredCustomers()') && customerJs.includes('searchCustomers.addEventListener'), 'Customer CRM provides explicit name, phone and email search']
  ,[customerHtml.includes('id="crmExecutiveSummary"') && customerHtml.includes('CUSTOMER 360') && customerJs.includes('function renderExecutiveSummary()') && customerJs.includes('Loyalty Ledger') && customerJs.includes('Earned / redeemed'), 'Customer CRM provides executive KPIs and an individual loyalty view']
  ,[posJs.includes('const startsNewParcelCheck = !state.orderId || state.billingReady;') && posJs.includes('New parcel customer check started for this table') && server.includes('Boolean(linkedFulfillment && isPositiveId(tableId))'), 'desktop Dine In starts an independent parcel check when the selected table check is final-bill locked']
  ,[billingHtml.indexOf('id="retailBillingNavigation"') < billingHtml.indexOf('id="transferBillingOrder"') && billingHtml.includes('href="/retail.html"') && billingJs.includes('retail_counter_enabled') && billingJs.includes('retailNavigation.hidden'), 'Billing keeps a Retail Counter navigation control before Transfer and only exposes it when the optional service is enabled']
  ,[server.includes("app.post('/orders/merge-bills'") && server.includes("app.post('/orders/unlock-billing'") && server.includes("status = 'MERGED'") && schema.includes("addColumn(db, 'orders', 'merge_parent_id INTEGER')"), 'billing provides persisted merge relationships and ready-order unlock']
  ,[adminHtml.includes('data-nav-category="kds"') && adminHtml.includes('id="settingKdsClearSettledOnNewBusinessDay"') && adminHtml.includes('id="settingKdsOfflineClearHours"') && schema.includes("addColumn(db, 'kots', 'archived_at DATETIME')"), 'Admin KDS provides configurable new-business-day settled-order cleanup']
  ,[server.includes("ksub.archived_at IS NULL") && server.includes("'ARCHIVE', 'KDS_BUSINESS_DAY'") && server.includes("SELECT id FROM orders WHERE payment_status = 'PAID' OR status = 'PAID'"), 'KDS cleanup archives only display KOTs for settled orders without changing financial orders']
  ,[loginJs.includes('localStorage.setItem("lastUsername", username)') && loginJs.includes('localStorage.getItem("lastUsername")'), 'successful desktop login remembers and restores the last username']
  ,[server.includes('Number(sourceOrder.billing_ready || 0)') && server.includes('billing_ready = ?, updated_at = CURRENT_TIMESTAMP'), 'split bills inherit the parent ready-for-billing state']
  ,[waiterJs.includes('if (!state.orderId || state.billingReady) {') && waiterJs.includes('state.fulfillmentType = "TAKEAWAY";') && waiterJs.includes('postJson("/orders/lock", { tableId: state.selectedTable.id })'), 'mobile Dine In starts an independent parcel check when the selected table check is final-bill locked']
  ,[(posJs.match(/if \(isDineIn\(\) && !state\.selectedTable\) return alert\("Select a table before adding items"\);/g) || []).length >= 3 && posJs.includes('const itemEntryDisabled = state.billingReady || (isDineIn() && !state.selectedTable);'), 'Dine In disables item tiles and centrally rejects item entry until a table is selected']
];

let failures = 0;
for (const [passed, name] of cases) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  if (!passed) failures += 1;
}
if (failures) process.exit(1);
console.log(`Desktop/mobile UI regression passed (${cases.length} contracts)`);
