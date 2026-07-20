const fs = require('fs');
const path = require('path');
const http = require('http');

const dataDir = path.join(__dirname, '..', '.codex-invoice-reprint-test');
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = dataDir;
process.env.PORT = '3415';
process.env.POS_HEARTBEAT_DISABLED = '1';
const restaurantId = 'RESTOWHITELABEL';
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
setupDatabase(restaurantId);
const db = openDatabase(restaurantId);
db.prepare("INSERT INTO orders (order_type, status, payment_status, invoice_no, total_amount, paid_amount) VALUES ('TAKEAWAY','PAID','PAID','TEST-REPRINT-1',100,100)").run();
db.close();
require('../pos-app/backend/server');

function request(url, body) {
  const payload = JSON.stringify({ restaurantId, ...body });
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname:'127.0.0.1', port:3415, path:url, method:'POST', headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload)} }, (res) => {
      let text=''; res.on('data',(chunk)=>{text+=chunk;}); res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));
    });
    req.on('error',reject); req.end(payload);
  });
}

(async()=>{
  await new Promise((resolve)=>setTimeout(resolve,350));
  const owner={id:1,name:'Owner',role:'OWNER'};
  const cashier={id:2,name:'Cashier',role:'CASHIER'};
  const configured=await request('/printer-security/reprint-pin',{actor:owner,pin:'654321'});
  const denied=await request('/orders/invoices/1/reprint',{actor:cashier,pin:'111111'});
  const first=await request('/orders/invoices/1/reprint',{actor:cashier,pin:'654321'});
  const second=await request('/orders/invoices/1/reprint',{actor:owner});
  if(configured.status!==200||denied.status<400||first.data.reprintNumber!==1||second.data.reprintNumber!==2) throw new Error(JSON.stringify({configured,denied,first,second}));
  console.log(JSON.stringify({success:true,cashierWrongPinRejected:true,cashierPinAccepted:true,sequentialReprints:[first.data.reprintNumber,second.data.reprintNumber]}));
  process.exit(0);
})().catch((error)=>{console.error(error);process.exit(1);});
