const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { config, publicError } = require('../config');

const router = express.Router();

function isDevAdmin(role) {
  return ['DEV_ADMIN', 'DEV', 'OWNER'].includes(role);
}

function partnerToken(user) {
  return jwt.sign(
    { id: user.id, partnerId: user.partner_id, role: user.role, type: 'PARTNER' },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
}

function audit(actor, action, entityType, entityId, oldValue, newValue) {
  return pool.query(
    `INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor?.id || null,
      actor?.role || null,
      action,
      entityType,
      entityId || null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    ]
  ).catch(() => {});
}

function authenticateEither(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ success: false, message: 'Invalid token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], config.jwtSecret);
    req.auth = decoded.type === 'PARTNER'
      ? { id: decoded.id, role: decoded.role, partnerId: decoded.partnerId, type: 'PARTNER' }
      : { id: decoded.id, role: decoded.role, type: 'DEV' };
    next();
  } catch (_) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function requireDev(req, res, next) {
  authenticate(req, res, () => {
    if (!isDevAdmin(req.user?.role)) return res.status(403).json({ success: false, message: 'DEV_ADMIN required' });
    req.auth = { id: req.user.id, role: req.user.role, type: 'DEV' };
    next();
  });
}

function requirePartnerAdmin(req, res, next) {
  if (req.auth?.type === 'DEV' && isDevAdmin(req.auth.role)) return next();
  if (req.auth?.type === 'PARTNER' && req.auth.role === 'PARTNER_ADMIN') return next();
  return res.status(403).json({ success: false, message: 'Partner admin permission required' });
}

function requirePartnerView(req, res, next) {
  if (req.auth?.type === 'DEV' && isDevAdmin(req.auth.role)) return next();
  if (req.auth?.type === 'PARTNER' && ['PARTNER_ADMIN', 'PARTNER_SUPPORT'].includes(req.auth.role)) return next();
  return res.status(403).json({ success: false, message: 'Partner access required' });
}

function scopedPartnerId(req) {
  return req.auth?.type === 'PARTNER' ? req.auth.partnerId : req.query.partnerId || req.body?.partnerId;
}

async function ensurePartnerScope(req, partnerId) {
  if (!partnerId) throw new Error('partnerId required');
  if (req.auth?.type === 'PARTNER' && String(req.auth.partnerId) !== String(partnerId)) {
    const err = new Error('Restaurant is outside partner scope');
    err.status = 403;
    throw err;
  }
}

async function tenantForPartner(restaurantCode, partnerId) {
  const result = await pool.query(`
    SELECT t.*
    FROM tenants t
    JOIN partner_restaurants pr ON pr.restaurant_id = t.id
    WHERE t.restaurant_code = $1 AND pr.partner_id = $2
  `, [restaurantCode, partnerId]);
  return result.rows[0] || null;
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  try {
    const result = await pool.query(`
      SELECT pu.*, p.status AS partner_status, p.name AS partner_name
      FROM partner_users pu
      JOIN partners p ON p.id = pu.partner_id
      WHERE pu.email = $1 AND pu.active = true
    `, [email]);
    if (result.rowCount === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const user = result.rows[0];
    if (user.partner_status !== 'ACTIVE') return res.status(403).json({ success: false, message: 'Partner account suspended' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    res.json({
      success: true,
      token: partnerToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, partnerId: user.partner_id, partnerName: user.partner_name }
    });
  } catch (err) {
    console.error('PARTNER LOGIN ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/create', requireDev, async (req, res) => {
  const { name, businessName, email, phone, commissionPercent } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'Partner name required' });
  try {
    const result = await pool.query(`
      INSERT INTO partners (name, business_name, email, phone, commission_percent)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, businessName || null, email || null, phone || null, Number(commissionPercent || 0)]);
    await audit(req.auth, 'CREATE', 'PARTNER', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, partner: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/list', authenticateEither, requirePartnerView, async (req, res) => {
  try {
    const params = [];
    const where = req.auth.type === 'PARTNER' ? 'WHERE p.id = $1' : '';
    if (req.auth.type === 'PARTNER') params.push(req.auth.partnerId);
    const result = await pool.query(`
      SELECT p.*,
             COUNT(DISTINCT pr.restaurant_id) AS restaurant_count,
             COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_licenses
      FROM partners p
      LEFT JOIN partner_restaurants pr ON pr.partner_id = p.id
      LEFT JOIN licenses l ON l.tenant_id = pr.restaurant_id
      ${where}
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, params);
    res.json({ success: true, partners: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/update', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, name, businessName, email, phone, status, commissionPercent } = req.body || {};
  try {
    await ensurePartnerScope(req, partnerId);
    if (req.auth.type === 'PARTNER' && status) return res.status(403).json({ success: false, message: 'Only DEV_ADMIN can change partner status' });
    const oldValue = (await pool.query('SELECT * FROM partners WHERE id = $1', [partnerId])).rows[0];
    if (!oldValue) return res.status(404).json({ success: false, message: 'Partner not found' });
    const nextStatus = req.auth.type === 'DEV' ? (status || oldValue.status) : oldValue.status;
    const result = await pool.query(`
      UPDATE partners
      SET name = COALESCE($2, name),
          business_name = COALESCE($3, business_name),
          email = COALESCE($4, email),
          phone = COALESCE($5, phone),
          status = $6,
          commission_percent = COALESCE($7, commission_percent)
      WHERE id = $1
      RETURNING *
    `, [partnerId, name || null, businessName || null, email || null, phone || null, nextStatus, commissionPercent === undefined ? null : Number(commissionPercent)]);
    await audit(req.auth, 'UPDATE', 'PARTNER', partnerId, oldValue, result.rows[0]);
    res.json({ success: true, partner: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/users/create', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, name, email, password, role } = req.body || {};
  const selectedRole = role || 'PARTNER_ADMIN';
  if (!name || !email || !password || String(password).length < 6) return res.status(400).json({ success: false, message: 'Name, email and 6+ character password required' });
  if (!['PARTNER_ADMIN', 'PARTNER_SUPPORT'].includes(selectedRole)) return res.status(400).json({ success: false, message: 'Invalid partner role' });
  try {
    await ensurePartnerScope(req, partnerId);
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(`
      INSERT INTO partner_users (partner_id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, partner_id, name, email, role, active, created_at
    `, [partnerId, name, email, hash, selectedRole]);
    await audit(req.auth, 'CREATE', 'PARTNER_USER', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.get('/users', authenticateEither, requirePartnerView, async (req, res) => {
  const partnerId = scopedPartnerId(req);
  try {
    await ensurePartnerScope(req, partnerId);
    const result = await pool.query('SELECT id, partner_id, name, email, role, active, created_at FROM partner_users WHERE partner_id = $1 ORDER BY created_at DESC', [partnerId]);
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/branding', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, brandName, logoUrl, primaryColor, secondaryColor, supportEmail, supportPhone, customDomain } = req.body || {};
  try {
    await ensurePartnerScope(req, partnerId);
    const oldValue = (await pool.query('SELECT * FROM partner_branding WHERE partner_id = $1', [partnerId])).rows[0] || null;
    const result = await pool.query(`
      INSERT INTO partner_branding (partner_id, brand_name, logo_url, primary_color, secondary_color, support_email, support_phone, custom_domain, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT(partner_id) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        logo_url = EXCLUDED.logo_url,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        support_email = EXCLUDED.support_email,
        support_phone = EXCLUDED.support_phone,
        custom_domain = EXCLUDED.custom_domain,
        updated_at = NOW()
      RETURNING *
    `, [partnerId, brandName || null, logoUrl || null, primaryColor || null, secondaryColor || null, supportEmail || null, supportPhone || null, customDomain || null]);
    await audit(req.auth, 'UPSERT', 'PARTNER_BRANDING', result.rows[0].id, oldValue, result.rows[0]);
    res.json({ success: true, branding: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.get('/branding', authenticateEither, requirePartnerView, async (req, res) => {
  const partnerId = scopedPartnerId(req);
  try {
    await ensurePartnerScope(req, partnerId);
    const result = await pool.query('SELECT * FROM partner_branding WHERE partner_id = $1', [partnerId]);
    res.json({ success: true, branding: result.rows[0] || null });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.get('/branding/public', async (req, res) => {
  const { domain, partnerId } = req.query;
  try {
    const result = await pool.query(`
      SELECT pb.*, p.name AS partner_name
      FROM partner_branding pb
      JOIN partners p ON p.id = pb.partner_id
      WHERE (($1::text IS NOT NULL AND pb.custom_domain = $1) OR ($2::uuid IS NOT NULL AND pb.partner_id = $2))
      LIMIT 1
    `, [domain || null, partnerId || null]);
    res.json({ success: true, branding: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/restaurants/create', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, name, country, currency, expiryDate, planCode, paymentAmount } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'Restaurant name required' });
  const client = await pool.connect();
  try {
    await ensurePartnerScope(req, partnerId);
    await client.query('BEGIN');
    const partner = await client.query('SELECT * FROM partners WHERE id = $1 AND status = $2', [partnerId, 'ACTIVE']);
    if (partner.rowCount === 0) throw new Error('Active partner not found');
    const restaurantCode = `RESTO${Math.floor(10000 + Math.random() * 90000)}`;
    const tenantId = uuidv4();
    const licenseKey = uuidv4();
    const syncToken = uuidv4();
    await client.query(
      `INSERT INTO tenants (id, restaurant_code, name, country, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, restaurantCode, name, country || null, currency || null]
    );
    await client.query(
      `INSERT INTO licenses (tenant_id, license_key, sync_token, expires_at, status)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW() + INTERVAL '1 year'), 'ACTIVE')`,
      [tenantId, licenseKey, syncToken, expiryDate || null]
    );
    await client.query('INSERT INTO partner_restaurants (partner_id, restaurant_id) VALUES ($1, $2)', [partnerId, tenantId]);

    let subscription = null;
    if (planCode) {
      const plan = await client.query('SELECT * FROM subscription_plans WHERE code = $1 AND active = true', [planCode]);
      if (plan.rowCount === 0) throw new Error('Plan not found');
      const sub = await client.query(`
        INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
        VALUES ($1, $2, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + ($3::int * INTERVAL '1 day'))
        RETURNING *
      `, [tenantId, plan.rows[0].id, plan.rows[0].duration_days]);
      subscription = sub.rows[0];
      await client.query('UPDATE licenses SET expires_at = $1 WHERE tenant_id = $2', [subscription.expires_at, tenantId]);
      const revenue = Number(paymentAmount || plan.rows[0].price || 0);
      const commissionPercent = Number(partner.rows[0].commission_percent || 0);
      const commissionAmount = revenue * commissionPercent / 100;
      await client.query(`
        INSERT INTO partner_commissions (partner_id, subscription_id, restaurant_id, revenue_amount, commission_percent, commission_amount)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [partnerId, subscription.id, tenantId, revenue, commissionPercent, commissionAmount]);
      await client.query(`
        INSERT INTO partner_subscriptions (partner_id, subscription_id, restaurant_id, revenue_amount, commission_percent, commission_amount)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [partnerId, subscription.id, tenantId, revenue, commissionPercent, commissionAmount]);
    }

    await client.query('COMMIT');
    const created = { restaurantCode, restaurantId: restaurantCode, licenseKey, syncToken, subscription };
    await audit(req.auth, 'CREATE', 'PARTNER_RESTAURANT', tenantId, null, { partnerId, ...created });
    res.json({ success: true, ...created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  } finally {
    client.release();
  }
});

router.get('/restaurants', authenticateEither, requirePartnerView, async (req, res) => {
  const partnerId = scopedPartnerId(req);
  try {
    await ensurePartnerScope(req, partnerId);
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, l.status AS license_status, l.expires_at,
             hb.pos_version, hb.backup_status, hb.printer_status, hb.last_heartbeat_at,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS online_status,
             latest_sync.created_at AS last_sync_at,
             latest_sync.status AS sync_status
      FROM partner_restaurants pr
      JOIN tenants t ON t.id = pr.restaurant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      LEFT JOIN LATERAL (
        SELECT created_at, status FROM tenant_sync_logs WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
      ) latest_sync ON true
      WHERE pr.partner_id = $1
      ORDER BY t.created_at DESC
    `, [partnerId]);
    res.json({ success: true, restaurants: result.rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.get('/dashboard', authenticateEither, requirePartnerView, async (req, res) => {
  const partnerId = scopedPartnerId(req);
  try {
    await ensurePartnerScope(req, partnerId);
    const summary = await pool.query(`
      SELECT COUNT(DISTINCT t.id) AS total_restaurants,
             COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_licenses,
             COALESCE(SUM(CASE WHEN l.status != 'ACTIVE' OR l.expires_at < NOW() THEN 1 ELSE 0 END), 0) AS expired_licenses,
             COALESCE(SUM(CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 1 ELSE 0 END), 0) AS online_restaurants,
             COALESCE(SUM(CASE WHEN hb.last_heartbeat_at IS NULL OR hb.last_heartbeat_at <= NOW() - INTERVAL '2 minutes' THEN 1 ELSE 0 END), 0) AS offline_restaurants,
             MAX(hb.last_heartbeat_at) AS last_heartbeat_at,
             MAX(ts.created_at) AS last_sync_at,
             COALESCE(SUM(ps.revenue_amount), 0) AS monthly_recurring_revenue
      FROM partner_restaurants pr
      JOIN tenants t ON t.id = pr.restaurant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      LEFT JOIN tenant_sync_logs ts ON ts.tenant_id = t.id
      LEFT JOIN partner_subscriptions ps ON ps.restaurant_id = t.id AND ps.created_at >= DATE_TRUNC('month', NOW())
      WHERE pr.partner_id = $1
    `, [partnerId]);
    const alerts = await pool.query(`
      SELECT t.name, t.restaurant_code, l.status AS license_status, hb.printer_status, hb.backup_status,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS online_status
      FROM partner_restaurants pr
      JOIN tenants t ON t.id = pr.restaurant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE pr.partner_id = $1
        AND (l.status != 'ACTIVE' OR l.expires_at < NOW() OR hb.last_heartbeat_at IS NULL OR hb.last_heartbeat_at <= NOW() - INTERVAL '2 minutes' OR hb.printer_status ILIKE '%ERROR%' OR hb.backup_status ILIKE '%FAILED%')
      ORDER BY t.name
      LIMIT 25
    `, [partnerId]);
    res.json({ success: true, summary: summary.rows[0], supportAlerts: alerts.rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.get('/commissions', authenticateEither, requirePartnerView, async (req, res) => {
  const partnerId = scopedPartnerId(req);
  try {
    await ensurePartnerScope(req, partnerId);
    const result = await pool.query(`
      SELECT pc.*, t.name AS restaurant_name, t.restaurant_code
      FROM partner_commissions pc
      LEFT JOIN tenants t ON t.id = pc.restaurant_id
      WHERE pc.partner_id = $1
      ORDER BY pc.created_at DESC
    `, [partnerId]);
    const totals = result.rows.reduce((sum, row) => {
      sum.revenue += Number(row.revenue_amount || 0);
      sum.commission += Number(row.commission_amount || 0);
      if (row.payout_status === 'PAID') sum.paid += Number(row.commission_amount || 0);
      if (row.payout_status !== 'PAID') sum.pending += Number(row.commission_amount || 0);
      return sum;
    }, { revenue: 0, commission: 0, paid: 0, pending: 0 });
    res.json({ success: true, commissions: result.rows, totals });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/payouts/mark-paid', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, commissionIds, referenceNo } = req.body || {};
  if (!Array.isArray(commissionIds) || commissionIds.length === 0) return res.status(400).json({ success: false, message: 'commissionIds required' });
  const client = await pool.connect();
  try {
    await ensurePartnerScope(req, partnerId);
    await client.query('BEGIN');
    const rows = await client.query(`
      SELECT * FROM partner_commissions
      WHERE partner_id = $1 AND payout_status != 'PAID' AND id = ANY($2::uuid[])
    `, [partnerId, commissionIds]);
    const amount = rows.rows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0);
    const payout = await client.query(`
      INSERT INTO partner_payouts (partner_id, amount, status, reference_no, paid_at)
      VALUES ($1, $2, 'PAID', $3, NOW())
      RETURNING *
    `, [partnerId, amount, referenceNo || null]);
    await client.query("UPDATE partner_commissions SET payout_status = 'PAID' WHERE partner_id = $1 AND id = ANY($2::uuid[])", [partnerId, commissionIds]);
    await client.query("UPDATE partner_subscriptions SET payout_status = 'PAID' WHERE partner_id = $1 AND subscription_id IN (SELECT subscription_id FROM partner_commissions WHERE id = ANY($2::uuid[]))", [partnerId, commissionIds]);
    await client.query('COMMIT');
    await audit(req.auth, 'MARK_PAID', 'PARTNER_PAYOUT', payout.rows[0].id, null, { partnerId, commissionIds, amount });
    res.json({ success: true, payout: payout.rows[0], markedCount: rows.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  } finally {
    client.release();
  }
});

router.post('/subscriptions/assign', authenticateEither, requirePartnerAdmin, async (req, res) => {
  const { partnerId, restaurantCode, planCode, startsAt, paymentAmount, paymentMode, referenceNo } = req.body || {};
  if (!restaurantCode || !planCode) return res.status(400).json({ success: false, message: 'restaurantCode and planCode required' });
  const client = await pool.connect();
  try {
    await ensurePartnerScope(req, partnerId);
    const tenant = await tenantForPartner(restaurantCode, partnerId);
    if (!tenant) return res.status(403).json({ success: false, message: 'Restaurant is outside partner scope' });
    await client.query('BEGIN');
    const partner = await client.query('SELECT commission_percent FROM partners WHERE id = $1', [partnerId]);
    const plan = await client.query('SELECT * FROM subscription_plans WHERE code = $1 AND active = true', [planCode]);
    if (plan.rowCount === 0) throw new Error('Plan not found');
    const startDate = startsAt || new Date().toISOString().slice(0, 10);
    const sub = await client.query(`
      INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
      VALUES ($1, $2, 'ACTIVE', $3::date, $3::date + ($4::int * INTERVAL '1 day'))
      RETURNING *
    `, [tenant.id, plan.rows[0].id, startDate, plan.rows[0].duration_days]);
    await client.query('UPDATE licenses SET status = $1, expires_at = $2 WHERE tenant_id = $3', ['ACTIVE', sub.rows[0].expires_at, tenant.id]);
    if (Number(paymentAmount || 0) > 0) {
      await client.query(`
        INSERT INTO subscription_payments (subscription_id, tenant_id, amount, payment_mode, reference_no)
        VALUES ($1, $2, $3, $4, $5)
      `, [sub.rows[0].id, tenant.id, paymentAmount, paymentMode || null, referenceNo || null]);
    }
    const revenue = Number(paymentAmount || plan.rows[0].price || 0);
    const commissionPercent = Number(partner.rows[0]?.commission_percent || 0);
    const commissionAmount = revenue * commissionPercent / 100;
    await client.query(`
      INSERT INTO partner_commissions (partner_id, subscription_id, restaurant_id, revenue_amount, commission_percent, commission_amount)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [partnerId, sub.rows[0].id, tenant.id, revenue, commissionPercent, commissionAmount]);
    await client.query(`
      INSERT INTO partner_subscriptions (partner_id, subscription_id, restaurant_id, revenue_amount, commission_percent, commission_amount)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [partnerId, sub.rows[0].id, tenant.id, revenue, commissionPercent, commissionAmount]);
    await client.query('COMMIT');
    await audit(req.auth, 'ASSIGN', 'PARTNER_SUBSCRIPTION', sub.rows[0].id, null, { partnerId, restaurantCode, planCode, revenue, commissionAmount });
    res.json({ success: true, subscription: sub.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  } finally {
    client.release();
  }
});

module.exports = router;
