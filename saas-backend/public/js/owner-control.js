const token = localStorage.getItem('ownerToken');
if (!token) window.location.replace('/owner-login.html');
let current = null;
let domain = 'MENU';
let performanceMode = 'top';
let restaurantsList = [];
const selectedRestaurants = new Set();
const domainCapabilities = { MENU:'REMOTE_MENU', BILLING:'REMOTE_BILLING', BACKUP:'REMOTE_BACKUP', ONLINE_ORDERING:'REMOTE_ONLINE_ORDERING' };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (v) => Number(v || 0).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
const number = (v) => Number(v || 0).toLocaleString('en-IN');
const rows = (items, fn, empty='No data available') => items?.length ? items.map(fn).join('') : `<p class="od-subtitle">${empty}</p>`;
const selectedRestaurantIds = () => [...selectedRestaurants];
const rid = () => selectedRestaurantIds()[0] || '';
const selectedDate = () => $('reportDate').value;
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
};

async function api(url, options={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...options.headers}});
    if(window.SaasSession?.handleUnauthorized?.(res)) throw new Error('Session expired');
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.message || 'Request failed');
    return data;
  } catch(error) {
    if(error.name === 'AbortError') throw new Error('Owner data took too long to load. Check POS connectivity and retry.');
    throw error;
  } finally { clearTimeout(timer); }
}

function ageText(value) {
  if (!value) return { text:'No successful sync', state:'error' };
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return { text: minutes < 1 ? 'synced just now' : `synced ${minutes} min ago`, state: minutes > 15 ? 'stale' : '' };
}

function channelKey(value) {
  const type = String(value || '').toUpperCase();
  if (type.includes('DINE')) return 'dineIn';
  if (type.includes('DELIVERY') || type.includes('ONLINE')) return 'delivery';
  return 'parcel';
}

function renderChart(points=[]) {
  if (!points.length) return '<div class="chart-empty">Sales activity will appear after the next POS sync.</div>';
  const buckets = [0,4,8,12,16,20];
  const series = { dineIn:Array(6).fill(0), parcel:Array(6).fill(0), delivery:Array(6).fill(0) };
  points.forEach((point) => { const index=Math.min(5,Math.floor(Number(point.hour||0)/4));series[channelKey(point.order_type)][index]+=Number(point.sales||0); });
  const max = Math.max(1,...Object.values(series).flat());
  const colors={dineIn:'#2563eb',parcel:'#10a66a',delivery:'#f97316'};
  const path=(values)=>values.map((value,index)=>`${index?'L':'M'} ${20+index*104} ${230-(value/max)*185}`).join(' ');
  const grid=[0,.25,.5,.75,1].map((ratio)=>`<line x1="20" y1="${230-ratio*185}" x2="540" y2="${230-ratio*185}" stroke="#e7edf5"/><text x="0" y="${234-ratio*185}" font-size="10" fill="#94a3b8">${Math.round(max*ratio/1000)}k</text>`).join('');
  const labels=buckets.map((hour,index)=>`<text x="${20+index*104}" y="255" text-anchor="middle" font-size="10" fill="#64748b">${String(hour).padStart(2,'0')}:00</text>`).join('');
  return `<svg viewBox="0 0 560 270" class="sales-chart" role="img" aria-label="Hourly sales by channel">${grid}${Object.entries(series).map(([key,values])=>`<path d="${path(values)}" fill="none" stroke="${colors[key]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}${labels}</svg>`;
}

function renderPerformance() {
  const items = [...(current?.executiveSales?.itemPerformance || current?.topItems || [])];
  if (performanceMode === 'low') items.reverse();
  $('itemRows').innerHTML = rows(items.slice(0,6), item => `<div class="item-row"><span>${esc(item.item_name)}<small>${number(item.quantity_sold)} sold</small></span><b>${money(item.total_sales)}</b></div>`);
  $('topItemsButton').classList.toggle('active', performanceMode === 'top');
  $('lowItemsButton').classList.toggle('active', performanceMode === 'low');
}

