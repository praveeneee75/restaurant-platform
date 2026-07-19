function stablePrintableValue(value) {
  if (Array.isArray(value)) return value.map(stablePrintableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stablePrintableValue(value[key]);
      return result;
    }, {});
  }
  return value ?? null;
}

function groupPrintableItems(items = []) {
  const grouped = new Map();
  for (const source of Array.isArray(items) ? items : []) {
    const item = source || {};
    const key = JSON.stringify({
      item: item.item_id ?? item.itemId ?? item.name ?? '',
      name: String(item.name || ''),
      price: Number(item.price || 0),
      notes: String(item.notes || '').trim(),
      modifiers: stablePrintableValue(item.modifiers || item.selectedModifiers || [])
    });
    const quantity = Number(item.quantity || 0);
    const existing = grouped.get(key);
    if (existing) existing.quantity += quantity;
    else grouped.set(key, { ...item, quantity });
  }
  return [...grouped.values()];
}

module.exports = { groupPrintableItems };
