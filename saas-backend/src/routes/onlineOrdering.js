const express = require('express');
const pool = require('../db/db');
const { publicError } = require('../config');

const router = express.Router();

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

async function tenantFromSyncCredentials(restaurantId, licenseKey, syncToken) {
  const result = await pool.query(`
    SELECT t.id, t.name, t.restaurant_code, l.status, l.expires_at,
           org_rest.organization_id
    FROM tenants t
    JOIN licenses l ON l.tenant_id = t.id
    LEFT JOIN organization_restaurants org_rest ON org_rest.tenant_id = t.id AND org_rest.active = true
    WHERE t.restaurant_code = $1
      AND (($2::text IS NOT NULL AND l.license_key = $2) OR ($3::text IS NOT NULL AND l.sync_token = $3))
    LIMIT 1
  `, [restaurantId, licenseKey || null, syncToken || null]);
  if (result.rowCount === 0) return null;
  const tenant = result.rows[0];
  if (tenant.status !== 'ACTIVE' || new Date(tenant.expires_at) < new Date()) return null;
  return tenant;
}

async function onlineOrderingEnabled(tenantId) {
  const result = await pool.query(`
    SELECT 1
    FROM tenant_modules tm
    JOIN modules m ON m.id = tm.module_id
    WHERE tm.tenant_id = $1
      AND tm.enabled = true
      AND m.status = 'ACTIVE'
      AND m.code = 'ONLINE_ORDERING'
    LIMIT 1
  `, [tenantId]);
  return result.rowCount > 0;
}

