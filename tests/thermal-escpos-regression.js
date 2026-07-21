const assert = require('assert');
const { buildThermalEscPos, buildThermalPreview, columns, wrap } = require('../pos-app/electron/thermalEscPos');
const { groupPrintableItems } = require('../pos-app/backend/services/printItemGrouping');

assert.deepStrictEqual(wrap('Butter Naan', 8), ['Butter', 'Naan']);
assert.deepStrictEqual(columns(['Item', '2'], [6, 3], ['left', 'right']), ['Item    2']);

const kot = buildThermalEscPos({
  type: 'KOT', ref_id: '14-A14-1', paper_width_mm: 58, created_at: '2026-07-21T09:05:47Z',
  payload: { printLayout: { printWidth58: 30, fontType: 'FONT_B', fontSize: 'COMPACT', lineSpacingDots: 20, leftMarginDots: 0 }, headerText: 'KMaster Demo Kitchen', kotReference: '14-A14-1', orderType: 'DINE_IN', tableName: 'Table 1', items: [{ name: 'Butter Naan', quantity: 1, notes: '--' }], footerText: 'Demo order - not for billing' }
}, groupPrintableItems);
const kotText = kot.toString('ascii');
assert(kotText.indexOf('KMaster Demo Kitchen') < kotText.indexOf('KOT'));
assert(kotText.indexOf('Table No: Table 1') < kotText.indexOf('Butter Naan'));
assert(kotText.indexOf('Butter Naan') < kotText.indexOf('Demo order - not for billing'));
assert(kot.length < 1000, 'compact one-item KOT must not contain a page-sized raster or blank feed');
assert(!kot.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00])), 'default KOT must not issue an application cut');
assert(kot.includes(Buffer.from([0x1b, 0x4d, 0x01])), 'compact KOT must select condensed printer font B');
assert(kot.includes(Buffer.from([0x1b, 0x33, 0x14])), 'KOT must apply configured 20-dot line spacing');
assert(kot.includes(Buffer.from([0x1d, 0x4c, 0x00, 0x00])), 'KOT must apply configured zero left inset without top feed');

