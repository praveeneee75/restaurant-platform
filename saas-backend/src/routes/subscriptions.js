const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
router.use(authenticate);

router.get('/plans', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans WHERE active = true ORDER BY duration_days');
    res.json({ success: true, plans: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/assign', async (req, res) => {
  const { restaurantCode, planCode, startsAt, paymentAmount, paymentMode, referenceNo } = req.body || {};
  if (!restaurantCode || !planCode) return res.status(400).json({ success: false, message: 'restaurantCode and planCode required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantCode]);
    const plan = await client.query('SELECT * FROM subscription_plans WHERE code = $1 AND active = true', [planCode]);
    if (tenant.rowCount === 0 || plan.rowCount === 0) throw new Error('Restaurant or plan not found');
    const startDate = startsAt || new Date().toISOString().slice(0, 10);
    const sub = await client.query(`
      INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
      VALUES ($1, $2, 'ACTIVE', $3::date, $3::date + ($4::int * INTERVAL '1 day'))
      RETURNING *
    `, [tenant.rows[0].id, plan.rows[0].id, startDate, plan.rows[0].duration_days]);
    await client.query('UPDATE licenses SET status = $1, expires_at = $2 WHERE tenant_id = $3', ['ACTIVE', sub.rows[0].expires_at, tenant.rows[0].id]);
    if (Number(paymentAmount || 0) > 0) {
      await client.query(`
        INSERT INTO subscription_payments (subscription_id, tenant_id, amount, payment_mode, reference_no)
        VALUES ($1, $2, $3, $4, $5)
      `, [sub.rows[0].id, tenant.rows[0].id, paymentAmount, paymentMode || null, referenceNo || null]);
    }
    await client.query('COMMIT');
    res.json({ success: true, subscription: sub.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('SUBSCRIPTION ASSIGN ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.post('/suspend', async (req, res) => {
  const { restaurantCode } = req.body || {};
  if (!restaurantCode) return res.status(400).json({ success: false, message: 'restaurantCode required' });
  try {
    const result = await pool.query(`
      UPDATE subscriptions
      SET status = 'SUSPENDED', updated_at = NOW()
      WHERE id = (
        SELECT s.id
        FROM subscriptions s
        JOIN tenants t ON t.id = s.tenant_id
        WHERE t.restaurant_code = $1
        ORDER BY s.created_at DESC
        LIMIT 1
      )
    `, [restaurantCode]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found' });
    await pool.query("UPDATE licenses SET status = 'INACTIVE' WHERE tenant_id = (SELECT id FROM tenants WHERE restaurant_code = $1)", [restaurantCode]);
    res.json({ success: true, message: 'Subscription suspended' });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/reactivate', async (req, res) => {
  const { restaurantCode } = req.body || {};
  if (!restaurantCode) return res.status(400).json({ success: false, message: 'restaurantCode required' });
  try {
    const result = await pool.query(`
      UPDATE subscriptions
      SET status = 'ACTIVE', updated_at = NOW()
      WHERE id = (
        SELECT s.id
        FROM subscriptions s
        JOIN tenants t ON t.id = s.tenant_id
        WHERE t.restaurant_code = $1
        ORDER BY s.created_at DESC
        LIMIT 1
      )
    `, [restaurantCode]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Subscription not found' });
    await pool.query("UPDATE licenses SET status = 'ACTIVE' WHERE tenant_id = (SELECT id FROM tenants WHERE restaurant_code = $1)", [restaurantCode]);
    res.json({ success: true, message: 'Subscription reactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.restaurant_code, t.name, p.code AS plan_code, s.status, s.starts_at, s.expires_at,
             GREATEST((s.expires_at::date - CURRENT_DATE), 0) AS days_remaining,
             CASE WHEN s.expires_at::date <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS expiry_warning,
             COALESCE(SUM(sp.amount), 0) AS paid_amount,
             COALESCE(module_charges.monthly_module_charges, 0) AS monthly_module_charges
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN subscription_plans p ON p.id = s.plan_id
      LEFT JOIN subscription_payments sp ON sp.subscription_id = s.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(mp.price), 0) AS monthly_module_charges
        FROM tenant_modules tm
        JOIN modules m ON m.id = tm.module_id AND m.status = 'ACTIVE'
        LEFT JOIN module_pricing mp ON mp.module_id = m.id AND mp.billing_cycle = 'MONTHLY'
        WHERE tm.tenant_id = t.id AND tm.enabled = true
      ) module_charges ON true
      GROUP BY t.restaurant_code, t.name, t.created_at, p.code, s.status, s.starts_at, s.expires_at, module_charges.monthly_module_charges
      ORDER BY t.created_at DESC
    `);
    res.json({ success: true, subscriptions: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