router.get('/storefronts', async (req, res) => {
  const { organizationId } = req.query;
  try {
    const result = await pool.query(`
      SELECT sf.slug, sf.display_name, sf.description, sf.delivery_enabled, sf.takeaway_enabled,
             sf.min_order_amount, sf.delivery_fee, sf.service_area, sf.opening_time, sf.closing_time,
             t.name AS restaurant_name, t.restaurant_code,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '10 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS pos_status
      FROM online_storefronts sf
      JOIN tenants t ON t.id = sf.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE sf.active = true
        AND l.status = 'ACTIVE'
        AND l.expires_at >= NOW()
        AND ($1::uuid IS NULL OR sf.organization_id = $1)
      ORDER BY sf.display_name
    `, [organizationId || null]);
    res.json({ success: true, storefronts: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/storefront/:slug/menu', async (req, res) => {
  try {
    const storefront = await pool.query(`
      SELECT sf.*, t.name AS restaurant_name, t.restaurant_code
      FROM online_storefronts sf
      JOIN tenants t ON t.id = sf.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      WHERE sf.slug = $1 AND sf.active = true AND l.status = 'ACTIVE' AND l.expires_at >= NOW()
    `, [req.params.slug]);
    if (storefront.rowCount === 0) return res.status(404).json({ success: false, message: 'Storefront not found' });
    if (!await onlineOrderingEnabled(storefront.rows[0].tenant_id)) {
      return res.status(403).json({ success: false, message: 'Online ordering is not enabled for this restaurant' });
    }
    const menu = await pool.query(`
      SELECT payload, synced_at
      FROM online_menu_snapshots
      WHERE tenant_id = $1
      ORDER BY synced_at DESC
      LIMIT 1
    `, [storefront.rows[0].tenant_id]);
    res.json({
      success: true,
      storefront: storefront.rows[0],
      menu: menu.rows[0]?.payload || { categories: [], items: [] },
      menuSyncedAt: menu.rows[0]?.synced_at || null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/storefront/:slug/orders', async (req, res) => {
  const { orderType, tableId, customerName, customerPhone, customerEmail, deliveryAddress, paymentMode, notes, items } = req.body || {};
  const selectedType = cleanText(orderType, 20).toUpperCase();
  if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(selectedType) || (selectedType === 'DINE_IN' && !cleanText(tableId, 30)) || !cleanText(customerName, 120) || !cleanText(customerPhone, 20) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Order type, customer and items are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const storefront = await client.query(`
      SELECT sf.*, t.name AS restaurant_name
      FROM online_storefronts sf
      JOIN tenants t ON t.id = sf.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      WHERE sf.slug = $1 AND sf.active = true AND l.status = 'ACTIVE' AND l.expires_at >= NOW()
      FOR UPDATE
    `, [req.params.slug]);
    if (storefront.rowCount === 0) throw new Error('Storefront not found');
    if (!await onlineOrderingEnabled(storefront.rows[0].tenant_id)) throw new Error('Online ordering is not enabled');
    if (selectedType === 'DELIVERY' && !storefront.rows[0].delivery_enabled) throw new Error('Delivery is not enabled');
    if (selectedType === 'TAKEAWAY' && !storefront.rows[0].takeaway_enabled) throw new Error('Takeaway is not enabled');

    const safeItems = items.map((item) => {
      const quantity = money(item.quantity || item.qty || 1);
      const unitPrice = money(item.unitPrice || item.price);
      return {
        itemId: cleanText(item.itemId || item.id, 100),
        itemName: cleanText(item.itemName || item.name, 200),
        quantity,
        unitPrice,
        notes: cleanText(item.notes, 300),
        lineTotal: quantity * unitPrice
      };
    }).filter((item) => item.itemName && item.quantity > 0);
    if (safeItems.length === 0) throw new Error('At least one valid item is required');
    const subtotal = safeItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const deliveryFee = selectedType === 'DELIVERY' ? money(storefront.rows[0].delivery_fee) : 0;
    const total = subtotal + deliveryFee;
    if (total < money(storefront.rows[0].min_order_amount)) throw new Error(`Minimum order amount is ${storefront.rows[0].min_order_amount}`);
    const orderNo = `WEB-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    const order = await client.query(`
      INSERT INTO online_orders (
        tenant_id, organization_id, storefront_id, order_no, order_type,
        customer_name, customer_phone, customer_email, delivery_address,
        payment_mode, subtotal, delivery_fee, total_amount, notes, table_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      storefront.rows[0].tenant_id,
      storefront.rows[0].organization_id,
      storefront.rows[0].id,
      orderNo,
      selectedType,
      cleanText(customerName, 120),
      cleanText(customerPhone, 20),
      cleanText(customerEmail, 160) || null,
      cleanText(deliveryAddress, 500) || null,
      cleanText(paymentMode, 30).toUpperCase() || 'COD',
      subtotal,
      deliveryFee,
      total,
      cleanText(notes, 500) || null,
      cleanText(tableId, 30) || null
    ]);

    for (const item of safeItems) {
      await client.query(`
        INSERT INTO online_order_items (online_order_id, item_id, item_name, quantity, unit_price, line_total, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [order.rows[0].id, item.itemId || null, item.itemName, item.quantity, item.unitPrice, item.lineTotal, item.notes || null]);
    }
    await client.query('COMMIT');
    res.json({ success: true, order: order.rows[0], items: safeItems });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.post('/pos/menu-sync', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, menu, storefront } = req.body || {};
  if (!restaurantId || (!licenseKey && !syncToken) || !menu) {
    return res.status(400).json({ success: false, message: 'restaurantId, sync credentials and menu required' });
  }
  try {
    const tenant = await tenantFromSyncCredentials(restaurantId, licenseKey, syncToken);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid or expired credentials' });
    if (!await onlineOrderingEnabled(tenant.id)) return res.status(403).json({ success: false, message: 'Online ordering is not enabled' });
    await pool.query('INSERT INTO online_menu_snapshots (tenant_id, payload) VALUES ($1, $2::jsonb)', [tenant.id, JSON.stringify(menu)]);
    const slug = cleanText(storefront?.slug || restaurantId.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 120);
    await pool.query(`
      INSERT INTO online_storefronts (
        organization_id, tenant_id, slug, display_name, description, active,
        delivery_enabled, takeaway_enabled, min_order_amount, delivery_fee, service_area
      )
      VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10)
      ON CONFLICT(slug) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        active = true,
        delivery_enabled = EXCLUDED.delivery_enabled,
        takeaway_enabled = EXCLUDED.takeaway_enabled,
        min_order_amount = EXCLUDED.min_order_amount,
        delivery_fee = EXCLUDED.delivery_fee,
        service_area = EXCLUDED.service_area,
        updated_at = NOW()
    `, [
      tenant.organization_id || null,
      tenant.id,
      slug,
      cleanText(storefront?.displayName || tenant.name, 160),
      cleanText(storefront?.description, 500) || null,
      storefront?.deliveryEnabled !== false,
      storefront?.takeawayEnabled !== false,
      money(storefront?.minOrderAmount),
      money(storefront?.deliveryFee),
      cleanText(storefront?.serviceArea, 300) || null
    ]);
    res.json({ success: true, slug });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/pos/orders/pull', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, limit } = req.body || {};
  try {
    const tenant = await tenantFromSyncCredentials(restaurantId, licenseKey, syncToken);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid or expired credentials' });
    const result = await pool.query(`
      SELECT o.*, COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'itemId', oi.item_id,
            'itemName', oi.item_name,
            'quantity', oi.quantity,
            'unitPrice', oi.unit_price,
            'lineTotal', oi.line_total,
            'notes', oi.notes
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
      FROM online_orders o
      LEFT JOIN online_order_items oi ON oi.online_order_id = o.id
      WHERE o.tenant_id = $1 AND o.order_status IN ('PLACED', 'ACCEPTED')
      GROUP BY o.id
      ORDER BY o.created_at ASC
      LIMIT $2
    `, [tenant.id, Math.min(Number(limit || 20), 100)]);
    await pool.query("UPDATE online_orders SET pos_pulled_at = COALESCE(pos_pulled_at, NOW()) WHERE id = ANY($1::uuid[])", [result.rows.map((row) => row.id)]);
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/pos/orders/status', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, orderId, status, posOrderId } = req.body || {};
  const selectedStatus = cleanText(status, 30).toUpperCase();
  if (!orderId || !['ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'].includes(selectedStatus)) {
    return res.status(400).json({ success: false, message: 'Valid order and status required' });
  }
  try {
    const tenant = await tenantFromSyncCredentials(restaurantId, licenseKey, syncToken);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid or expired credentials' });
    const result = await pool.query(`
      UPDATE online_orders
      SET order_status = $1, pos_order_id = COALESCE($2, pos_order_id), updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
      RETURNING *
    `, [selectedStatus, cleanText(posOrderId, 80) || null, orderId, tenant.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
