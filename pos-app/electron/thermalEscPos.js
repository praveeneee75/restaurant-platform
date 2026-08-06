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

function posDate(value = Date.now()) {
  if (value instanceof Date || typeof value === 'number') return new Date(value);
  const source = String(value || '').trim();
  // SQLite CURRENT_TIMESTAMP is UTC but omits the timezone suffix. Treating it
  // as local time causes every POS screen/print to drift by the PC offset.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
    ? `${source.replace(' ', 'T')}Z`
    : source;
  return new Date(normalized);
}

function compactLocalDateTime(value) {
  const date = posDate(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '');
}

function compactKotReferences(value) {
  const references = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (references.length < 2) return references.join(', ');
  const output = [];
  let previousPrefix = '';
  references.forEach((reference) => {
    const match = reference.match(/^(.*-)([^-]+)$/);
    if (match && match[1] === previousPrefix) output.push(match[2]);
    else {
      output.push(reference);
      previousPrefix = match ? match[1] : '';
    }
  });
  return output.join(',');
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
  const discountAmount = Math.max(0, Number(payload.discountAmount || 0) + Number(payload.loyaltyDiscount || 0));
  const taxableValue = Math.max(grandTotal - totalTax - serviceCharge, 0);
  return { profile, items, grandTotal, taxRate, totalTax, serviceCharge, discountAmount, taxableValue };
}

function buildThermalEscPos(job, groupedItems) {
  return buildThermalDocument(job, groupedItems).data;
}

