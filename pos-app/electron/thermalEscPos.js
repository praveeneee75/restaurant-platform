const ESC = 0x1b;
const GS = 0x1d;

function text(value) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, ' ');
}

function wrap(value, width) {
  const source = text(value).trim();
  if (!source) return [''];
  const lines = [];
  let remaining = source;
  while (remaining.length > width) {
    let split = remaining.lastIndexOf(' ', width);
    if (split < Math.floor(width / 2)) split = width;
    lines.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
  }
  lines.push(remaining);
  return lines;
}

function center(value, width) {
  return wrap(value, width).map((line) => `${' '.repeat(Math.max(0, Math.floor((width - line.length) / 2)))}${line}`);
}

function columns(values, widths, aligns = []) {
  const cells = values.map((value, index) => wrap(value, widths[index]));
  const height = Math.max(...cells.map((cell) => cell.length));
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    rows.push(cells.map((cell, index) => {
      const value = cell[row] || '';
      const padding = ' '.repeat(Math.max(0, widths[index] - value.length));
      return aligns[index] === 'right' ? padding + value : value + padding;
    }).join(''));
  }
  return rows;
}

function calculateBill(payload) {
  const profile = payload.restaurantProfile || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const grandTotal = Number(payload.payable || 0);
  const taxRate = profile.gstin && profile.showTaxOnBill !== false ? Number(payload.taxRate || 5) : 0;
  const totalTax = taxRate > 0 ? grandTotal * taxRate / (100 + taxRate) : 0;
  const serviceCharge = Number(payload.serviceCharge || 0);
  const taxableValue = Math.max(grandTotal - totalTax - serviceCharge, 0);
  return { profile, items, grandTotal, taxRate, totalTax, serviceCharge, taxableValue };
}

