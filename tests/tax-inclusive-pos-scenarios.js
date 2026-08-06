const fs = require('fs');
const path = require('path');
const http = require('http');

const testDataDir = path.join(__dirname, '..', '.codex-tax-inclusive-pos-test');
fs.rmSync(testDataDir, { recursive: true, force: true });
process.env.POS_DATA_DIR = testDataDir;
process.env.PORT = '3404';
process.env.POS_HEARTBEAT_DISABLED = '1';
const restaurantId = 'RESTOTAXDISPLAY';
const actor = { id: 1, role: 'OWNER' };
const { setupDatabase } = require('../pos-app/backend/services/dbSetup');
const { openDatabase } = require('../pos-app/backend/db/database');
const { seedWhitelabelDemoData } = require('../pos-app/backend/services/whitelabelDemoSeed');
setupDatabase(restaurantId);
const seedDb = openDatabase(restaurantId);
seedWhitelabelDemoData(seedDb, { restaurantId, force: true });
seedDb.prepare("INSERT INTO system_config (key,value) VALUES ('tax_rate','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
const exclusive = seedDb.prepare('SELECT id FROM items ORDER BY id LIMIT 1').get();
seedDb.prepare("UPDATE items SET price=60, tax_mode='EXCLUSIVE' WHERE id=?").run(exclusive.id);
const inclusive = seedDb.prepare('SELECT id FROM items WHERE id<>? ORDER BY id LIMIT 1').get(exclusive.id);
seedDb.prepare("UPDATE items SET price=35, tax_mode='INCLUSIVE' WHERE id=?").run(inclusive.id);
const table = seedDb.prepare('SELECT id,table_name FROM tables ORDER BY id LIMIT 1').get();
seedDb.close();
require('../pos-app/backend/server');

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname:'127.0.0.1', port:3404, path:url, method, headers:payload ? {'content-type':'application/json','content-length':Buffer.byteLength(payload)} : {} }, (res) => {
      let raw=''; res.on('data',(chunk)=>{raw+=chunk;}); res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));
    });
    req.on('error',reject); if(payload) req.write(payload); req.end();
  });
}
async function post(url, body) {
  const response = await request('POST', url, { restaurantId, actor, ...body });
  if (response.status >= 400 || response.data.success === false) throw new Error(`${url}: ${JSON.stringify(response.data)}`);
  return response.data;
}
const close = (a,b) => Math.abs(Number(a)-Number(b)) < 0.01;

(async()=>{
  const cases = [
    { type:'DINE_IN', tableId:table.id, tableName:table.table_name },
    { type:'TAKEAWAY', tableId:null, tableName:null },
    { type:'PHONE_ORDER', tableId:null, tableName:null }
  ];
  for (const scenario of cases) {
    const started=Date.now();
    const saved=await post('/orders/save',{orderType:scenario.type,tableId:scenario.tableId,tableName:scenario.tableName,items:[{itemId:exclusive.id,quantity:1,modifiers:[]},{itemId:inclusive.id,quantity:1,modifiers:[]}]});
    if(!close(saved.total,98)) throw new Error(`${scenario.type} save total must be tax-inclusive 98.00, received ${saved.total}`);
    const open=await request('GET',`/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
    if(open.data.items.find((item)=>Number(item.id)===Number(exclusive.id))?.tax_mode!=='EXCLUSIVE') throw new Error(`${scenario.type} retrieval lost tax treatment`);
    const list=await request('GET',`/orders/open-list?restaurantId=${restaurantId}&${scenario.tableId ? `tableId=${scenario.tableId}` : `orderType=${scenario.type}`}`);
    const listed=list.data.orders.find((order)=>Number(order.id)===Number(saved.orderId));
    if(!close(listed?.total_amount,98)) throw new Error(`${scenario.type} selector total must be 98.00`);
    await post('/orders/submit-kot',{orderId:saved.orderId});
    const submittedOpen=await request('GET',`/orders/open?restaurantId=${restaurantId}&orderId=${saved.orderId}`);
    if(!close(submittedOpen.data.pricing.payableSubtotal,98)) throw new Error(`${scenario.type} submitted retrieval pricing must be 98.00, received ${JSON.stringify(submittedOpen.data.pricing)}`);
    const live=await request('GET',`/orders/live?restaurantId=${restaurantId}`);
    const liveOrder=live.data.orders.find((order)=>Number(order.id)===Number(saved.orderId));
    if(!close(liveOrder?.submitted_total,98)) throw new Error(`${scenario.type} Billing/Live total must be 98.00`);
    if(Date.now()-started>5000) throw new Error(`${scenario.type} save/retrieve/KOT scenario exceeded five seconds`);
  }
  console.log(JSON.stringify({success:true,scenarios:['DINE_IN','TAKEAWAY','PHONE_ORDER'],mixedTaxExpected:98,maxScenarioMs:5000}));
  process.exit(0);
})().catch((error)=>{console.error(error.stack||error.message);process.exit(1);});
