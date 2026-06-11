const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
router.use(authenticate);

function isDev(role) {
  return ['DEV_ADMIN', 'DEV', 'OWNER'].includes(role);
}

function requireDev(req, res, next) {
  if (!isDev(req.user?.role)) return res.status(403).json({ success: false, message: 'DEV_ADMIN required' });
  next();
}

async function audit(req, action, entityType, entityId, oldValue, newValue) {
  await pool.query(
    `INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.user?.id || null, req.user?.role || null, action, entityType, entityId || null, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(() => {});
}

router.post('/create', requireDev, async (req, res) => {
  const { name, legalName, email, phone } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'Organization name required' });
  try {
    const result = await pool.query(`
      INSERT INTO organizations (name, legal_name, email, phone)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, legalName || null, email || null, phone || null]);
    await audit(req, 'CREATE', 'ORGANIZATION', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, organization: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/list', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*,
             COUNT(DISTINCT org_rest.tenant_id) AS restaurant_count,
             COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_licenses
      FROM organizations o
      LEFT JOIN organization_restaurants org_rest ON org_rest.organization_id = o.id AND org_rest.active = true
      LEFT JOIN licenses l ON l.tenant_id = org_rest.tenant_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json({ success: true, organizations: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/users/create', requireDev, async (req, res) => {
  const { organizationId, name, email, password, role } = req.body || {};
  const selectedRole = role || 'ORG_OWNER';
  if (!organizationId || !name || !email || !password || String(password).length < 6) {
    return res.status(400).json({ success: false, message: 'Organization, name, email and 6+ character password required' });
  }
  if (!['ORG_OWNER', 'AREA_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(selectedRole)) {
    return res.status(400).json({ success: false, message: 'Invalid organization role' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(`
      INSERT INTO organization_users (organization_id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, organization_id, name, email, role, active, created_at
    `, [organizationId, name, email, hash, selectedRole]);
    await audit(req, 'CREATE', 'ORGANIZATION_USER', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/users', async (req, res) => {
  const { organizationId } = req.query;
  if (!organizationId) return res.status(400).json({ success: false, message: 'organizationId required' });
  try {
    const result = await pool.query('SELECT id, name, email, role, active, created_at FROM organization_users WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/branch-groups/save', requireDev, async (req, res) => {
  const { organizationId, id, name, description, active } = req.body || {};
  if (!organizationId || !name) return res.status(400).json({ success: false, message: 'Organization and group name required' });
  try {
    const oldValue = id ? (await pool.query('SELECT * FROM branch_groups WHERE id = $1', [id])).rows[0] : null;
    const result = id
      ? await pool.query('UPDATE branch_groups SET name = $1, description = $2, active = $3 WHERE id = $4 RETURNING *', [name, description || null, active !== false, id])
      : await pool.query('INSERT INTO branch_groups (organization_id, name, description) VALUES ($1, $2, $3) RETURNING *', [organizationId, name, description || null]);
    await audit(req, id ? 'UPDATE' : 'CREATE', 'BRANCH_GROUP', result.rows[0].id, oldValue, result.rows[0]);
    res.json({ success: true, group: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/branch-groups', async (req, res) => {
  const { organizationId } = req.query;
  if (!organizationId) return res.status(400).json({ success: false, message: 'organizationId required' });
  try {
    const result = await pool.query('SELECT * FROM branch_groups WHERE organization_id = $1 ORDER BY name', [organizationId]);
    res.json({ success: true, groups: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/restaurants/assign', requireDev, async (req, res) => {
  const { organizationId, restaurantCode, branchGroupId, branchName } = req.body || {};
  if (!organizationId || !restaurantCode) return res.status(400).json({ success: false, message: 'organizationId and restaurantCode required' });
  try {
    const tenant = await pool.query('SELECT id, name FROM tenants WHERE restaurant_code = $1', [restaurantCode]);
    if (tenant.rowCount === 0) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    const result = await pool.query(`
      INSERT INTO organization_restaurants (organization_id, tenant_id, branch_group_id, branch_name, active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT(organization_id, tenant_id) DO UPDATE SET
        branch_group_id = EXCLUDED.branch_group_id,
        branch_name = EXCLUDED.branch_name,
        active = true
      RETURNING *
    `, [organizationId, tenant.rows[0].id, branchGroupId || null, branchName || tenant.rows[0].name]);
    await audit(req, 'ASSIGN', 'ORGANIZATION_RESTAURANT', result.rows[0].id, null, { organizationId, restaurantCode, branchGroupId, branchName });
    res.json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/restaurants', async (req, res) => {
  const { organizationId } = req.query;
  if (!organizationId) return res.status(400).json({ success: false, message: 'organizationId required' });
  try {
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, org_rest.branch_name, bg.name AS branch_group,
             l.status AS license_status, hb.last_heartbeat_at,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS online_status
      FROM organization_restaurants org_rest
      JOIN tenants t ON t.id = org_rest.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN branch_groups bg ON bg.id = org_rest.branch_group_id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE org_rest.organization_id = $1 AND org_rest.active = true
      ORDER BY COALESCE(bg.name, ''), t.name
    `, [organizationId]);
    res.json({ success: true, restaurants: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/reports/consolidated', async (req, res) => {
  const { organizationId, fromDate, toDate } = req.query;
  if (!organizationId || !fromDate || !toDate) return res.status(400).json({ success: false, message: 'organizationId, fromDate and toDate required' });
  try {
    const summary = await pool.query(`
      SELECT COALESCE(SUM(r.net_sales), 0) AS net_sales,
             COALESCE(SUM(r.gross_sales), 0) AS gross_sales,
             COALESCE(SUM(r.tax_amount), 0) AS tax_amount,
             COALESCE(SUM(r.discount_amount), 0) AS discounts,
             COALESCE(SUM(r.refunds_amount), 0) AS refunds,
             COALESCE(SUM(r.orders_count), 0) AS orders_count
      FROM organization_restaurants org_rest
      JOIN tenant_daily_reports r ON r.tenant_id = org_rest.tenant_id
      WHERE org_rest.organization_id = $1
        AND r.report_date BETWEEN $2::date AND $3::date
    `, [organizationId, fromDate, toDate]);
    const branchComparison = await pool.query(`
      SELECT t.name, t.restaurant_code, COALESCE(SUM(r.net_sales), 0) AS net_sales, COALESCE(SUM(r.orders_count), 0) AS orders_count
      FROM organization_restaurants org_rest
      JOIN tenants t ON t.id = org_rest.tenant_id
      LEFT JOIN tenant_daily_reports r ON r.tenant_id = t.id AND r.report_date BETWEEN $2::date AND $3::date
      WHERE org_rest.organization_id = $1
      GROUP BY t.id
      ORDER BY net_sales DESC
    `, [organizationId, fromDate, toDate]);
    const topItems = await pool.query(`
      SELECT item_name, COALESCE(SUM(quantity_sold), 0) AS quantity_sold, COALESCE(SUM(total_sales), 0) AS total_sales
      FROM organization_restaurants org_rest
      JOIN tenant_item_sales i ON i.tenant_id = org_rest.tenant_id
      WHERE org_rest.organization_id = $1
        AND i.report_date BETWEEN $2::date AND $3::date
      GROUP BY item_name
      ORDER BY total_sales DESC
      LIMIT 25
    `, [organizationId, fromDate, toDate]);
    res.json({ success: true, summary: summary.rows[0], branchComparison: branchComparison.rows, topItems: topItems.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/central-menu', async (req, res) => {
  const { organizationId } = req.query;
  if (!organizationId) return res.status(400).json({ success: false, message: 'organizationId required' });
  res.json({
    success: true,
    message: 'Central menu publishing is prepared at SaaS level; branch-local POS databases remain source of truth until a future sync publisher is added.',
    organizationId
  });
});

module.exports = router;
