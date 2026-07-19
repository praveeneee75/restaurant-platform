const fs=require('fs');
const read=(p)=>fs.readFileSync(p,'utf8');
const server=read('pos-app/backend/server.js');
const billing=read('pos-app/backend/public/js/billing.js');
const admin=read('pos-app/backend/public/js/admin-dashboard.js');
const schema=read('pos-app/backend/services/schema.js');
const kds=read('pos-app/backend/public/js/kds.js');
const kdsHtml=read('pos-app/backend/public/kds.html');
const cloud=read('saas-backend/src/routes/onlineOrdering.js');
const owner=read('saas-backend/public/js/owner-control.js');
const styles=read('pos-app/backend/public/css/style.css');
const billingHtml=read('pos-app/backend/public/billing.html');
const qrHtml=read('saas-backend/public/qr-menu.html');
const qrCss=read('saas-backend/public/css/app.css');
const ownerLogin=read('saas-backend/public/js/owner-login.js');
const compose=read('deploy/compose.yml');
const cases=[
 [billing.includes('qr-approval-actions')&&billing.includes('data-reject-qr'), 'right-aligned approval actions and reject'],
 [server.includes("app.post('/qr/orders/reject'")&&server.includes("'REJECTED'"), 'QR rejection endpoint and cloud status'],
 [schema.includes("qr_ordering_enabled: '1'")&&admin.includes('settingQrOrderingEnabled'), 'QR enable setting'],
 [schema.includes("qr_pending_order_limit: '25'")&&cloud.includes('assertQrOrderingAvailable'), 'pending QR abuse limit locally and in cloud'],
 [server.includes('existingOrder?.id || order.id')&&server.includes('UPDATE order_items SET order_id'), 'same table customer merges into one order with new KOT'],
 [kdsHtml.includes('kitchen-multiselect')&&kds.includes('kitchenIds.join')&&server.includes('selectedKitchenIds'), 'KDS multi-kitchen selector'],
 [owner.includes('AbortController')&&owner.includes('took too long to load')&&owner.includes('finally{refreshButton.disabled=false}'), 'owner loading timeout and recovery'],
 [styles.includes('grid-template-columns:24px minmax(0,1fr)')&&kds.includes('kitchenSelect.open = false'), 'KDS checkbox/text alignment and selector closes'],
 [billingHtml.includes('billingQrEnabled')&&billing.includes("settings:{ qr_ordering_enabled")&&billing.includes('qr_pending_order_limit'), 'Billing QR enable and pending-limit controls persist'],
 [qrHtml.includes('qr-order-fields')&&qrCss.includes('.qr-order-fields label')&&qrCss.includes('text-align:left'), 'QR customer fields are column-wise and left aligned'],
 [ownerLogin.includes('Email is required.')&&ownerLogin.includes('Password is required.')&&ownerLogin.includes('Unable to reach the server'), 'owner login required-field and network validation'],
 [compose.includes('npm run migrate && npm start'), 'production startup applies idempotent database migrations before serving']
];
let failed=0;for(const [ok,name] of cases){console.log(`${ok?'PASS':'FAIL'}: ${name}`);if(!ok)failed++;}if(failed)process.exit(1);console.log(`QR/KDS/owner hardening passed (${cases.length} contracts)`);
