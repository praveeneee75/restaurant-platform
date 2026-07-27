const token = localStorage.getItem('ownerToken');
if (!token) window.location.replace('/owner-login.html');
let current = null;
let domain = 'MENU';
let performanceMode = 'top';
let restaurantsList = [];
const selectedRestaurants = new Set();
let menuPublisherBranches = [];
const menuTargetIds = new Set();
let menuEditorRestaurantId = '';
let menuEditorMenu = null;
let menuEditorTab = 'categories';
let menuEditorOnline = false;
let menuEditorEnabled = false;
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
  document.querySelectorAll('[data-domain]').forEach(button=>button.onclick=()=>{domain=button.dataset.domain;renderConfigTabs();});
  const enabled=caps.has(domainCapabilities[domain]);
  const menuMode=domain==='MENU';
  $('menuPublisherPanel').hidden=false;
  $('configTitle').hidden=menuMode;
  $('configEditor').hidden=$('saveConfigButton').hidden=!enabled||menuMode;
  $('configStatus').hidden=!enabled||menuMode;
  $('configTitle').textContent=enabled?domain.replaceAll('_',' '):'Remote configuration is not enabled by SaaS administration';
  $('runBackupButton').hidden=!caps.has('REMOTE_BACKUP');
  if(!menuPublisherBranches.length) loadMenuPublisher();
  else renderMenuEditorBranches();
  if(enabled&&!menuMode) loadEditor();
}
function renderMenuPublisher(preferredSource=''){
  const source=preferredSource||$('menuSourceSelect').value;
  $('menuSourceSelect').innerHTML=`<option value="">Choose a populated source branch</option>${menuPublisherBranches.filter((row)=>Number(row.counts?.items||0)>0).map((row)=>`<option value="${esc(row.restaurantId)}" ${row.restaurantId===source?'selected':''}>${esc(row.name)} · ${number(row.counts.items)} items</option>`).join('')}`;
  const selectedSource=$('menuSourceSelect').value;
  const selected=menuPublisherBranches.find((row)=>row.restaurantId===selectedSource);
  $('menuSourceSummary').innerHTML=selected?`<strong>${number(selected.counts.categories)} categories · ${number(selected.counts.items)} items</strong><span>Last menu sync: ${esc(selected.snapshotAt?new Date(selected.snapshotAt).toLocaleString():'not synced')}</span>`:'<span>Select the branch whose menu should be copied.</span>';
  const targets=menuPublisherBranches.filter((row)=>row.restaurantId!==selectedSource);
  const validTargets=new Set(targets.filter((row)=>row.remoteMenuEnabled).map((row)=>row.restaurantId));
  [...menuTargetIds].forEach((id)=>{if(!validTargets.has(id))menuTargetIds.delete(id);});
  $('menuTargetList').innerHTML=targets.length?targets.map((row)=>`<label class="menu-target-option ${row.remoteMenuEnabled?'':'disabled'}"><input type="checkbox" data-menu-target="${esc(row.restaurantId)}" ${menuTargetIds.has(row.restaurantId)&&row.remoteMenuEnabled?'checked':''} ${row.remoteMenuEnabled?'':'disabled'}><span><strong>${esc(row.name)}</strong><small>${number(row.counts?.items||0)} current items · ${row.remoteMenuEnabled?'Ready for remote menu':'Publishing disabled by SaaS administration'}</small>${row.remoteMenuEnabled?'':'<small class="menu-target-warning">Ask the SaaS administrator to enable Remote Menu for this branch.</small>'}${row.latestPublish?`<small>Last publish: version ${number(row.latestPublish.version)} · ${esc(row.latestPublish.status)}</small>`:''}</span></label>`).join(''):'<p>No other branches are available.</p>';
  document.querySelectorAll('[data-menu-target]').forEach((input)=>input.onchange=()=>input.checked?menuTargetIds.add(input.dataset.menuTarget):menuTargetIds.delete(input.dataset.menuTarget));
  $('publishMenuButton').disabled=!selectedSource||!menuTargetIds.size;
}
async function loadMenuPublisher(){
  $('menuPublishStatus').textContent='Loading branch menus…';
  try{
    const data=await api(`/owner-control/owner/menu-publisher?restaurantId=${encodeURIComponent(rid())}`);
    menuPublisherBranches=data.branches||[];
    const previous=$('menuSourceSelect').value;
    const first=menuPublisherBranches.find((row)=>row.restaurantId===previous&&Number(row.counts?.items||0)>0)||menuPublisherBranches.find((row)=>Number(row.counts?.items||0)>0);
    if(!menuTargetIds.size&&first) menuPublisherBranches.filter((row)=>row.restaurantId!==first.restaurantId&&row.remoteMenuEnabled).forEach((row)=>menuTargetIds.add(row.restaurantId));
    renderMenuPublisher(first?.restaurantId||'');
    renderMenuEditorBranches();
    if(domain==='MENU' && menuEditorRestaurantId && !menuEditorMenu) await loadMenuEditor();
    $('menuPublishStatus').textContent=first?'Choose target branches, review the counts, then publish.':'No synced branch has a menu. Open a populated POS and run Sync first.';
  }catch(error){$('menuPublishStatus').textContent=`Menu publisher could not load: ${error.message}`;}
}
async function publishSelectedMenu(){
  const sourceRestaurantId=$('menuSourceSelect').value;
  const targets=[...menuTargetIds].filter((id)=>id!==sourceRestaurantId);
  if(!sourceRestaurantId){$('menuPublishStatus').textContent='Choose a source branch first.';return;}
  if(!targets.length){$('menuPublishStatus').textContent='Select at least one target branch.';return;}
  $('publishMenuButton').disabled=true;
  $('menuPublishStatus').textContent=`Publishing to ${targets.length} branch${targets.length===1?'':'es'}…`;
  const results=[];
  for(const target of targets){
    try{
      const result=await api(`/owner-control/owner/menu-publish?restaurantId=${encodeURIComponent(target)}`,{method:'POST',body:JSON.stringify({sourceRestaurantId})});
      results.push({target,ok:true,message:result.message});
    }catch(error){results.push({target,ok:false,message:error.message});}
  }
  $('menuPublishStatus').innerHTML=results.map((result)=>`<div class="menu-publish-result ${result.ok?'success':'error'}"><strong>${esc(menuPublisherBranches.find((row)=>row.restaurantId===result.target)?.name||result.target)}</strong><span>${esc(result.message)}</span></div>`).join('');
  $('publishMenuButton').disabled=false;
  const succeeded=results.filter((result)=>result.ok).length;
  if(succeeded) setTimeout(()=>loadMenuPublisher(),5000);
}
function renderMenuEditorBranches(){
  const select=$('menuEditorRestaurant');
  if(!select)return;
  const available=new Set(menuPublisherBranches.map(row=>row.restaurantId));
  if(!available.has(menuEditorRestaurantId)) menuEditorRestaurantId=available.has(rid())?rid():(menuPublisherBranches[0]?.restaurantId||'');
  select.innerHTML=menuPublisherBranches.map(row=>`<option value="${esc(row.restaurantId)}" ${row.restaurantId===menuEditorRestaurantId?'selected':''}>${esc(row.name)} · ${row.isOnline?'Online':'Offline'}</option>`).join('');
  const branch=menuPublisherBranches.find(row=>row.restaurantId===menuEditorRestaurantId);
  menuEditorOnline=Boolean(branch?.isOnline);
  menuEditorEnabled=Boolean(branch?.remoteMenuEnabled);
  $('menuEditorConnection').className=`menu-editor-connection ${menuEditorOnline?'online':'offline'}`;
  $('menuEditorConnection').textContent=!menuEditorEnabled?'Remote Menu not enabled':menuEditorOnline?'POS online · editing enabled':'POS offline · read only';
  $('saveMenuEditorButton').disabled=!menuEditorMenu||!menuEditorOnline||!menuEditorEnabled;
}
const menuCell=(array,index,key,value,type='text',extra='')=>`<input ${extra} type="${type}" data-menu-array="${array}" data-menu-index="${index}" data-menu-key="${key}" value="${esc(value??'')}" ${!menuEditorOnline||!menuEditorEnabled?'disabled':''}>`;
const menuCheck=(array,index,key,value)=>`<input type="checkbox" data-menu-array="${array}" data-menu-index="${index}" data-menu-key="${key}" ${value?'checked':''} ${!menuEditorOnline||!menuEditorEnabled?'disabled':''}>`;
const menuSelect=(array,index,key,value,options)=>`<select data-menu-array="${array}" data-menu-index="${index}" data-menu-key="${key}" ${!menuEditorOnline||!menuEditorEnabled?'disabled':''}>${options.map(([id,label])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
function editorSection(title,array,head,body){
  return `<section class="menu-editor-section"><div class="menu-editor-section-head"><strong>${esc(title)}</strong><button type="button" data-menu-add="${array}" ${!menuEditorOnline||!menuEditorEnabled?'disabled':''}>Add</button></div><div class="menu-editor-table-wrap">${body?`<table class="menu-editor-table"><thead><tr>${head.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`:'<div class="menu-editor-empty">No records yet.</div>'}</div></section>`;
}
function renderMenuEditor(){
  document.querySelectorAll('[data-menu-editor-tab]').forEach(button=>button.classList.toggle('active',button.dataset.menuEditorTab===menuEditorTab));
  if(!menuEditorMenu){$('menuEditorBody').innerHTML='<div class="menu-editor-empty">Choose a branch and load its menu.</div>';return;}
  const m=menuEditorMenu;
  const kitchens=[['','No kitchen'],...(m.kitchens||[]).map(x=>[x.id,x.name])];
  const categories=[['','No category'],...(m.categories||[]).map(x=>[x.id,x.name])];
  const groups=[['','Choose group'],...(m.modifierGroups||[]).map(x=>[x.id,x.name])];
  const items=[['','Choose item'],...(m.items||[]).map(x=>[x.id,x.name])];
  const combos=[['','Choose combo'],...(m.combos||[]).map(x=>[x.id,x.name])];
  let html='';
  if(menuEditorTab==='categories'){
    html=editorSection('Categories','categories',['Name','Kitchen','Active'],(m.categories||[]).map((x,i)=>`<tr><td>${menuCell('categories',i,'name',x.name,'text','class="wide"')}</td><td>${menuSelect('categories',i,'kitchen_id',x.kitchen_id,kitchens)}</td><td>${menuCheck('categories',i,'active',x.active)}</td></tr>`).join(''));
  }else if(menuEditorTab==='items'){
    html=editorSection('Menu items','items',['Name','Category','Price','Alpha code','Number code','Tax','Veg','Dine in','Parcel','Party','Online','Active'],(m.items||[]).map((x,i)=>`<tr><td>${menuCell('items',i,'name',x.name,'text','class="wide"')}</td><td>${menuSelect('items',i,'category_id',x.category_id,categories)}</td><td>${menuCell('items',i,'price',x.price,'number','step="0.01"')}</td><td>${menuCell('items',i,'alpha_short_code',x.alpha_short_code)}</td><td>${menuCell('items',i,'numeric_short_code',x.numeric_short_code)}</td><td>${menuSelect('items',i,'tax_mode',x.tax_mode||'INCLUSIVE',[['INCLUSIVE','Inclusive'],['EXCLUSIVE','Exclusive']])}</td><td>${menuCheck('items',i,'is_veg',x.is_veg)}</td><td>${menuCheck('items',i,'allow_dine_in',x.allow_dine_in)}</td><td>${menuCheck('items',i,'allow_parcel',x.allow_parcel)}</td><td>${menuCheck('items',i,'allow_party_order',x.allow_party_order)}</td><td>${menuCheck('items',i,'online_enabled',x.online_enabled)}</td><td>${menuCheck('items',i,'active',x.active)}</td></tr>`).join(''));
  }else{
    html=[
      editorSection('Modifier groups','modifierGroups',['Name','Min','Max','Required','Active'],(m.modifierGroups||[]).map((x,i)=>`<tr><td>${menuCell('modifierGroups',i,'name',x.name,'text','class="wide"')}</td><td>${menuCell('modifierGroups',i,'min_select',x.min_select,'number')}</td><td>${menuCell('modifierGroups',i,'max_select',x.max_select,'number')}</td><td>${menuCheck('modifierGroups',i,'required',x.required)}</td><td>${menuCheck('modifierGroups',i,'active',x.active)}</td></tr>`).join('')),
      editorSection('Modifiers','modifiers',['Name','Group','Price change','Active'],(m.modifiers||[]).map((x,i)=>`<tr><td>${menuCell('modifiers',i,'name',x.name,'text','class="wide"')}</td><td>${menuSelect('modifiers',i,'group_id',x.group_id,groups)}</td><td>${menuCell('modifiers',i,'price_delta',x.price_delta,'number','step="0.01"')}</td><td>${menuCheck('modifiers',i,'active',x.active)}</td></tr>`).join('')),
      editorSection('Combos','combos',['Name','Price','Active'],(m.combos||[]).map((x,i)=>`<tr><td>${menuCell('combos',i,'name',x.name,'text','class="wide"')}</td><td>${menuCell('combos',i,'price',x.price,'number','step="0.01"')}</td><td>${menuCheck('combos',i,'active',x.active)}</td></tr>`).join('')),
      editorSection('Item modifier assignments','itemModifierGroups',['Item','Modifier group','Active'],(m.itemModifierGroups||[]).map((x,i)=>`<tr><td>${menuSelect('itemModifierGroups',i,'item_id',x.item_id,items)}</td><td>${menuSelect('itemModifierGroups',i,'group_id',x.group_id,groups)}</td><td>${menuCheck('itemModifierGroups',i,'active',x.active)}</td></tr>`).join('')),
      editorSection('Combo items','comboItems',['Combo','Item','Quantity','Active'],(m.comboItems||[]).map((x,i)=>`<tr><td>${menuSelect('comboItems',i,'combo_id',x.combo_id,combos)}</td><td>${menuSelect('comboItems',i,'item_id',x.item_id,items)}</td><td>${menuCell('comboItems',i,'quantity',x.quantity,'number','min="0" step="1"')}</td><td>${menuCheck('comboItems',i,'active',x.active)}</td></tr>`).join(''))
    ].join('');
  }
  $('menuEditorBody').innerHTML=html;
}
function newMenuRecord(array){
  const id=`owner-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const defaults={
    categories:{id,name:'New category',kitchen_id:'',active:true},
    items:{id,name:'New item',category_id:'',price:0,alpha_short_code:'',numeric_short_code:'',tax_mode:'INCLUSIVE',is_veg:true,allow_dine_in:true,allow_parcel:true,allow_party_order:true,online_enabled:true,active:true},
    modifierGroups:{id,name:'New modifier group',min_select:0,max_select:1,required:false,active:true},
    modifiers:{id,group_id:'',name:'New modifier',price_delta:0,active:true},
    combos:{id,name:'New combo',price:0,active:true},
    itemModifierGroups:{item_id:'',group_id:'',active:true},
    comboItems:{combo_id:'',item_id:'',quantity:1,active:true}
  };
  return defaults[array];
}
async function loadMenuEditor(){
  if(!menuEditorRestaurantId)return;
  $('menuEditorStatus').textContent='Loading selected branch menu…';
  try{
    const data=await api(`/owner-control/owner/menu-editor?restaurantId=${encodeURIComponent(menuEditorRestaurantId)}`);
    menuEditorMenu=data.menu;
    menuEditorOnline=Boolean(data.isOnline);
    menuEditorEnabled=Boolean(data.remoteMenuEnabled);
    renderMenuEditorBranches();renderMenuEditor();
    $('menuEditorStatus').textContent=menuEditorOnline?'Menu loaded. Changes will be sent only to this branch.':'POS is offline. The menu is visible but cannot be edited.';
  }catch(error){menuEditorMenu=null;renderMenuEditor();$('menuEditorStatus').textContent=`Menu editor could not load: ${error.message}`;}
}
async function saveMenuEditor(){
  if(!menuEditorOnline||!menuEditorEnabled||!menuEditorMenu)return;
  $('saveMenuEditorButton').disabled=true;$('menuEditorStatus').textContent='Validating and publishing menu…';
  try{
    const data=await api(`/owner-control/owner/menu-editor?restaurantId=${encodeURIComponent(menuEditorRestaurantId)}`,{method:'PUT',body:JSON.stringify({restaurantId:menuEditorRestaurantId,menu:menuEditorMenu})});
    $('menuEditorStatus').textContent=`Menu version ${data.version} queued for this POS.`;
    setTimeout(loadMenuEditor,3000);
  }catch(error){$('menuEditorStatus').textContent=`Menu was not published: ${error.message}`;$('saveMenuEditorButton').disabled=false;}
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
$('menuSourceSelect').onchange=()=>{menuTargetIds.clear();menuPublisherBranches.filter((row)=>row.restaurantId!==$('menuSourceSelect').value&&row.remoteMenuEnabled).forEach((row)=>menuTargetIds.add(row.restaurantId));renderMenuPublisher();};
$('refreshMenuPublisherButton').onclick=loadMenuPublisher;
$('publishMenuButton').onclick=publishSelectedMenu;
$('menuEditorRestaurant').onchange=()=>{
  menuEditorRestaurantId=$('menuEditorRestaurant').value;
  menuEditorMenu=null;
  renderMenuEditorBranches();
  loadMenuEditor();
};
$('reloadMenuEditorButton').onclick=loadMenuEditor;
$('saveMenuEditorButton').onclick=saveMenuEditor;
$('menuEditorTabs').onclick=(event)=>{
  const button=event.target.closest('[data-menu-editor-tab]');
  if(!button)return;
  menuEditorTab=button.dataset.menuEditorTab;
  renderMenuEditor();
};
$('menuEditorBody').onchange=(event)=>{
  const input=event.target.closest('[data-menu-array][data-menu-index][data-menu-key]');
  if(!input||!menuEditorMenu)return;
  const row=menuEditorMenu[input.dataset.menuArray]?.[Number(input.dataset.menuIndex)];
  if(!row)return;
  let value=input.type==='checkbox'?input.checked:input.value;
  if(input.type==='number')value=Number(value||0);
  row[input.dataset.menuKey]=value;
};
$('menuEditorBody').onclick=(event)=>{
  const button=event.target.closest('[data-menu-add]');
  if(!button||!menuEditorOnline||!menuEditorEnabled||!menuEditorMenu)return;
  const array=button.dataset.menuAdd;
  menuEditorMenu[array] ||= [];
  menuEditorMenu[array].push(newMenuRecord(array));
  renderMenuEditor();
};
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
