const assert = require('assert');
const { groupPrintableItems } = require('../pos-app/backend/services/printItemGrouping');

const original = [
  { item_id: 1, name: 'Butter Naan', quantity: 1, price: 55, notes: '' },
  { item_id: 2, name: 'Chapati', quantity: 1, price: 35, notes: '' },
  { item_id: 1, name: 'Butter Naan', quantity: 2, price: 55, notes: '' },
  { item_id: 1, name: 'Butter Naan', quantity: 1, price: 60, notes: '' },
  { item_id: 1, name: 'Butter Naan', quantity: 1, price: 55, notes: 'No butter' },
  { item_id: 1, name: 'Butter Naan', quantity: 1, price: 55, notes: '', modifiers: [{ name: 'Extra butter' }] }
];
const grouped = groupPrintableItems(original);

assert.strictEqual(grouped.length, 5, 'only truly identical printable lines should merge');
assert.strictEqual(grouped[0].quantity, 3, 'identical quantities should be summed');
const total = (rows) => rows.reduce((sum, row) => sum + Number(row.quantity) * Number(row.price), 0);
assert.strictEqual(total(grouped), total(original), 'grouping must not change the printed monetary total');
assert.strictEqual(original[0].quantity, 1, 'grouping must not mutate saved order items');

console.log('Print item grouping regression passed');