function groupRows(items, keys, numericFields) {
  const grouped = new Map();
  (items || []).forEach((item) => {
    const id = keys.map((key) => item?.[key] ?? '').join('|');
    const row = grouped.get(id) || { ...item };
    numericFields.forEach((field) => { row[field] = Number(grouped.has(id) ? row[field] : 0) + Number(item?.[field] || 0); });
    grouped.set(id, row);
  });
  return [...grouped.values()];
}

function aggregateDashboards(dashboards) {
  if (dashboards.length === 1) return dashboards[0];
  const all = (path) => dashboards.flatMap((data) => path(data) || []);
  const latest = (values) => values.filter(Boolean).sort().at(-1) || null;
  const result = {
    success: true,
    restaurant: { code: selectedRestaurantIds().join(','), name: `${dashboards.length} selected restaurants` },
    freshness: {
      lastSnapshotAt: latest(dashboards.map((data) => data.freshness?.lastSnapshotAt)),
      lastHeartbeatAt: latest(dashboards.map((data) => data.freshness?.lastHeartbeatAt))
    },
    liveOperations: {},
    executiveSales: {},
    refunds: { rows: groupRows(all((data) => data.refunds?.rows), ['refund_mode','reason'], ['count','amount']) },
    promocodes: { rows: groupRows(all((data) => data.promocodes?.rows), ['code'], ['usage_count','discount_amount']) },
    dailyReports: groupRows(all((data) => data.dailyReports), ['report_date'], ['orders_count','gross_sales','net_sales','tax_amount','discount_amount','refunds_amount','cash_total','card_total','upi_total']).sort((a,b)=>String(b.report_date).localeCompare(String(a.report_date))),
    topItems: groupRows(all((data) => data.topItems), ['item_name'], ['quantity_sold','total_sales']).sort((a,b)=>Number(b.total_sales)-Number(a.total_sales)),
    alerts: all((data) => data.alerts),
    commands: all((data) => data.commands).sort((a,b)=>String(b.requested_at).localeCompare(String(a.requested_at))),
    pendingApprovals: all((data) => data.pendingApprovals),
    capabilities: dashboards.map((data) => new Set(data.capabilities || [])).reduce((common,set)=>new Set([...common].filter((code)=>set.has(code)))),
    configurationSnapshot: {}
  };
  result.capabilities = [...result.capabilities];
  ['dineIn','parcel','party','online'].forEach((key) => { result.liveOperations[key] = all((data) => data.liveOperations?.[key]); });
  const sales = result.executiveSales;
  sales.today = dashboards.reduce((sum,data) => {
    const row=data.executiveSales?.today||{};
    sum.netSales+=Number(row.netSales||0);sum.orders+=Number(row.orders||0);return sum;
  },{netSales:0,orders:0,averageOrder:0});
  sales.today.averageOrder = sales.today.orders ? sales.today.netSales / sales.today.orders : 0;
  sales.byPayment = groupRows(all((data)=>data.executiveSales?.byPayment), ['mode'], ['total']);
  sales.byOrderType = groupRows(all((data)=>data.executiveSales?.byOrderType), ['order_type'], ['orders','sales']);
  sales.salesTimeline = groupRows(all((data)=>data.executiveSales?.salesTimeline), ['hour','order_type'], ['sales','orders']);
  sales.itemPerformance = groupRows(all((data)=>data.executiveSales?.itemPerformance || data.topItems), ['item_name'], ['quantity_sold','total_sales']).sort((a,b)=>Number(b.total_sales)-Number(a.total_sales));
  sales.orderOutcomes = dashboards.reduce((sum,data)=>{const row=data.executiveSales?.orderOutcomes||{};['successful','complimentary','cancelled'].forEach(key=>sum[key]+=Number(row[key]||0));return sum;},{successful:0,complimentary:0,cancelled:0});
  sales.onlineOrders = dashboards.reduce((sum,data)=>{const row=data.executiveSales?.onlineOrders||{};['sales','orders','prepaid_sales','prepaid_orders','cod_sales','cod_orders'].forEach(key=>sum[key]+=Number(row[key]||0));return sum;},{sales:0,orders:0,prepaid_sales:0,prepaid_orders:0,cod_sales:0,cod_orders:0});
  sales.leakage = dashboards.reduce((sum,data)=>{const row=data.executiveSales?.leakage||{};['cancelled','modified','shifted'].forEach(key=>sum.kots[key]+=Number(row.kots?.[key]||0));['modified','reprinted','waived'].forEach(key=>sum.bills[key]+=Number(row.bills?.[key]||0));return sum;},{kots:{cancelled:0,modified:0,shifted:0},bills:{modified:0,reprinted:0,waived:0}});
  return result;
}