function buildThermalEscPos(job, groupedItems) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload || '{}') : (job.payload || {});
  const layout = payload.printLayout || {};
  const width = Number(job.paper_width_mm) === 80
    ? Math.max(32, Math.min(48, Number(layout.printWidth80) || 38))
    : Math.max(24, Math.min(32, Number(layout.printWidth58) || 28));
  const leftMarginDots = Math.max(0, Math.min(255, Number(layout.leftMarginDots ?? 0) || 0));
  const trailingFeedLines = Math.max(0, Math.min(8, Number(layout.trailingFeedLines ?? 0) || 0));
  const cutMode = String(layout.cutMode || 'PRINTER_DEFAULT').toUpperCase();
  const fontSize = String(layout.fontSize || 'NORMAL').toUpperCase();
  const fontType = fontSize === 'COMPACT' ? 'FONT_B' : String(layout.fontType || 'FONT_A').toUpperCase();
  const lineSpacingDots = Math.max(16, Math.min(60, Number(layout.lineSpacingDots) || 24));
  const chunks = [];
  const bytes = (...values) => chunks.push(Buffer.from(values));
  const line = (value = '') => chunks.push(Buffer.from(`${text(value)}\n`, 'ascii'));
  const lines = (values) => values.forEach(line);
  const align = (value) => bytes(ESC, 0x61, value);
  const bold = (enabled) => bytes(ESC, 0x45, enabled ? 1 : 0);
  const size = (value) => bytes(GS, 0x21, value);

  bytes(ESC, 0x40); // Initialise. No leading feed and no page/form mode.
  bytes(ESC, 0x4d, fontType === 'FONT_B' ? 1 : 0); // Select thermal font A/B.
  bytes(ESC, 0x33, lineSpacingDots); // Explicit line spacing; avoids driver-dependent gaps.
  if (fontSize === 'TALL') size(0x01);
  // Match proven thermal layouts: a small left inset and no top/bottom form margin.
  // GS L changes the printable origin without introducing a page-sized canvas.
  bytes(GS, 0x4c, leftMarginDots & 0xff, (leftMarginDots >> 8) & 0xff);

  if (String(job.type).toUpperCase() === 'KOT') {
    const orderType = String(payload.orderType || 'DINE_IN').toUpperCase();
    const orderLabel = orderType === 'DINE_IN' ? 'Dine In' : ['PARCEL', 'TAKEAWAY'].includes(orderType) ? 'Parcel' : orderType.replaceAll('_', ' ');
    align(1);
    if (payload.headerText) lines(center(payload.headerText, width));
    bold(true); size(0x11); line('KOT'); size(0); bold(false);
    line(new Date(job.created_at || Date.now()).toLocaleString('en-IN'));
    line(`KOT - ${payload.kotReference || payload.kotId || job.ref_id}`);
    bold(true); line(orderLabel);
    if (orderType === 'DINE_IN' && payload.printTable !== false) {
      size(0x10); lines(center(`Table No: ${payload.tableName || 'Not assigned'}`, Math.floor(width / 2))); size(0);
    }
    bold(false);
    if (payload.printCustomer && payload.customerName) line(`Customer: ${payload.customerName}`);
    if (payload.printKitchen && payload.kitchen) line(`Kitchen: ${payload.kitchen}`);
    align(0); line('-'.repeat(width));
    const itemWidth = Math.floor(width * 0.48);
    const noteWidth = Math.floor(width * 0.39);
    lines(columns(['Item', 'Special Note', 'Qty'], [itemWidth, noteWidth, width - itemWidth - noteWidth], ['left', 'left', 'right']));
    line('-'.repeat(width));
    for (const item of payload.items || []) {
      lines(columns([item.name || item.combo_name || 'Item', item.notes || '--', item.quantity || 0], [itemWidth, noteWidth, width - itemWidth - noteWidth], ['left', 'left', 'right']));
    }
    if (payload.footerText) { line('-'.repeat(width)); align(1); lines(center(payload.footerText, width)); }
  } else {
    const { profile, grandTotal, taxRate, totalTax, serviceCharge, taxableValue } = calculateBill(payload);
    const items = groupedItems(payload.items || []);
    align(1); bold(true); size(0x01);
    lines(center(profile.displayName || profile.legalName || 'Restaurant', width));
    size(0); bold(false);
    if (profile.legalName && profile.legalName !== profile.displayName) lines(center(profile.legalName, width));
    lines(center([profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.stateCode ? `Code ${profile.stateCode}` : '', profile.country].filter(Boolean).join(', '), width));
    if (profile.printContact !== false) lines(center([profile.phone, profile.email].filter(Boolean).join(' '), width));
    bold(true);
    if (profile.gstin) lines(center(`GSTIN: ${profile.gstin}`, width));
    if (profile.fssaiLicenseNo) lines(center(`FSSAI: ${profile.fssaiLicenseNo}`, width));
    line('-'.repeat(width));
    line(payload.finalBill ? 'FINAL BILL' : (profile.gstin ? 'TAX INVOICE' : 'BILL / RECEIPT'));
    line('-'.repeat(width)); bold(false); align(0);
    const labelWidth = Math.max(10, Math.floor(width * 0.34));
    const meta = (label, value) => lines(columns([label, value], [labelWidth, width - labelWidth]));
    meta(payload.finalBill ? 'Bill Ref.' : 'Invoice No.', payload.invoiceNo || '');
    meta('Date / Time', payload.settledAt || '');
    meta('Order / Table', `${payload.orderReference || payload.orderId || ''} / ${payload.tableNumber || payload.orderType || ''}`);
    if (profile.printKotReferences !== false && payload.kotReferences) meta('KOT No(s).', payload.kotReferences);
    if (profile.printCustomer !== false) meta('Customer', payload.customerName || 'Walk-in customer');
    if (profile.printPayment !== false) meta('Payment', payload.paymentMode || '');
    if (profile.gstin) {
      meta('Place supply', `${profile.state || 'Tamil Nadu'} (${profile.stateCode || '33'})`);
      meta('SAC', profile.sacCode || '996331');
      meta('Reverse chg.', 'No');
    }
    line('-'.repeat(width));
    const qtyWidth = 4; const amountWidth = width >= 40 ? 11 : 9; const itemWidth = width - qtyWidth - amountWidth;
    lines(columns(['Item', 'Qty', 'Amount'], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right']));
    line('-'.repeat(width));
    items.forEach((item) => lines(columns([item.name, item.quantity, (Number(item.quantity || 0) * Number(item.price || 0)).toFixed(2)], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right'])));
    line('-'.repeat(width));
    const money = (label, value) => lines(columns([label, `INR ${Number(value).toFixed(2)}`], [width - amountWidth - 4, amountWidth + 4], ['left', 'right']));
    if (serviceCharge > 0) money('Service charge', serviceCharge);
    if (taxRate > 0) {
      money('Taxable value', taxableValue);
      money(`CGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money(`SGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money('Total GST', totalTax);
    }
    bold(true); size(0x01); money('GRAND TOTAL', grandTotal); size(0); bold(false);
    align(1); line('-'.repeat(width));
    if (profile.footerText) lines(center(profile.footerText, width));
    if (profile.printAuthorisedSignatory !== false) line('Authorised Signatory');
  }

  align(0);
  for (let index = 0; index < trailingFeedLines; index += 1) line('');
  // Windows/printer drivers commonly perform their configured cut at EndDocPrinter.
  // Sending another ESC/POS cut caused the body/footer to be split on real 58/80 mm
  // printers. Therefore the safe default emits no cutter command. Explicit modes
  // remain available for printers whose RAW queue does not perform a cut.
  if (cutMode === 'PARTIAL') bytes(GS, 0x56, 0x01);
  if (cutMode === 'FULL') bytes(GS, 0x56, 0x00);
  return Buffer.concat(chunks);
}

module.exports = { buildThermalEscPos, columns, wrap };
