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
  return buildThermalDocument(job, groupedItems).data;
}

function buildThermalDocument(job, groupedItems = (items) => items) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload || '{}') : (job.payload || {});
  const layout = payload.printLayout || {};
  const width = Number(job.paper_width_mm) === 80
    ? Math.max(32, Math.min(48, Number(layout.printWidth80) || 38))
    : Math.max(24, Math.min(32, Number(layout.printWidth58) || 28));
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
  const styledWidth = (sectionFont, sectionSize) => {
    const condensed = sectionFont === 'FONT_B' || sectionSize === 'SMALL';
    const enlarged = sectionSize === 'LARGE';
    const condensedLimit = Number(job.paper_width_mm) === 80 ? 56 : 42;
    const capacity = condensed ? Math.min(condensedLimit, Math.floor(width * 1.5)) : width;
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
    bytes(ESC, 0x4d, sectionSize === 'SMALL' || sectionFont === 'FONT_B' ? 1 : 0);
    size(sectionSize === 'LARGE' ? 0x11 : 0x00);
    bold(currentBold);
    align(sectionAlignment === 'CENTER' ? 1 : sectionAlignment === 'RIGHT' ? 2 : 0);
  };

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
    applyStyle('header', { alignment: 'CENTER' });
    if (payload.headerText) lines(wrap(payload.headerText, width));
    applyStyle('title', { alignment: 'CENTER', fontSize: 'LARGE', bold: true }); line('KOT');
    applyStyle('details', { alignment: 'CENTER' });
    line(new Date(job.created_at || Date.now()).toLocaleString('en-IN'));
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
    const { profile, grandTotal, taxRate, totalTax, serviceCharge, taxableValue } = calculateBill(payload);
    const items = groupedItems(payload.items || []);
    applyStyle('header', { alignment: 'CENTER', bold: true });
    lines(wrap(profile.displayName || profile.legalName || 'Restaurant', width));
    if (profile.legalName && profile.legalName !== profile.displayName) lines(wrap(profile.legalName, width));
    lines(wrap([profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.stateCode ? `Code ${profile.stateCode}` : '', profile.country].filter(Boolean).join(', '), width));
    if (profile.printContact !== false) lines(wrap([profile.phone, profile.email].filter(Boolean).join(' '), width));
    if (profile.gstin) lines(wrap(`GSTIN: ${profile.gstin}`, width));
    if (profile.fssaiLicenseNo) lines(wrap(`FSSAI: ${profile.fssaiLicenseNo}`, width));
    applyStyle('details', { alignment: 'CENTER' });
    line('-'.repeat(currentLineWidth));
    applyStyle('title', { alignment: 'CENTER', bold: true });
    line(payload.finalBill ? 'FINAL BILL' : (profile.gstin ? 'TAX INVOICE' : 'BILL / RECEIPT'));
    applyStyle('details', { alignment: 'CENTER' });
    line('-'.repeat(currentLineWidth));
    applyStyle('details', { alignment: 'LEFT' });
    const metadata = [
      [payload.finalBill ? 'Bill Ref.' : 'Invoice No.', payload.invoiceNo || ''],
      ['Date / Time', payload.settledAt || ''],
      ['Order / Table', `${payload.orderReference || payload.orderId || ''} / ${payload.tableNumber || payload.orderType || ''}`],
      ...(profile.printKotReferences !== false && payload.kotReferences ? [['KOT No(s).', payload.kotReferences]] : []),
      ...(profile.printCustomer !== false ? [['Customer', payload.customerName || 'Walk-in customer']] : []),
      ...(profile.printPayment !== false && payload.paymentMode ? [['Payment', payload.paymentMode]] : []),
      ...(profile.gstin ? [['SAC', profile.sacCode || '996331'], ['Reverse chg.', 'No']] : [])
    ];
    if (String(layout.detailsLayout || 'TWO_COLUMN').toUpperCase() === 'TWO_COLUMN') {
      const detailWidth = currentLineWidth;
      const usableWidth = detailWidth - 1;
      const half = Math.floor(usableWidth / 2); const rightHalf = usableWidth - half;
      const labelWidth = Math.max(5, Math.floor(half * 0.38));
      const rightLabelWidth = Math.max(5, Math.floor(rightHalf * 0.38));
      for (let index = 0; index < metadata.length; index += 2) {
        const left = metadata[index]; const right = metadata[index + 1] || ['', ''];
        const compactLabel = (label) => ({ 'Bill Ref.': 'Bill', 'Invoice No.': 'Invoice', 'Date / Time': 'Date', 'Order / Table': 'Order', 'KOT No(s).': 'KOT', Customer: 'Cust', 'Reverse chg.': 'Rev' }[label] || label);
        lines(columns([compactLabel(left[0]), left[1], '', compactLabel(right[0]), right[1]], [labelWidth, half - labelWidth, 1, rightLabelWidth, rightHalf - rightLabelWidth]));
      }
    } else {
      const detailWidth = currentLineWidth;
      const labelWidth = Math.max(10, Math.floor(detailWidth * 0.34));
      metadata.forEach(([label, value]) => lines(columns([label, value], [labelWidth, detailWidth - labelWidth])));
    }
    applyStyle('items', { alignment: 'LEFT' }); line('-'.repeat(width));
    const qtyWidth = 4; const amountWidth = width >= 40 ? 11 : 9; const itemWidth = width - qtyWidth - amountWidth;
    lines(columns(['Item', 'Qty', 'Amount'], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right']));
    line('-'.repeat(width));
    items.forEach((item) => lines(columns([item.name, item.quantity, (Number(item.quantity || 0) * Number(item.price || 0)).toFixed(2)], [itemWidth, qtyWidth, amountWidth], ['left', 'right', 'right'])));
    line('-'.repeat(width));
    applyStyle('totals', { alignment: 'LEFT' });
    const money = (label, value) => lines(columns([label, `INR ${Number(value).toFixed(2)}`], [width - amountWidth - 4, amountWidth + 4], ['left', 'right']));
    if (serviceCharge > 0) money('Service charge', serviceCharge);
    if (taxRate > 0) {
      money('Taxable value', taxableValue);
      money(`CGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money(`SGST @ ${(taxRate / 2).toFixed(2)}%`, totalTax / 2);
      money('Total GST', totalTax);
    }
    money('GRAND TOTAL', grandTotal);
    applyStyle('footer', { alignment: 'CENTER' }); line('-'.repeat(width));
    if (profile.footerText) lines(wrap(profile.footerText, width));
    if (profile.printAuthorisedSignatory !== false) line('Authorised Signatory');
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
      text: previewLines.join('\n'), rows: previewRows, width, fontType, fontSize, lineSpacingDots,
      cutMode, paperWidthMm: Number(job.paper_width_mm) === 80 ? 80 : 58
    }
  };
}

function buildThermalPreview(job, groupedItems) {
  return buildThermalDocument(job, groupedItems).preview;
}

module.exports = { buildThermalEscPos, buildThermalPreview, columns, wrap };
