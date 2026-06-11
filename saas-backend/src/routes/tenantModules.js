const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
router.use(authenticate);

function isDevAdmin(role) {
  return ['DEV_ADMIN', 'DEV', 'OWNER'].includes(role);
}

async function tenantForRestaurant(restaurantId) {
  const result = await pool.query('SELECT * FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  return result.rows[0] || null;
}

async function moduleByCode(code) {
  const result = await pool.query('SELECT * FROM modules WHERE code = $1', [String(code || '').toUpperCase()]);
  return result.rows[0] || null;
}

async function partnerForTenant(tenantId) {
  const result = await pool.query('SELECT partner_id FROM partner_restaurants WHERE restaurant_id = $1 LIMIT 1', [tenantId]);
  return result.rows[0]?.partner_id || null;
}

async function ensureTenantScope(req, tenantId) {
  if (req.user?.type !== 'PARTNER') return true;
  const partnerId = await partnerForTenant(tenantId);
  if (!partnerId || String(partnerId) !== String(req.user.partnerId)) {
    const err = new Error('Restaurant is outside partner scope');
    err.status = 403;
    throw err;
  }
  return true;
}

async function partnerCanEnableModule(partnerId, moduleId) {
  if (!partnerId) return true;
  const result = await pool.query(`
    SELECT allowed FROM partner_allowed_modules
    WHERE partner_id = $1 AND module_id = $2
  `, [partnerId, moduleId]);
  return result.rowCount === 0 || result.rows[0].allowed === true;
}

async function logSaasAudit(req, action, entityType, entityId, oldValue, newValue) {
  await pool.query(
    `INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.user?.id || null, req.user?.role || null, action, entityType, entityId || null, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(() => {});
}

router.get('/modules', async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    await ensureTenantScope(req, tenant.id);
    const result = await pool.query(`
      SELECT m.code, m.name, m.category, m.status,
             COALESCE(tm.enabled, false) AS enabled,
             tm.trial_ends_at,
             tm.activated_at,
             tm.deactivated_at,
             COALESCE(mp.price, 0) AS monthly_price,
             COALESCE(mp.currency, 'INR') AS currency
      FROM modules m
      LEFT JOIN tenant_modules tm ON tm.module_id = m.id AND tm.tenant_id = $1
      LEFT JOIN module_pricing mp ON mp.module_id = m.id AND mp.billing_cycle = 'MONTHLY'
      ORDER BY m.category, m.name
    `, [tenant.id]);
    const enabledModules = result.rows.filter((row) => row.enabled && row.status === 'ACTIVE').map((row) => row.code);
    const monthlyModuleCharges = result.rows.reduce((sum, row) => sum + (row.enabled && row.status === 'ACTIVE' ? Number(row.monthly_price || 0) : 0), 0);
    res.json({ success: true, restaurantId, modules: result.rows, enabledModules, monthlyModuleCharges });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/modules/enable', async (req, res) => {
  const { restaurantId, moduleCode, trialDays } = req.body || {};
  if (!restaurantId || !moduleCode) return res.status(400).json({ success: false, message: 'restaurantId and moduleCode required' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    const module = await moduleByCode(moduleCode);
    if (!tenant || !module) return res.status(404).json({ success: false, message: 'Restaurant or module not found' });
    if (module.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Module is not active' });
    const partnerId = await partnerForTenant(tenant.id);
    if (req.user?.type === 'PARTNER' && req.user.role !== 'PARTNER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Partner admin permission required' });
    }
    await ensureTenantScope(req, tenant.id);
    if (!isDevAdmin(req.user?.role) && !await partnerCanEnableModule(partnerId, module.id)) {
      return res.status(403).json({ success: false, message: 'Partner is not allowed to enable this module' });
    }
    const oldValue = (await pool.query('SELECT * FROM tenant_modules WHERE tenant_id = $1 AND module_id = $2', [tenant.id, module.id])).rows[0] || null;
    const result = await pool.query(`
      INSERT INTO tenant_modules (tenant_id, module_id, enabled, trial_ends_at, activated_at, deactivated_at)
      VALUES ($1, $2, true, CASE WHEN $3::int > 0 THEN NOW() + ($3::int * INTERVAL '1 day') ELSE NULL END, NOW(), NULL)
      ON CONFLICT(tenant_id, module_id) DO UPDATE SET
        enabled = true,
        trial_ends_at = CASE WHEN $3::int > 0 THEN NOW() + ($3::int * INTERVAL '1 day') ELSE tenant_modules.trial_ends_at END,
        activated_at = NOW(),
        deactivated_at = NULL
      RETURNING *
    `, [tenant.id, module.id, Number(trialDays || 0)]);
    await logSaasAudit(req, 'ENABLE', 'TENANT_MODULE', result.rows[0].id, oldValue, { restaurantId, moduleCode: module.code });
    res.json({ success: true, tenantModule: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/modules/disable', async (req, res) => {
  const { restaurantId, moduleCode } = req.body || {};
  if (!restaurantId || !moduleCode) return res.status(400).json({ success: false, message: 'restaurantId and moduleCode required' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    const module = await moduleByCode(moduleCode);
    if (!tenant || !module) return res.status(404).json({ success: false, message: 'Restaurant or module not found' });
    if (req.user?.type === 'PARTNER' && req.user.role !== 'PARTNER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Partner admin permission required' });
    }
    await ensureTenantScope(req, tenant.id);
    const oldValue = (await pool.query('SELECT * FROM tenant_modules WHERE tenant_id = $1 AND module_id = $2', [tenant.id, module.id])).rows[0] || null;
    const result = await pool.query(`
      INSERT INTO tenant_modules (tenant_id, module_id, enabled, deactivated_at)
      VALUES ($1, $2, false, NOW())
      ON CONFLICT(tenant_id, module_id) DO UPDATE SET enabled = false, deactivated_at = NOW()
      RETURNING *
    `, [tenant.id, module.id]);
    await logSaasAudit(req, 'DISABLE', 'TENANT_MODULE', result.rows[0].id, oldValue, { restaurantId, moduleCode: module.code });
    res.json({ success: true, tenantModule: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

module.exports = router;
