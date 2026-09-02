const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pos-app/backend/public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pos-app/backend/public/js/admin-dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos-app/backend/public/css/style.css'), 'utf8');

const expectedFilters = [
  'item_code', 'name', 'barcode', 'retail_stock', 'tax_mode', 'category_name',
  'kitchen_name', 'price', 'allow_dine_in', 'allow_parcel', 'allow_party_order',
  'allow_retail', 'online_enabled', 'active'
];

for (const field of expectedFilters) {
  assert.match(html, new RegExp(`data-item-filter=["']${field}["']`), `missing ${field} column filter`);
}
assert.doesNotMatch(html, /Alphabetic short code|Numeric short code|Alpha code|Number code|data-item-filter=["'](?:alpha|numeric)_short_code["']/, 'legacy duplicate short-code controls must not be displayed');

assert.match(html, /id="clearItemFilters"/, 'missing clear filters control');
assert.match(html, /id="itemFilterCount"/, 'missing visible item count');
assert.match(js, /document\.querySelectorAll\('\[data-item-filter\]'\)/, 'column filter controls are not wired');
assert.match(js, /booleanItemFields\.has\(field\)/, 'availability boolean filters are not applied');
assert.match(js, /visibleItems = items\.filter/, 'item rows are not filtered before rendering');
assert.match(js, /clearItemFilters\.addEventListener/, 'clear filters action is not wired');
assert.match(css, /\.availability-items-table \.item-column-filters/, 'column filters are not styled for the availability table');

console.log(`PASS item column filters (${expectedFilters.length} columns)`);