function titleCase(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/\b\w/g,(char)=>char.toUpperCase());
}

function renderLiveOperations(operations={}) {
  const entries = ['dineIn','parcel','party','online'].map((key)=>[key,operations[key]||[]]);
  const totalOrders = entries.reduce((sum,[,items])=>sum+items.length,0);
  const totalValue = entries.flatMap(([,items])=>items).reduce((sum,item)=>sum+Number(item.total||0),0);
  $('liveOperationsList').innerHTML = `<div class="ops-kpis"><div class="ops-kpi"><span>Open orders</span><strong>${number(totalOrders)}</strong></div><div class="ops-kpi"><span>Open value</span><strong>${money(totalValue)}</strong></div>${entries.slice(0,2).map(([key,items])=>`<div class="ops-kpi"><span>${titleCase(key)}</span><strong>${number(items.length)}</strong></div>`).join('')}</div><div class="ops-groups">${
    entries.map(([key,items])=>`<section class="ops-group"><div class="ops-group-head"><h3>${titleCase(key)}</h3><span class="ops-count">${number(items.length)}</span></div><div class="ops-table">${items.length ? items.slice(0,8).map((order)=>`<div class="ops-row"><span><b>${esc(order.reference||'Order')}</b></span><small>${esc(order.table||order.status||titleCase(key))}</small><strong>${money(order.total)}</strong></div>`).join('') : '<div class="ops-empty">No open orders</div>'}</div></section>`).join('')
  }</div>`;
}

function selectedDailyReport(data) {
  return (data.dailyReports || []).find((row) => String(row.report_date || '').slice(0,10) === selectedDate()) || null;
}

function renderReports(data) {
  const reports = data.dailyReports || [];
  $('dailyReportRows').innerHTML = `<div class="od-report-row head"><span>Date</span><span>Orders</span><span>Net sales</span><span>Tax</span><span>Discount</span><span>Refunds</span></div>${
    rows(reports, row => `<div class="od-report-row"><span>${esc(String(row.report_date || '').slice(0,10))}</span><span>${number(row.orders_count)}</span><span>${money(row.net_sales)}</span><span>${money(row.tax_amount)}</span><span>${money(row.discount_amount)}</span><span>${money(row.refunds_amount)}</span></div>`, '<div class="od-report-row"><span>No daily reports have synced yet.</span></div>')
  }`;
}

