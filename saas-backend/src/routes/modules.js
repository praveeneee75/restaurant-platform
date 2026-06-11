const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();

function isDevAdmin(role) {
  return ['DEV_ADMIN', 'DEV', 'OWNER'].includes(role);
}

function requireDev(req, res, next) {
  if (!isDevAdmin(req.user?.role)) return res.status(403).json({ success: false, message: 'DEV_ADMIN required' });
  next();
}

async function logSaasAudit(req, action, entityType, entityId, oldValue, newValue) {
  await pool.query(
    `INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      req.user?.id || null,
      req.user?.role || null,
      action,
      entityType,
      entityId || null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    ]
  ).catch(() => {});
}

async function tenantIdForRestaurant(restaurantId) {
  const result = await pool.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  return result.rows[0]?.id || null;
}

router.post('/usage', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, moduleCode, usageType, usageCount } = req.body || {};
  if (!restaurantId || !moduleCode || !usageType || (!licenseKey && !syncToken)) {
    return res.status(400).json({ success: false, message: 'restaurantId, moduleCode, usageType and sync credentials required' });
  }
  try {
    const tenant = await pool.query(`
      SELECT t.id
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      WHERE t.restaurant_code = $1
        AND (($2::text IS NOT NULL AND l.license_key = $2) OR ($3::text IS NOT NULL AND l.sync_token = $3))
      LIMIT 1
    `, [restaurantId, licenseKey || null, syncToken || null]);
    if (tenant.rowCount === 0) return res.status(401).json({ success: false, message: 'Invalid usage credentials' });
    await pool.query(`
      INSERT INTO module_usage_logs (tenant_id, module_code, usage_type, usage_count)
      VALUES ($1, $2, $3, $4)
    `, [tenant.rows[0].id, String(moduleCode).toUpperCase(), usageType, Number(usageCount || 1)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.use(authenticate);

router.get('/list', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*,
             COALESCE(json_agg(json_build_object('billing_cycle', mp.billing_cycle, 'price', mp.price, 'currency', mp.currency) ORDER BY mp.billing_cycle) FILTER (WHERE mp.id IS NOT NULL), '[]') AS pricing
      FROM modules m
      LEFT JOIN module_pricing mp ON mp.module_id = m.id
      GROUP BY m.id
      ORDER BY m.category, m.name
    `);
    res.json({ success: true, modules: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/create', requireDev, async (req, res) => {
  const { code, name, description, category, status, pricing } = req.body || {};
  if (!code || !name) return res.status(400).json({ success: false, message: 'Module code and name required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO modules (code, name, description, category, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = EXCLUDED.status
      RETURNING *
    `, [String(code).trim().toUpperCase(), name, description || null, category || null, status || 'ACTIVE']);
    for (const row of pricing || []) {
      await client.query(`
        INSERT INTO module_pricing (module_id, billing_cycle, price, currency)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(module_id, billing_cycle, currency) DO UPDATE SET price = EXCLUDED.price
      `, [result.rows[0].id, row.billingCycle || 'MONTHLY', Number(row.price || 0), row.currency || 'INR']);
    }
    await client.query('COMMIT');
    await logSaasAudit(req, 'UPSERT', 'MODULE', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, module: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.post('/update', requireDev, async (req, res) => {
  const { id, code, name, description, category, status, pricing } = req.body || {};
  if (!id && !code) return res.status(400).json({ success: false, message: 'Module id or code required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const oldValue = (await client.query('SELECT * FROM modules WHERE id = COALESCE($1::uuid, id) AND ($2::text IS NULL OR code = $2)', [id || null, code || null])).rows[0];
    if (!oldValue) return res.status(404).json({ success: false, message: 'Module not found' });
    const result = await client.query(`
      UPDATE modules
      SET name = COALESCE($2, name),
          description = COALESCE($3, description),
          category = COALESCE($4, category),
          status = COALESCE($5, status)
      WHERE id = $1
      RETURNING *
    `, [oldValue.id, name || null, description || null, category || null, status || null]);
    for (const row of pricing || []) {
      await client.query(`
        INSERT INTO module_pricing (module_id, billing_cycle, price, currency)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(module_id, billing_cycle, currency) DO UPDATE SET price = EXCLUDED.price
      `, [oldValue.id, row.billingCycle || 'MONTHLY', Number(row.price || 0), row.currency || 'INR']);
    }
    await client.query('COMMIT');
    await logSaasAudit(req, 'UPDATE', 'MODULE', oldValue.id, oldValue, result.rows[0]);
    res.json({ success: true, module: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.get('/pricing', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.code, m.name, mp.billing_cycle, mp.price, mp.currency
      FROM modules m
      JOIN module_pricing mp ON mp.module_id = m.id
      WHERE m.status = 'ACTIVE'
      ORDER BY m.name, mp.billing_cycle
    `);
    res.json({ success: true, pricing: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
