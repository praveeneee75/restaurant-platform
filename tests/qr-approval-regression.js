const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=read('pos-app/backend/server.js');const cloud=read('saas-backend/src/routes/onlineOrdering.js');const qr=read('saas-backend/public/js/qr-public.js');const billing=read('pos-app/backend/public/js/billing.js');
const checks=[
 [server.includes('QR submission merged into order #')&&!server.includes("db.prepare('DELETE FROM orders WHERE id = ?').run(order.id)"), 'same-customer QR submissions merge without deleting the history-referenced source order'],
 [server.includes("status = 'PLACED'")&&server.includes('WHEN COALESCE(price, 0) <= 0'), 'legacy imported QR lines recover their menu price and KOT-ready status during merge'],
 [server.includes("writeOrderStatusHistory(db, actor, orderId, 'CANCELLED'")&&!server.includes("UPDATE orders SET status = 'CANCELLED', notes ="), 'QR rejection records its reason without requiring a legacy-missing orders.notes column'],
 [cloud.includes("field: 'customerName'")&&cloud.includes("field: 'customerPhone'")&&cloud.includes('^\\d{10}$'), 'server-side QR customer validation'],
 [qr.includes('qrCustomerNameError.textContent')&&qr.includes('qrCustomerPhoneError.textContent')&&qr.includes("aria-invalid"), 'visible inline QR validation'],
 [server.includes("isQrDineIn ? 'PENDING_QR' : 'OPEN'")&&server.includes("isQrDineIn ? 'QR' : 'SAAS_ONLINE'"), 'internet QR import waits for approval'],
 [server.includes("UPDATE tables SET status = 'OCCUPIED'")&&server.indexOf("UPDATE tables SET status = 'OCCUPIED'")>server.indexOf("app.post('/qr/orders/approve'"), 'table becomes occupied only on approval'],
 [server.includes('kotResult = createKotJobs(db, targetOrderId)')&&server.includes('APPROVE_QR_ORDER'), 'approval creates KOT and audit'],
 [billing.includes('pendingQrApprovals.innerHTML')&&billing.includes('data-approve-qr')&&billing.includes('Approve & send KOT'), 'billing approval panel'],
 [read('pos-app/backend/public/js/nav-notifications.js').includes('/qr/orders/pending'), 'QR approval notification badge'],
 [server.includes('runSaasOrderImportTick().catch')&&server.includes('setInterval(runSaasOrderImportTick, 10 * 1000)'), 'internet orders automatically reach local approval queue']
];
for(const [ok,label] of checks){if(!ok)throw new Error(`Missing QR regression contract: ${label}`);console.log(`PASS: ${label}`)}console.log(`QR approval regression passed (${checks.length} contracts)`);
