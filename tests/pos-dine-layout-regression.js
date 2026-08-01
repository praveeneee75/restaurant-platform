const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/pos-live.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos-app/backend/public/css/style.css'), 'utf8');

const checks = [
  [js.includes('const directDineLayout = posMode === "DINE_IN" && !cashierDineLayout'), 'direct Dine In is distinguished from the Billing cashier layout'],
  [js.includes('if (directDineLayout)') && js.includes('categorySlot.replaceWith(categoryPanel)') && js.includes('tableSlot.replaceWith(tableList)'), 'direct Dine In swaps the category and table panels'],
  [js.includes('if (cashierDineLayout)') && js.includes('document.body.classList.add("pos-mode-cashier-dine")'), 'Billing-launched Dine In keeps the cashier layout path'],
  [css.includes('.pos-mode-direct-dine .pos-tables .category-strip') && css.includes('.pos-mode-direct-dine .pos-menu > .table-list'), 'swapped panels have scoped direct Dine In styling'],
  [css.includes('.pos-mode-cashier-dine .pos-tables { display:none; }'), 'Billing cashier table-panel behavior is preserved']
];

for (const [ok, message] of checks) if (!ok) throw new Error(`Dine In layout regression: ${message}`);
console.log('Dine In layout regression passed.');