const bill = buildThermalEscPos({
  type: 'BILL', paper_width_mm: 80,
  payload: { printLayout: { printWidth80: 40, fontType: 'FONT_A', fontSize: 'NORMAL', lineSpacingDots: 22 }, invoiceNo: 'DEMO-00037', orderReference: '13-A13', tableNumber: 'Table 1', settledAt: '21/07/2026 09:07', payable: 215,
    restaurantProfile: { displayName: 'KMaster White Label Demo Restaurant', legalName: 'KMaster Demo Foods', gstin: '33ABCDE1234F1Z5', fssaiLicenseNo: '12345678901234', state: 'Tamil Nadu', stateCode: '33', showTaxOnBill: true, footerText: 'THANK YOU. VISIT AGAIN.' },
    items: [{ name: 'Chapati', quantity: 1, price: 35 }, { name: 'Chicken 65', quantity: 1, price: 180 }] }
}, groupPrintableItems);
const billText = bill.toString('ascii');
for (const marker of ['TAX INVOICE', 'Chapati', 'CGST @ 2.50%', 'SGST @ 2.50%', 'GRAND TOTAL', 'THANK YOU. VISIT AGAIN.', 'Authorised Signatory']) assert(billText.includes(marker), marker);
assert(billText.indexOf('GRAND TOTAL') < billText.indexOf('THANK YOU. VISIT AGAIN.'));
assert(bill.length < 2500, 'bill must be compact continuous text rather than a paged bitmap');
assert(bill.includes(Buffer.from([0x1b, 0x33, 0x16])), 'bill must apply configured 22-dot line spacing');
assert(!bill.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00])), 'default bill must not issue an application cut');
const explicitCut = buildThermalEscPos({ type: 'KOT', paper_width_mm: 58, payload: { printLayout: { cutMode: 'PARTIAL' }, items: [] } }, (items) => items);
assert.deepStrictEqual([...explicitCut.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);
const fullCut = buildThermalEscPos({ type: 'BILL', paper_width_mm: 80, payload: { printLayout: { cutMode: 'FULL' }, items: [] } }, (items) => items);
assert.deepStrictEqual([...fullCut.subarray(-4)], [0x1d, 0x56, 0x41, 0x00]);
assert(fullCut.indexOf(Buffer.from('Authorised Signatory')) < fullCut.length - 4, 'footer must be emitted before feed-and-cut');
const kotPreview = buildThermalPreview({ type: 'KOT', paper_width_mm: 58, created_at: '2026-07-21T09:05:47Z', payload: { printLayout: { printWidth58: 30, styles: { title: { fontSize: 'LARGE', alignment: 'CENTER', bold: true }, items: { fontType: 'FONT_B', fontSize: 'SMALL', alignment: 'LEFT' } } }, headerText: 'Kitchen', kotReference: 'A1-1', orderType: 'DINE_IN', tableName: 'Table 1', items: [{ name: 'Butter Naan', quantity: 1 }] } }, groupPrintableItems);
assert.strictEqual(kotPreview.width, 30);
assert(kotPreview.text.includes('Table No: Table 1') && kotPreview.text.includes('Butter Naan'));

function assertRowsFit(preview, paperWidth) {
  for (const row of preview.rows) {
    const condensed = row.fontType === 'FONT_B' || row.fontSize === 'SMALL';
    const condensedLimit = paperWidth === 80 ? 56 : 42;
    let capacity = condensed ? Math.min(condensedLimit, Math.floor(preview.width * 1.5)) : preview.width;
    if (row.fontSize === 'LARGE') capacity = Math.max(12, Math.floor(capacity / 2));
    assert(row.text.length <= capacity, `${paperWidth} mm ${row.text} exceeds ${capacity} printable characters`);
  }
}

const printStyles = {
  bill: { header: { alignment: 'CENTER', bold: true }, title: { fontSize: 'LARGE', alignment: 'CENTER', bold: true }, details: { fontType: 'FONT_B', fontSize: 'SMALL', alignment: 'LEFT' }, items: { alignment: 'LEFT' }, totals: { alignment: 'LEFT', bold: true }, footer: { alignment: 'CENTER' } },
  kot: { header: { fontType: 'FONT_B', fontSize: 'SMALL', alignment: 'CENTER' }, title: { fontSize: 'LARGE', alignment: 'CENTER', bold: true }, details: { alignment: 'CENTER', bold: true }, items: { alignment: 'LEFT' }, footer: { fontType: 'FONT_B', fontSize: 'SMALL', alignment: 'CENTER' } }
};
for (const paperWidth of [58, 80]) {
  const printWidth = paperWidth === 58 ? 32 : 48;
  const layout = { printWidth58: 32, printWidth80: 48, detailsLayout: 'TWO_COLUMN' };
  const visualKot = buildThermalPreview({ type: 'KOT', paper_width_mm: paperWidth, created_at: '2026-07-21T09:05:47Z', payload: { printLayout: { ...layout, styles: printStyles.kot }, headerText: 'KMaster Kitchen', kotReference: 'A12-2', orderType: 'DINE_IN', tableName: 'Table 1', items: [{ name: 'Chicken Biryani', quantity: 2, notes: 'Less spicy' }, { name: 'Arabian Grape Juice', quantity: 1, notes: 'No ice' }], footerText: 'Demo order - not for billing' } }, groupPrintableItems);
  assert.strictEqual(visualKot.width, printWidth);
  assertRowsFit(visualKot, paperWidth);
  assert(visualKot.rows.some((row) => row.text.trim() === 'Table No: Table 1'), `${paperWidth} mm table number must stay on one line`);
  assert(visualKot.rows.some((row) => row.text.trimEnd().endsWith('Qty')), `${paperWidth} mm Qty heading must remain visible`);
  assert.strictEqual(visualKot.rows.at(-1).text, 'Demo order - not for billing', `${paperWidth} mm KOT must not contain artificial trailing blank rows`);

  const visualBill = buildThermalPreview({ type: 'BILL', paper_width_mm: paperWidth, payload: { printLayout: { ...layout, styles: printStyles.bill }, finalBill: true, invoiceNo: 'FINAL-A12', settledAt: '22/07/2026 16:00', orderReference: 'A12', tableNumber: 'Table 1', kotReferences: 'A12-1, A12-2', customerName: 'Rasika Sekar', payable: 5180, taxRate: 5, restaurantProfile: { displayName: 'KMaster Restaurant', gstin: '33ABCDE1234F1Z5', fssaiLicenseNo: '12345678901234', footerText: 'THANK YOU. VISIT AGAIN.' }, items: [{ name: 'Chicken Biryani', quantity: 10, price: 219.05 }] } }, groupPrintableItems);
  assertRowsFit(visualBill, paperWidth);
  const titleRow = visualBill.rows.find((row) => row.text === 'FINAL BILL');
  assert(titleRow && titleRow.alignment === 'CENTER', `${paperWidth} mm bill title must be exactly centered`);
  for (const label of ['Taxable value', 'CGST @ 2.50%', 'SGST @ 2.50%', 'GRAND TOTAL']) {
    const row = visualBill.rows.find((candidate) => candidate.text.startsWith(label));
    assert(row && row.alignment === 'LEFT' && /INR\s+[0-9]+\.[0-9]{2}$/.test(row.text), `${paperWidth} mm ${label} must use full width with a right-aligned amount`);
  }
}

console.log('Thermal ESC/POS regression passed (continuous 58/80 mm KOT and bill output)');
