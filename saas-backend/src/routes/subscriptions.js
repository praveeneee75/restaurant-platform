const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
router.use(authenticate);

router.get('/plans', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
             COALESCE(
               JSON_AGG(m.code ORDER BY m.code) FILTER (WHERE m.code IS NOT NULL),
               '[]'
             ) AS included_modules
      FROM subscription_plans p
      LEFT JOIN subscription_plan_modules spm ON spm.plan_id = p.id AND spm.included = true
      LEFT JOIN modules m ON m.id = spm.module_id AND m.status = 'ACTIVE'
      WHERE p.active = true
      GROUP BY p.id
      ORDER BY
        CASE p.code
          WHEN 'TRIAL' THEN 0
          WHEN 'BASIC' THEN 1
          WHEN 'STANDARD' THEN 2
          WHEN 'PREMIUM' THEN 3
          WHEN 'ENTERPRISE' THEN 4
          ELSE 10
        END,
        p.duration_days
    `);
    res.json({ success: true, plans: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/plan-modules', async (_req, res) => {
  try {
    const [plans, modules, mappings] = await Promise.all([
      pool.query(`
        SELECT id, code, name, duration_days, price, active
        FROM subscription_plans
        WHERE active = true
        ORDER BY
          CASE code
            WHEN 'TRIAL' THEN 0
            WHEN 'BASIC' THEN 1
            WHEN 'STANDARD' THEN 2
            WHEN 'PREMIUM' THEN 3
            WHEN 'ENTERPRISE' THEN 4
            ELSE 10
          END,
          duration_days
      `),
      pool.query(`
        SELECT id, code, name, description, category, status
        FROM modules
        WHERE status = 'ACTIVE'
        ORDER BY category, name
      `),
      pool.query(`
        SELECT p.code AS plan_code, m.code AS module_code, spm.included
        FROM subscription_plan_modules spm
        JOIN subscription_plans p ON p.id = spm.plan_id
        JOIN modules m ON m.id = spm.module_id
        WHERE p.active = true AND m.status = 'ACTIVE'
      `)
    ]);
    const includedByPlan = mappings.rows.reduce((acc, row) => {
      if (!acc[row.plan_code]) acc[row.plan_code] = [];
      if (row.included) acc[row.plan_code].push(row.module_code);
      return acc;
    }, {});
    res.json({ success: true, plans: plans.rows, modules: modules.rows, includedByPlan });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/plan-modules', async (req, res) => {
  const { planCode, moduleCodes, applyToExisting } = req.body || {};
  if (!planCode || !Array.isArray(moduleCodes)) {
    return res.status(400).json({ success: false, message: 'planCode and moduleCodes are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await client.query('SELECT * FROM subscription_plans WHERE code = $1 AND active = true', [planCode]);
    if (plan.rowCount === 0) throw new Error('Plan not found');
    const modules = await client.query('SELECT id, code FROM modules WHERE status = $1', ['ACTIVE']);
    const selected = new Set(moduleCodes.map((code) => String(code).toUpperCase()));
    const validCodes = new Set(modules.rows.map((module) => module.code));
    for (const code of selected) {
      if (!validCodes.has(code)) throw new Error(`Unknown module ${code}`);
    }
    const oldValue = await client.query(`
      SELECT m.code
      FROM subscription_plan_modules spm
      JOIN modules m ON m.id = spm.module_id
      WHERE spm.plan_id = $1 AND spm.included = true
      ORDER BY m.code
    `, [plan.rows[0].id]);
    for (const module of modules.rows) {
      await client.query(`
        INSERT INTO subscription_plan_modules (plan_id, module_id, included)
        VALUES ($1, $2, $3)
        ON CONFLICT(plan_id, module_id) DO UPDATE SET included = EXCLUDED.included
      `, [plan.rows[0].id, module.id, selected.has(module.code)]);
    }
    let affectedRestaurants = 0;
    if (applyToExisting === true) {
      const tenants = await client.query(`
        SELECT t.id
        FROM tenants t
        JOIN LATERAL (
          SELECT s.plan_id, s.status
          FROM subscriptions s
          WHERE s.tenant_id = t.id
          ORDER BY s.created_at DESC
          LIMIT 1
        ) s ON true
        WHERE s.plan_id = $1 AND s.status = 'ACTIVE'
      `, [plan.rows[0].id]);
      affectedRestaurants = tenants.rowCount;
      for (const tenant of tenants.rows) {
        await applyPlanModules(client, tenant.id, plan.rows[0].id);
      }
    }
    await client.query(`
      INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
      VALUES ($1, $2, 'UPDATE_PLAN_MODULES', 'SUBSCRIPTION_PLAN', $3, $4, $5)
    `, [
      req.user?.id || null,
      req.user?.role || null,
      plan.rows[0].id,
      JSON.stringify({ modules: oldValue.rows.map((row) => row.code) }),
      JSON.stringify({ planCode, modules: [...selected].sort(), applyToExisting: applyToExisting === true, affectedRestaurants })
    ]).catch(() => {});
    await client.query('COMMIT');
    res.json({ success: true, message: applyToExisting ? `Plan updated and applied to ${affectedRestaurants} live restaurant(s).` : 'Plan updated for future renewals/new customers.', affectedRestaurants });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

async function applyPlanModules(client, tenantId, planId) {
  await client.query(`
    INSERT INTO tenant_modules (tenant_id, module_id, enabled, activated_at, deactivated_at)
    SELECT $1, module_id, true, NOW(), NULL
    FROM subscription_plan_modules
    WHERE plan_id = $2 AND included = true
    ON CONFLICT(tenant_id, module_id) DO UPDATE SET
      enabled = true,
      activated_at = NOW(),
      deactivated_at = NULL
  `, [tenantId, planId]);

  await client.query(`
    UPDATE tenant_modules
    SET enabled = false, deactivated_at = NOW()
    WHERE tenant_id = $1
      AND module_id NOT IN (
        SELECT module_id
        FROM subscription_plan_modules
        WHERE plan_id = $2 AND included = true
      )
      AND module_id IN (SELECT id FROM modules WHERE code != 'WHITE_LABEL')
  `, [tenantId, planId]);
}

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
    await applyPlanModules(client, tenant.rows[0].id, plan.rows[0].id);
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