function render(data) {
  current = data;
  const sales = data.executiveSales || {};
  const report = selectedDailyReport(data);
  const isToday = selectedDate() === localDate();
  const today = report && !isToday ? {
    netSales: report.net_sales,
    orders: report.orders_count,
    averageOrder: Number(report.orders_count) ? Number(report.net_sales) / Number(report.orders_count) : 0
  } : (sales.today || {});
  const snapshotAge = ageText(data.freshness?.lastSnapshotAt || sales.generatedAt);
  const heartbeatAge = ageText(data.freshness?.lastHeartbeatAt);
  $('status').innerHTML = `<span class="sync-pill ${heartbeatAge.state}">POS ${esc(heartbeatAge.text)}</span><span class="sync-pill ${snapshotAge.state}">Orders ${esc(snapshotAge.text)}</span>`;
  $('totalSales').textContent = money(today.netSales);
  $('salesCaption').textContent = `${selectedDate()} · ${number(today.orders)} paid orders · ${money(today.averageOrder)} average`;
  $('totalOrders').textContent = `${number(today.orders)} orders`;
  const paymentColors={CASH:'#2563eb',CARD:'#10a66a',UPI:'#f97316',OTHER:'#64748b'};
  const payments=report && !isToday ? [
    {mode:'CASH',total:report.cash_total},{mode:'CARD',total:report.card_total},{mode:'UPI',total:report.upi_total}
  ].filter(row=>Number(row.total)>0) : (sales.byPayment || []);
  const paymentTotal=payments.reduce((sum,row)=>sum+Number(row.total||0),0);
  $('paymentBreakdown').innerHTML=rows(payments,row=>`<div class="payment-row" style="--row-color:${paymentColors[row.mode]||'#64748b'}"><span>${esc(row.mode)}</span><b>${money(row.total)} <small class="od-subtitle">${paymentTotal?Math.round(Number(row.total)*100/paymentTotal):0}%</small></b></div>`,'No settled payments for this period.');
  const outcomes=sales.orderOutcomes || {};
  $('outcomePills').innerHTML=`<span>${number(outcomes.successful)} successful</span><span class="neutral">${number(outcomes.complimentary)} complimentary</span><span class="neutral">${number(outcomes.cancelled)} cancelled</span>`;
  $('salesChart').innerHTML=renderChart(sales.salesTimeline || []);

  const channelTotals={dineIn:{orders:0,sales:0,label:'Dine in',color:'#2563eb'},parcel:{orders:0,sales:0,label:'Parcel',color:'#10a66a'},delivery:{orders:0,sales:0,label:'Delivery',color:'#f97316'}};
  (sales.byOrderType||[]).forEach(row=>{const key=channelKey(row.order_type);channelTotals[key].orders+=Number(row.orders||0);channelTotals[key].sales+=Number(row.sales||0);});
  const maxChannel=Math.max(1,...Object.values(channelTotals).map(row=>row.sales));
  $('channelCards').innerHTML=Object.values(channelTotals).map(row=>`<article class="channel-card" style="--channel-color:${row.color}"><b>${row.label}</b><strong>${money(row.sales)}</strong><div class="bar"><i style="width:${Math.round(row.sales*100/maxChannel)}%"></i></div><span class="od-subtitle">${number(row.orders)} orders</span></article>`).join('');

  const leakage=sales.leakage || {kots:{},bills:{}};
  $('leakageList').innerHTML=`<div class="leak-section-title">KOTS</div>${[['Cancelled',leakage.kots?.cancelled],['Modified',leakage.kots?.modified],['Shifted',leakage.kots?.shifted]].map(row=>`<div class="leak-row"><span>${row[0]}</span><b>${number(row[1])}</b></div>`).join('')}<div class="leak-section-title">BILLS</div>${[['Modified',leakage.bills?.modified],['Re-printed',leakage.bills?.reprinted],['Waived off',money(leakage.bills?.waived)]].map(row=>`<div class="leak-row"><span>${row[0]}</span><b>${row[1]}</b></div>`).join('')}`;
  renderPerformance();

  const online=sales.onlineOrders || {};
  $('onlineSummary').innerHTML=`<div class="online-stat"><span>Total online</span><strong>${money(online.sales)}</strong><small>${number(online.orders)} orders</small></div><div class="online-stat" style="border-color:#2563eb"><span>Prepaid</span><strong>${money(online.prepaid_sales)}</strong><small>${number(online.prepaid_orders)} orders</small></div><div class="online-stat" style="border-color:#ef4444"><span>COD</span><strong>${money(online.cod_sales)}</strong><small>${number(online.cod_orders)} orders</small></div>`;

  renderLiveOperations(data.liveOperations||{});
  $('refunds').innerHTML=`<h3>Refunds</h3>${rows(data.refunds?.rows||[],r=>`<div class="control-row"><span>${esc(r.refund_mode)} · ${esc(r.reason||'No reason')} (${r.count})</span><b>${money(r.amount)}</b></div>`)}`;
  $('promocodes').innerHTML=`<h3>Promocodes</h3>${rows(data.promocodes?.rows||[],r=>`<div class="control-row"><span>${esc(r.code)} · ${r.usage_count} uses</span><b>${money(r.discount_amount)}</b></div>`)}`;
  $('alerts').innerHTML=rows(data.alerts||[],a=>`<div class="control-card ${a.severity==='HIGH'?'alert-high':''}"><b>${esc(a.alert_type)}</b><p>${esc(a.message)}</p></div>`,'No active alerts.');
  $('approvals').innerHTML=rows(data.pendingApprovals||[],a=>`<div class="control-card approval"><b>${esc(a.change_type)}</b><p>${esc(a.summary)}</p><button data-approval="${a.id}">Confirm & notify POS</button></div>`,'No changes waiting for confirmation.');
  document.querySelectorAll('[data-approval]').forEach(button=>button.onclick=()=>confirmApproval(button.dataset.approval));
  renderReports(data);
  renderConfigTabs();
}