function buildThermalDocument(job, groupedItems = (items) => items) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload || '{}') : (job.payload || {});
  const layout = payload.printLayout || {};
  const width = Number(job.paper_width_mm) === 80
    ? Math.max(32, Math.min(48, Number(layout.printWidth80) || 38))
    : Math.max(24, Math.min(32, Number(layout.printWidth58) || 28));
  const isKot = String(job.type).toUpperCase() === 'KOT';
  const isReport = String(job.type).toUpperCase() === 'REPORT';
  const template = String(payload.restaurantProfile?.billTemplate || payload.template || 'BORDERED').toUpperCase();
  const ruleCharacter = template === 'MODERN' ? '=' : template === 'MINIMAL' ? ' ' : '-';
  // Bill rows carry more columns than KOT rows. Some Windows thermal drivers
  // expose 48 columns in configuration but physically wrap after 42 on 80 mm.
  // Keep this bill-only so the proven KOT layout remains byte-for-byte stable.
  const billPhysicalWidth = Number(job.paper_width_mm) === 80 ? Math.min(width, 42) : Math.min(width, 32);
  const leftMarginDots = Math.max(0, Math.min(255, Number(layout.leftMarginDots ?? 0) || 0));
  const trailingFeedLines = Math.max(0, Math.min(8, Number(layout.trailingFeedLines ?? 0) || 0));
  const requestedCutMode = String(layout.cutMode || 'NONE').toUpperCase();
  const cutMode = requestedCutMode === 'PRINTER_DEFAULT' ? 'NONE' : requestedCutMode;
  const fontSize = String(layout.fontSize || 'NORMAL').toUpperCase();
  const fontType = fontSize === 'COMPACT' ? 'FONT_B' : String(layout.fontType || 'FONT_A').toUpperCase();
  const lineSpacingDots = Math.max(16, Math.min(60, Number(layout.lineSpacingDots) || 24));
  const chunks = [];
  const previewLines = [];
  const previewRows = [];
  let currentAlignment = 0;
  let currentFontType = fontType;
  let currentFontSize = fontSize;
  let currentBold = false;
  let currentLineWidth = width;
  const fontCode = (value) => ({ FONT_A: 0, FONT_B: 1, FONT_C: 2, FONT_D: 3 }[value] ?? 0);
  const styledWidth = (sectionFont, sectionSize) => {
    const condensed = ['FONT_B', 'FONT_D'].includes(sectionFont) || ['SMALL', 'COMPACT'].includes(sectionSize);
    const enlarged = sectionSize === 'LARGE';
    const condensedLimit = Number(job.paper_width_mm) === 80 ? 56 : 42;
    const capacity = isKot
      ? (condensed ? Math.min(condensedLimit, Math.floor(width * 1.5)) : width)
      : billPhysicalWidth;
    return Math.max(12, enlarged ? Math.floor(capacity / 2) : capacity);
  };
  const bytes = (...values) => chunks.push(Buffer.from(values));
  const line = (value = '') => {
    const printable = text(value);
    chunks.push(Buffer.from(`${printable}\n`, 'ascii'));
    if (currentAlignment === 1 && printable.length < currentLineWidth) {
      previewLines.push(`${' '.repeat(Math.floor((currentLineWidth - printable.length) / 2))}${printable}`);
    } else if (currentAlignment === 2 && printable.length < currentLineWidth) {
      previewLines.push(`${' '.repeat(currentLineWidth - printable.length)}${printable}`);
    } else previewLines.push(printable);
    previewRows.push({ text: printable, fontType: currentFontType, fontSize: currentFontSize, bold: currentBold, alignment: currentAlignment === 1 ? 'CENTER' : currentAlignment === 2 ? 'RIGHT' : 'LEFT' });
  };
  const lines = (values) => values.forEach(line);
  const align = (value) => { currentAlignment = value; bytes(ESC, 0x61, value); };
  const bold = (enabled) => bytes(ESC, 0x45, enabled ? 1 : 0);
  const size = (value) => bytes(GS, 0x21, value);
  const sectionStyles = layout.styles && typeof layout.styles === 'object' ? layout.styles : {};
  const applyStyle = (section, defaults = {}) => {
    const style = sectionStyles[section] || {};
    const sectionFont = String(style.fontType || defaults.fontType || fontType).toUpperCase();
    const sectionSize = String(style.fontSize || defaults.fontSize || 'NORMAL').toUpperCase();
    const sectionAlignment = String(style.alignment || defaults.alignment || 'LEFT').toUpperCase();
    currentFontType = sectionFont;
    currentFontSize = sectionSize;
    currentLineWidth = styledWidth(sectionFont, sectionSize);
    currentBold = style.bold === undefined ? Boolean(defaults.bold) : Boolean(style.bold);
    bytes(ESC, 0x4d, ['SMALL', 'COMPACT'].includes(sectionSize) ? 1 : fontCode(sectionFont));
    size(sectionSize === 'LARGE' ? 0x11 : sectionSize === 'TALL' ? 0x01 : 0x00);
    bold(currentBold);
    align(sectionAlignment === 'CENTER' ? 1 : sectionAlignment === 'RIGHT' ? 2 : 0);
  };

  bytes(ESC, 0x40); // Initialise. No leading feed and no page/form mode.
  bytes(ESC, 0x4d, fontCode(fontType)); // Select a supported ESC/POS resident font.
  bytes(ESC, 0x33, lineSpacingDots); // Explicit line spacing; avoids driver-dependent gaps.
  if (fontSize === 'TALL') size(0x01);
  // Match proven thermal layouts: a small left inset and no top/bottom form margin.
  // GS L changes the printable origin without introducing a page-sized canvas.
  bytes(GS, 0x4c, leftMarginDots & 0xff, (leftMarginDots >> 8) & 0xff);

  if (isReport) {
    const profile = payload.restaurantProfile || {};
    const reportWidth = billPhysicalWidth;
    const rule = () => line('-'.repeat(reportWidth));
    const amount = (value) => Number(value || 0).toFixed(2);
    const labelAmount = (label, value) => lines(columns([label, amount(value)], [Math.max(12, reportWidth - 13), Math.min(13, reportWidth - 12)], ['left', 'right']));
    const section = (title) => { line(''); applyStyle('title', { alignment:'LEFT', bold:true }); line(title); applyStyle('items', { alignment:'LEFT' }); };
    applyStyle('header', { alignment:'LEFT', bold:true });
    if (profile.gstin) lines(wrap(`GSTIN:${profile.gstin}`, reportWidth));
    lines(wrap(`${payload.reportType === 'items' ? 'Item Report' : 'Executive Sales Report'} : From ${payload.fromDate || ''}`, reportWidth));
    if (payload.toDate && payload.toDate !== payload.fromDate) lines(wrap(`To ${payload.toDate}`, reportWidth));
    rule();
    if (payload.reportType === 'items') {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const qtyWidth = reportWidth >= 40 ? 8 : 6;
      const totalWidth = reportWidth >= 40 ? 13 : 10;
      const itemWidth = reportWidth - qtyWidth - totalWidth;
      lines(columns(['Category / Item', 'Qty', 'Total'], [itemWidth, qtyWidth, totalWidth], ['left','right','right']));
      rule();
      let grandQty = 0; let grandTotal = 0; let currentCategory = null; let categoryQty = 0; let categoryTotal = 0;
      const finishCategory = () => {
        if (currentCategory === null) return;
        bold(true); lines(columns(['Sub Total', categoryQty.toFixed(2), categoryTotal.toFixed(2)], [itemWidth, qtyWidth, totalWidth], ['left','right','right'])); bold(false);
      };
      rows.forEach((row) => {
        const category = String(row.category || 'Uncategorised');
        if (category !== currentCategory) { finishCategory(); currentCategory = category; categoryQty = 0; categoryTotal = 0; line(category); }
        const quantity = Number(row.quantity || 0); const total = Number(row.total_sales || 0);
        categoryQty += quantity; categoryTotal += total; grandQty += quantity; grandTotal += total;
        lines(columns([`  ${row.item || '-'}`, quantity.toFixed(2), total.toFixed(2)], [itemWidth, qtyWidth, totalWidth], ['left','right','right']));
      });
      finishCategory(); rule(); bold(true); lines(columns(['Total', grandQty.toFixed(2), grandTotal.toFixed(2)], [itemWidth, qtyWidth, totalWidth], ['left','right','right'])); bold(false);
    } else {
      const sales = payload.sales || {}; const paid = sales.paid || {}; const cancelled = sales.cancelled || {};
      section('Billing (Success)');
      lines(columns(['Order', 'Total (INR)'], [reportWidth - 14, 14], ['left','right']));
      labelAmount('Count', paid.count); lines(wrap(`Invoice Nos.: ${paid.invoice_from || '-'} - ${paid.invoice_to || '-'}`, reportWidth));
      const tax = Number(paid.tax || 0);
      labelAmount('Sub Total', paid.sub_total); labelAmount('Discount', paid.discount); labelAmount('Delivery Charge', paid.delivery_charge); labelAmount('Container Charge', paid.container_charge); labelAmount('Service Charge', paid.service_charge); labelAmount('Additional Charge', paid.additional_charge); labelAmount('Other Deduction', paid.other_deduction); labelAmount('C.G.S.T', tax / 2); labelAmount('S.G.S.T', tax / 2); labelAmount('Round Off', paid.round_off); labelAmount('Waived off', paid.waived_off); bold(true); labelAmount('Grand Total', paid.grand_total); labelAmount('Net Sales', paid.net_sales); bold(false);
      section('Billing (Cancel)'); labelAmount('Count', cancelled.count); labelAmount('Amount', cancelled.amount);
      section('Order Type'); lines(columns(['Order', 'Count', 'Total'], [reportWidth - 20, 7, 13], ['left','right','right'])); (sales.orderTypes || []).forEach((row) => lines(columns([row.label, row.count, amount(row.total)], [reportWidth - 20, 7, 13], ['left','right','right']))); if (!(sales.orderTypes || []).length) line('Records not available');
      section('Payment Mode'); lines(columns(['Payment Type', 'Total'], [reportWidth - 13, 13], ['left','right'])); (sales.payments || []).forEach((row) => lines(columns([row.label, amount(row.total)], [reportWidth - 13, 13], ['left','right']))); if (!(sales.payments || []).length) line('Records not available');
      section('Complimentary Orders'); labelAmount('Count', sales.complimentary?.count); labelAmount('Amount', sales.complimentary?.amount);
      section('Sales Return Orders'); labelAmount('Count', sales.returns?.count); labelAmount('Amount', sales.returns?.amount);
      section('Virtual Wallet Summary'); line('Records not available');
      const datedRows = (title, rows) => { section(title); lines(columns(['Date', 'Total'], [reportWidth - 13, 13], ['left','right'])); (rows || []).forEach((row) => lines(columns([row.date, amount(row.total)], [reportWidth - 13, 13], ['left','right']))); if (!(rows || []).length) line('Records not available'); };
      datedRows('Expenses Summary', sales.expenses); datedRows('Withdrawal Summary', sales.withdrawals); datedRows('Cash Top-Up Summary', sales.cashTopups);
      section('Online Orders'); lines(columns(['Payment Type', 'Total', 'Orders'], [reportWidth - 21, 13, 8], ['left','right','right'])); (sales.onlineOrders || []).forEach((row) => lines(columns([row.payment_type, amount(row.total), row.orders], [reportWidth - 21, 13, 8], ['left','right','right']))); if (!(sales.onlineOrders || []).length) line('Records not available');
    }
  } else if (isKot) {
    const orderType = String(payload.orderType || 'DINE_IN').toUpperCase();
    const baseOrderLabel = orderType === 'DINE_IN' ? 'Dine In' : ['PARCEL', 'TAKEAWAY'].includes(orderType) ? 'Parcel' : orderType.replaceAll('_', ' ');
    const orderLabel = orderType !== 'DINE_IN' && payload.tableName
      ? `${baseOrderLabel} order + Table ${String(payload.tableName).replace(/^Table\s*/i, '')}`
      : baseOrderLabel;
    applyStyle('header', { alignment: 'CENTER' });
    if (payload.headerText) lines(wrap(payload.headerText, width));
    applyStyle('title', { alignment: 'CENTER', fontSize: 'LARGE', bold: true }); line('KOT');
    applyStyle('details', { alignment: 'CENTER' });
    line(posDate(job.created_at || Date.now()).toLocaleString('en-IN'));
    line(`KOT - ${payload.kotReference || payload.kotId || job.ref_id}`);
    line(orderLabel);
    if (orderType === 'DINE_IN' && payload.printTable !== false) {
      lines(wrap(`Table No: ${payload.tableName || 'Not assigned'}`, currentLineWidth));
    }
    if (payload.printCustomer && payload.customerName) line(`Customer: ${payload.customerName}`);
    if (payload.printKitchen && payload.kitchen) line(`Kitchen: ${payload.kitchen}`);
    applyStyle('items', { alignment: 'LEFT' }); line('-'.repeat(width));
    const itemWidth = Math.floor((width - 2) * 0.48);
    const noteWidth = Math.floor((width - 2) * 0.39);
    const qtyWidth = width - itemWidth - noteWidth - 2;
    lines(columns(['Item', '', 'Special Note', '', 'Qty'], [itemWidth, 1, noteWidth, 1, qtyWidth], ['left', 'left', 'left', 'left', 'right']));
    line('-'.repeat(width));
    for (const item of payload.items || []) {
      lines(columns([item.name || item.combo_name || 'Item', '', item.notes || '--', '', item.quantity || 0], [itemWidth, 1, noteWidth, 1, qtyWidth], ['left', 'left', 'left', 'left', 'right']));
    }
    if (payload.footerText) { line('-'.repeat(width)); applyStyle('footer', { alignment: 'CENTER' }); lines(wrap(payload.footerText, width)); }
  } else {
    const { profile, grandTotal, taxRate, totalTax, serviceCharge, discountAmount, taxableValue } = calculateBill(payload);
    const show = (key) => profile.lineVisibility?.[key] !== false;
    const invoiceNumber = profile.invoiceNumberFormat === 'LAST4' ? String(payload.invoiceNo || '').slice(-4) : (payload.invoiceNo || '');
    const items = groupedItems(payload.items || []);
    applyStyle('header', { alignment: 'CENTER', bold: true });
    if (show('restaurant_header')) { lines(wrap(profile.displayName || profile.legalName || 'Restaurant', currentLineWidth)); if (profile.legalName && profile.legalName !== profile.displayName) lines(wrap(profile.legalName, currentLineWidth)); }
    if (show('address')) lines(wrap([profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.stateCode ? `Code ${profile.stateCode}` : '', profile.country].filter(Boolean).join(', '), currentLineWidth));
    if (show('contact') && profile.printContact !== false) lines(wrap([profile.phone, profile.email].filter(Boolean).join(' '), currentLineWidth));
    if (show('gstin') && profile.gstin) lines(wrap(`GSTIN: ${profile.gstin}`, currentLineWidth));
    if (show('fssai') && profile.fssaiLicenseNo) lines(wrap(`FSSAI: ${profile.fssaiLicenseNo}`, currentLineWidth));
    applyStyle('details', { alignment: 'CENTER' });
    if (ruleCharacter.trim()) line(ruleCharacter.repeat(currentLineWidth));
    applyStyle('title', { alignment: 'CENTER', bold: true });
    if (show('document_title')) line(payload.finalBill ? 'FINAL BILL' : (profile.gstin ? 'TAX INVOICE' : 'BILL / RECEIPT'));
    applyStyle('details', { alignment: 'CENTER' });
    if (ruleCharacter.trim()) line(ruleCharacter.repeat(currentLineWidth));
    applyStyle('details', { alignment: 'LEFT' });
    const metadata = [
      ...(show('invoice_number') ? [[payload.finalBill ? 'Bill Ref.' : 'Invoice No.', invoiceNumber]] : []),
      ...(show('datetime') ? [['Date / Time', compactLocalDateTime(payload.settledAt || '')]] : []),
      ...(show('order_table') ? [['Order / Table', `${payload.orderReference || payload.orderId || ''}/${payload.tableNumber || payload.orderType || ''}`]] : []),
      ...(show('kot_references') && profile.printKotReferences !== false && payload.kotReferences ? [['KOT No(s).', profile.compactKotReferences === false ? payload.kotReferences : compactKotReferences(payload.kotReferences)]] : []),
      ...(show('customer') && profile.printCustomer !== false ? [['Customer', payload.customerName || 'Walk-in customer']] : []),
      ...(show('payment') && profile.printPayment !== false && payload.paymentMode ? [['Payment', payload.paymentMode]] : []),
      ...(show('tax_details') && profile.gstin ? [['SAC', profile.sacCode || '996331'], ['Reverse chg.', 'No']] : [])
    ];
    if (String(layout.detailsLayout || 'TWO_COLUMN').toUpperCase() === 'TWO_COLUMN') {
      const detailWidth = currentLineWidth;
      const usableWidth = detailWidth - 1;
      const half = Math.floor(usableWidth / 2); const rightHalf = usableWidth - half;
      const labelWidth = Math.max(5, Math.floor(half * 0.38));
      const rightLabelWidth = Math.max(5, Math.floor(rightHalf * 0.38));
      for (let index = 0; index < metadata.length; index += 2) {
        const left = metadata[index]; const right = metadata[index + 1] || ['', ''];
        const compactLabel = (label) => ({ 'Bill Ref.': 'Bill', 'Invoice No.': 'Inv.', 'Date / Time': 'Date', 'Order / Table': 'Ord.', 'KOT No(s).': 'KOT', Customer: 'Cust', Payment: 'Pay', 'Reverse chg.': 'Rev' }[label] || label);
        lines(columns([compactLabel(left[0]), left[1], '', compactLabel(right[0]), right[1]], [labelWidth, half - labelWidth, 1, rightLabelWidth, rightHalf - rightLabelWidth]));
      }
    } else {
      const detailWidth = currentLineWidth;
      const labelWidth = detailWidth < 40 ? 9 : Math.max(10, Math.floor(detailWidth * 0.34));
      const compactLabel = (label) => ({ 'Bill Ref.': 'Bill', 'Invoice No.': 'Invoice', 'Date / Time': 'Date', 'Order / Table': 'Order', 'KOT No(s).': 'KOT', Customer: 'Customer', 'Reverse chg.': 'Rev' }[label] || label);
      metadata.forEach(([label, value]) => lines(columns([compactLabel(label), value], [labelWidth, detailWidth - labelWidth])));
    }
    applyStyle('items', { alignment: 'LEFT' });
    const itemsWidth = currentLineWidth;
    if (show('items') && ruleCharacter.trim()) line(ruleCharacter.repeat(itemsWidth));
    const qtyWidth = 4; const amountWidth = itemsWidth >= 40 ? 11 : 9; const itemWidth = itemsWidth - qtyWidth - amountWidth;
    if (show('items')) { lines(columns(['Item', 'Qty', 'Amount'], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right'])); if (ruleCharacter.trim()) line(ruleCharacter.repeat(itemsWidth)); items.forEach((item) => { const listed = Number(item.quantity || 0) * Number(item.price || 0); const itemIsExclusive = String(item.tax_mode || 'INCLUSIVE').toUpperCase() === 'EXCLUSIVE'; const displayExclusive = String(payload.taxDisplayMode || 'INCLUSIVE').toUpperCase() === 'EXCLUSIVE'; const amount = taxRate > 0 ? (displayExclusive ? (itemIsExclusive ? listed : listed / (1 + taxRate / 100)) : (itemIsExclusive ? listed * (1 + taxRate / 100) : listed)) : listed; lines(columns([item.name, item.quantity, amount.toFixed(2)], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right'])); }); if (ruleCharacter.trim()) line(ruleCharacter.repeat(itemsWidth)); }
    applyStyle('totals', { alignment: 'LEFT' });
    const totalsWidth = currentLineWidth;
    const totalsAmountWidth = totalsWidth >= 40 ? 15 : 13;
    const money = (label, value) => lines(columns([label, `INR ${Number(value).toFixed(2)}`], [totalsWidth - totalsAmountWidth, totalsAmountWidth], ['left', 'right']));
    if (show('service_charge') && serviceCharge > 0) money('Service charge', serviceCharge);
    if (show('discount') && discountAmount > 0) money('Discount', -discountAmount);
    if (show('tax_breakup') && taxRate > 0) {
      money('Taxable value', taxableValue);
      money(`CGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money(`SGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money('Total GST', totalTax);
    }
    if (show('grand_total')) money('GRAND TOTAL', grandTotal);
    applyStyle('footer', { alignment: 'CENTER' }); if (ruleCharacter.trim()) line(ruleCharacter.repeat(currentLineWidth));
    if (show('footer') && profile.footerText) lines(wrap(profile.footerText, currentLineWidth));
    if (show('signatory') && profile.printAuthorisedSignatory !== false) line('Authorised Signatory');
  }

  align(0);
  for (let index = 0; index < trailingFeedLines; index += 1) line('');
  // RAW bypasses the Windows printer driver, so EndDocPrinter cannot be relied on
  // to cut. GS V 65/66 feeds the completed receipt to the cutter before cutting;
  // the immediate GS V 0/1 variants cut several physical lines above the print
  // head and split the footer/body on Epson-compatible 58/80 mm printers.
  if (cutMode === 'PARTIAL') bytes(GS, 0x56, 0x42, 0x00);
  if (cutMode === 'FULL') bytes(GS, 0x56, 0x41, 0x00);
  return {
    data: Buffer.concat(chunks),
    preview: {
      text: previewLines.join('\n'), rows: previewRows, width, physicalWidth: isKot ? width : billPhysicalWidth,
      type: isKot ? 'KOT' : isReport ? 'REPORT' : 'BILL', fontType, fontSize, lineSpacingDots,
      cutMode, paperWidthMm: Number(job.paper_width_mm) === 80 ? 80 : 58
    }
  };
}

function buildThermalPreview(job, groupedItems) {
  return buildThermalDocument(job, groupedItems).preview;
}

module.exports = { buildThermalEscPos, buildThermalPreview, columns, wrap, posDate, compactLocalDateTime, compactKotReferences };