function renderConfigTabs(){
  const caps=new Set(current?.capabilities||[]);
  $('configTabs').innerHTML=Object.entries(domainCapabilities).filter(([,cap])=>caps.has(cap)).map(([key])=>`<button data-domain="${key}" ${key===domain?'disabled':''}>${key.replaceAll('_',' ')}</button>`).join('');
  document.querySelectorAll('[data-domain]').forEach(button=>button.onclick=()=>{domain=button.dataset.domain;renderConfigTabs();loadEditor();});
  const enabled=caps.has(domainCapabilities[domain]);
  $('configEditor').hidden=$('saveConfigButton').hidden=!enabled;
  $('configStatus').hidden=!enabled;
  $('configTitle').textContent=enabled?domain.replaceAll('_',' '):'Remote configuration is not enabled by SaaS administration';
  $('runBackupButton').hidden=!caps.has('REMOTE_BACKUP');
  if(enabled) loadEditor();
}
function configurationValue(){
  const map={MENU:'menu',BILLING:'billing',BACKUP:'backup',ONLINE_ORDERING:'onlineOrdering'};
  const value=current?.configurationSnapshot?.[map[domain]];
  if(value && typeof value==='object' && !Array.isArray(value)) return value;
  if(typeof value==='string'){
    try {
      const parsed=JSON.parse(value);
      if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return {};
}
function parseConfigurationEditor(){
  const raw=String($('configEditor').value||'').trim();
  if(!raw) return {};
  const parsed=JSON.parse(raw);
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('Configuration must be a JSON object.');
  return parsed;
}
function validateConfigurationEditor(){
  try {
    parseConfigurationEditor();
    $('configStatus').textContent=selectedRestaurants.size===1?'Configuration is ready to publish.':'Select one restaurant to publish branch configuration.';
    $('saveConfigButton').disabled=selectedRestaurants.size!==1;
    return true;
  } catch(error) {
    $('configStatus').textContent=`Configuration needs attention: ${error.message}`;
    $('saveConfigButton').disabled=true;
    return false;
  }
}
function loadEditor(){
  $('configEditor').value=JSON.stringify(configurationValue(),null,2);
  $('configTitle').textContent=domain.replaceAll('_',' ');
  validateConfigurationEditor();
}
function updateRestaurantButton() {
  const count=selectedRestaurants.size;
  $('restaurantMultiButton').textContent=count===restaurantsList.length?'All restaurants':count===1?(restaurantsList.find((row)=>selectedRestaurants.has(row.restaurant_code))?.name||'1 restaurant'):`${count} restaurants`;
}
function renderRestaurantMenu() {
  const allSelected=restaurantsList.length>0&&selectedRestaurants.size===restaurantsList.length;
  $('restaurantMultiMenu').innerHTML=`<label class="od-multi-option od-multi-all"><input id="restaurantSelectAll" type="checkbox" ${allSelected?'checked':''}><span>Select all restaurants</span></label>${restaurantsList.map((row)=>`<label class="od-multi-option"><input type="checkbox" data-restaurant-id="${esc(row.restaurant_code)}" ${selectedRestaurants.has(row.restaurant_code)?'checked':''}><span>${esc(row.name)}</span></label>`).join('')}`;
  $('restaurantSelectAll').onchange=(event)=>{selectedRestaurants.clear();if(event.target.checked)restaurantsList.forEach((row)=>selectedRestaurants.add(row.restaurant_code));renderRestaurantMenu();updateRestaurantButton();load();};
  document.querySelectorAll('[data-restaurant-id]').forEach((input)=>input.onchange=()=>{input.checked?selectedRestaurants.add(input.dataset.restaurantId):selectedRestaurants.delete(input.dataset.restaurantId);if(!selectedRestaurants.size){input.checked=true;selectedRestaurants.add(input.dataset.restaurantId);}$('restaurantSelectAll').checked=selectedRestaurants.size===restaurantsList.length;updateRestaurantButton();load();});
}
async function restaurants(){const data=await api('/owners/dashboard');restaurantsList=data.restaurants||[];restaurantsList.forEach((row)=>selectedRestaurants.add(row.restaurant_code));renderRestaurantMenu();updateRestaurantButton();}
async function load(){
  const ids=selectedRestaurantIds();
  if(!ids.length)return;
  $('status').innerHTML='<span class="sync-pill">Loading cloud snapshot…</span>';
  $('refreshButton').disabled=true;
  try {
    const dashboards=await Promise.all(ids.map((id)=>api(`/owner-control/owner/dashboard?restaurantId=${encodeURIComponent(id)}`)));
    render(aggregateDashboards(dashboards));
  } catch(error) {
    $('status').innerHTML=`<div class="od-error">${esc(error.message)}</div>`;
    $('salesChart').innerHTML='<div class="chart-empty">Cloud data unavailable. Request POS sync and retry.</div>';
  } finally{$('refreshButton').disabled=false}
}
async function command(type){
  try {
    const results=await Promise.all(selectedRestaurantIds().map((restaurantId)=>api('/owner-control/owner/commands',{method:'POST',body:JSON.stringify({restaurantId,type})})));
    $('status').innerHTML=`<span class="sync-pill">${number(results.length)} POS sync request${results.length===1?'':'s'} queued</span>`;
  } catch(error) {$('status').innerHTML=`<div class="od-error">${esc(error.message)}</div>`;}
}
async function confirmApproval(id){try{await api(`/owner-control/owner/approvals/${id}/confirm`,{method:'POST',body:JSON.stringify({restaurantId:rid()})});await load();}catch(error){$('status').innerHTML=`<div class="od-error">${esc(error.message)}</div>`;}}

function focusSection(target) {
  const section=$(target);
  if(!section)return;
  section.scrollIntoView({behavior:'smooth',block:'start'});
  section.classList.remove('od-section-flash');
  requestAnimationFrame(()=>section.classList.add('od-section-flash'));
}

function selectConfig(nextDomain) {
  const caps=new Set(current?.capabilities||[]);
  domain=nextDomain;
  focusSection('remoteConfig');
  if(!caps.has(domainCapabilities[domain])) {
    $('configTitle').textContent=`${domain.replaceAll('_',' ')} remote control is not enabled for this restaurant`;
    $('configEditor').hidden=$('saveConfigButton').hidden=true;
    return;
  }
  renderConfigTabs();
  loadEditor();
}

function openDrawer() {
  const alerts=current?.alerts||[];
  const commands=current?.commands||[];
  $('drawerBody').innerHTML=`<p class="od-capability-note">${alerts.length ? `${alerts.length} active alert${alerts.length===1?'':'s'} require attention.` : 'There are no active owner alerts.'}</p><h3>Recent POS commands</h3><div class="od-command-list">${rows(commands.slice(0,12),row=>`<div class="od-command"><b>${esc(row.command_type)}</b><small>${esc(row.status)} · ${esc(row.message||'Waiting for POS acknowledgement')}</small></div>`,'No owner commands have been issued.')}</div>`;
  $('ownerDrawer').hidden=false;
  $('closeDrawerButton').focus();
}

function downloadReports() {
  const reports=current?.dailyReports||[];
  if(!reports.length){$('status').innerHTML='<div class="od-error">No synced daily reports are available to download.</div>';return;}
  const fields=['report_date','orders_count','gross_sales','net_sales','tax_amount','discount_amount','refunds_amount','cash_total','card_total','upi_total'];
  const csv=[fields.join(','),...reports.map(row=>fields.map(field=>`"${String(row[field]??'').replaceAll('"','""')}"`).join(','))].join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download=`kmaster-owner-sales-${rid()}.csv`;link.click();URL.revokeObjectURL(link.href);
}

$('refreshButton').onclick=load;
$('restaurantMultiButton').onclick=()=>{const menu=$('restaurantMultiMenu');menu.hidden=!menu.hidden;$('restaurantMultiButton').setAttribute('aria-expanded',String(!menu.hidden));};
$('reportDate').onchange=()=>current&&render(current);
$('requestSyncButton').onclick=()=>command('REQUEST_SYNC');
$('runBackupButton').onclick=()=>command('RUN_BACKUP');
$('topItemsButton').onclick=()=>{performanceMode='top';renderPerformance();};
$('lowItemsButton').onclick=()=>{performanceMode='low';renderPerformance();};
$('notificationsButton').onclick=openDrawer;
$('settingsButton').onclick=()=>focusSection('remoteConfig');
$('closeDrawerButton').onclick=()=>$('ownerDrawer').hidden=true;
$('ownerDrawer').onclick=(event)=>{if(event.target===$('ownerDrawer'))$('ownerDrawer').hidden=true;};
$('downloadReportButton').onclick=downloadReports;
document.querySelectorAll('[data-owner-nav]').forEach(button=>button.onclick=()=>{
  const target=button.dataset.ownerNav;
  if(target==='MENU')selectConfig('MENU');
  else if(target==='INVENTORY'){
    focusSection('remoteConfig');
    $('configTitle').textContent='Inventory monitoring';
    $('configEditor').hidden=$('saveConfigButton').hidden=true;
    $('status').innerHTML='<span class="sync-pill">Inventory is view-only until the Remote Inventory capability is enabled by SaaS administration.</span>';
  } else focusSection(target);
});
document.querySelectorAll('[data-owner-section]').forEach((button)=>button.onclick=()=>focusSection(button.dataset.ownerSection));
document.addEventListener('click',(event)=>{if(!event.target.closest('.od-restaurant-filter')){$('restaurantMultiMenu').hidden=true;$('restaurantMultiButton').setAttribute('aria-expanded','false');}});
$('reportDate').value=localDate();
$('configEditor').oninput=validateConfigurationEditor;
$('saveConfigButton').onclick=async()=>{
  if(selectedRestaurants.size!==1){validateConfigurationEditor();return;}
  let payload;
  try {payload=parseConfigurationEditor();}
  catch(error){validateConfigurationEditor();return;}
  $('saveConfigButton').disabled=true;
  $('configStatus').textContent='Publishing configuration…';
  try {
    await api(`/owner-control/owner/config/${domain}?restaurantId=${encodeURIComponent(rid())}`,{method:'PUT',body:JSON.stringify({restaurantId:rid(),payload})});
    $('configStatus').textContent='Configuration published to POS.';
    await load();
  } catch(error) {
    $('configStatus').textContent=`Configuration was not published: ${error.message}`;
    $('saveConfigButton').disabled=false;
  }
};
restaurants().then(load).catch(error=>$('status').innerHTML=`<div class="od-error">${esc(error.message)}</div>`);
setInterval(load,60000);
