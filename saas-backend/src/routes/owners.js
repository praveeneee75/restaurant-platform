const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { config, publicError } = require('../config');
const { isTokenRevoked, revokeToken, tokenFromRequest } = require('../utils/tokenSessions');
const { sendOwnerTemporaryPasswordEmail, sendOwnerUsernameRecoveryEmail } = require('../services/emailService');

const router = express.Router();

function ownerToken(user) {
  return jwt.sign({
    id: user.id,
    role: 'OWNER_USER',
    type: 'OWNER',
    resetRequired: Boolean(user.reset_required)
  }, config.jwtSecret, { expiresIn: '8h' });
}

function publicRestaurantRows(rows) {
  return rows.map((row) => ({
    name: row.name,
    restaurant_code: row.restaurant_code,
    notification_email: row.contact_email || ''
  }));
}

async function restaurantsForOwnerEmail(email) {
  return pool.query(`
    SELECT DISTINCT t.name, t.restaurant_code, t.contact_email, ou.email AS owner_email
    FROM owner_users ou
    JOIN restaurant_owners ro ON ro.owner_user_id = ou.id AND ro.active = true
    JOIN tenants t ON t.id = ro.tenant_id
    WHERE LOWER(ou.email) = LOWER($1) AND ou.active = true
    ORDER BY t.name
  `, [String(email || '').trim()]);
}

async function restaurantsForNotificationEmail(email) {
  return pool.query(`
    SELECT DISTINCT t.name, t.restaurant_code, t.contact_email, ou.email AS owner_email
    FROM tenants t
    JOIN restaurant_owners ro ON ro.tenant_id = t.id AND ro.active = true
    JOIN owner_users ou ON ou.id = ro.owner_user_id AND ou.active = true
    WHERE LOWER(t.contact_email) = LOWER($1)
    ORDER BY t.name, ou.email
  `, [String(email || '').trim()]);
}

async function authenticateOwner(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ success: false, message: 'Invalid token' });
  try {
    const token = tokenFromRequest(req);
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.type !== 'OWNER') return res.status(403).json({ success: false, message: 'Owner access required' });
    if (await isTokenRevoked(token)) return res.status(401).json({ success: false, message: 'Session expired' });
    const currentUser = await pool.query(
      'SELECT id, name, email, reset_required FROM owner_users WHERE id = $1 AND active = true',
      [decoded.id]
    );
    if (currentUser.rowCount === 0) return res.status(401).json({ success: false, message: 'Owner account is inactive' });
    if (currentUser.rows[0].reset_required && !['/change-password', '/logout'].includes(req.path)) {
      return res.status(403).json({
        success: false,
        passwordChangeRequired: true,
        message: 'Change the temporary password before continuing'
      });
    }
    req.owner = decoded;
    req.ownerUser = currentUser.rows[0];
    next();
  } catch (_) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM owner_users WHERE email = $1 AND active = true', [email]);
    if (result.rowCount === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    res.json({ success: true, token: ownerToken(user), owner: { id: user.id, name: user.name, email: user.email, resetRequired: user.reset_required } });
  } catch (err) {
    console.error('OWNER LOGIN ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/recovery/password/lookup', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ success: false, message: 'Username is required' });
  try {
    const result = await restaurantsForOwnerEmail(username);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'customer doesnt exists' });
    res.json({
      success: true,
      ownerEmail: result.rows[0].owner_email,
      restaurants: publicRestaurantRows(result.rows)
    });
  } catch (err) {
    console.error('OWNER PASSWORD LOOKUP ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/recovery/password/send', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ success: false, message: 'Username is required' });
  try {
    const result = await restaurantsForOwnerEmail(username);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'customer doesnt exists' });
    const notificationEmails = [...new Set(result.rows.map((row) => row.contact_email).filter(Boolean))];
    if (notificationEmails.length === 0) return res.status(404).json({ success: false, message: 'customer doesnt exists' });

    const temporaryPassword = `Km!${crypto.randomBytes(8).toString('hex')}`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      'UPDATE owner_users SET password_hash = $1, reset_required = true, updated_at = NOW() WHERE LOWER(email) = LOWER($2) AND active = true',
      [passwordHash, username]
    );

    const restaurants = publicRestaurantRows(result.rows);
    const notifications = [];
    for (const notificationEmail of notificationEmails) {
      notifications.push(await sendOwnerTemporaryPasswordEmail({
        notificationEmail,
        ownerEmail: result.rows[0].owner_email,
        temporaryPassword,
        restaurants: restaurants.filter((restaurant) => restaurant.notification_email === notificationEmail)
      }));
    }
    res.json({ success: true, message: 'Temporary password sent', restaurants, notifications });
  } catch (err) {
    console.error('OWNER PASSWORD SEND ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/recovery/username/lookup', async (req, res) => {
  const { notificationEmail } = req.body || {};
  if (!notificationEmail) return res.status(400).json({ success: false, message: 'Notification email is required' });
  try {
    const result = await restaurantsForNotificationEmail(notificationEmail);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'customer doesnt exists' });
    res.json({
      success: true,
      ownerEmails: [...new Set(result.rows.map((row) => row.owner_email))],
      restaurants: publicRestaurantRows(result.rows)
    });
  } catch (err) {
    console.error('OWNER USERNAME LOOKUP ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/recovery/username/send', async (req, res) => {
  const { notificationEmail } = req.body || {};
  if (!notificationEmail) return res.status(400).json({ success: false, message: 'Notification email is required' });
  try {
    const result = await restaurantsForNotificationEmail(notificationEmail);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'customer doesnt exists' });

    const grouped = new Map();
    result.rows.forEach((row) => {
      if (!grouped.has(row.owner_email)) grouped.set(row.owner_email, []);
      grouped.get(row.owner_email).push(row);
    });
    const notifications = [];
    for (const [ownerEmail, rows] of grouped.entries()) {
      notifications.push(await sendOwnerUsernameRecoveryEmail({
        notificationEmail,
        ownerEmail,
        restaurants: publicRestaurantRows(rows)
      }));
    }
    res.json({
      success: true,
      message: 'Username sent',
      ownerEmails: [...grouped.keys()],
      restaurants: publicRestaurantRows(result.rows),
      notifications
    });
  } catch (err) {
    console.error('OWNER USERNAME SEND ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/change-password', authenticateOwner, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 10) {
    return res.status(400).json({ success: false, message: 'Current password and a new password of at least 10 characters are required' });
  }
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ success: false, message: 'New password must include uppercase, lowercase and a number' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'New password must be different from the temporary password' });
  }
  try {
    const result = await pool.query('SELECT * FROM owner_users WHERE id = $1 AND active = true', [req.owner.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Owner not found' });
    if (!await bcrypt.compare(currentPassword, result.rows[0].password_hash)) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE owner_users SET password_hash = $1, reset_required = false, updated_at = NOW() WHERE id = $2', [hash, req.owner.id]);
    const refreshedUser = { ...result.rows[0], reset_required: false };
    res.json({
      success: true,
      message: 'Password changed',
      token: ownerToken(refreshedUser),
      owner: {
        id: refreshedUser.id,
        name: refreshedUser.name,
        email: refreshedUser.email,
        resetRequired: false
      }
    });
  } catch (err) {
    console.error('OWNER CHANGE PASSWORD ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/profile', authenticateOwner, async (req, res) => {
  try {
    const contacts = await pool.query(`
      SELECT DISTINCT t.contact_name, t.contact_email, t.contact_phone
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      WHERE ro.owner_user_id = $1 AND ro.active = true
      ORDER BY t.contact_email NULLS LAST, t.contact_phone NULLS LAST
      LIMIT 1
    `, [req.owner.id]);
    const contact = contacts.rows[0] || {};
    res.json({
      success: true,
      profile: {
        name: req.ownerUser.name || '',
        username: req.ownerUser.email,
        notificationEmail: contact.contact_email || req.ownerUser.email,
        mobileNumber: contact.contact_phone || ''
      }
    });
  } catch (err) {
    console.error('OWNER PROFILE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/profile', authenticateOwner, async (req, res) => {
  const { name, notificationEmail, mobileNumber } = req.body || {};
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(notificationEmail || '').trim().toLowerCase();
  const normalizedPhone = String(mobileNumber || '').replace(/[^\d+]/g, '');

  if (!normalizedName) return res.status(400).json({ success: false, message: 'Name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ success: false, message: 'Enter a valid notification email address' });
  }
  if (normalizedPhone && !/^\+?\d{8,15}$/.test(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile number with country code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedOwner = await client.query(
      'UPDATE owner_users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, reset_required',
      [normalizedName, req.owner.id]
    );
    await client.query(`
      UPDATE tenants
      SET contact_name = $1,
          contact_email = $2,
          contact_phone = NULLIF($3, '')
      WHERE id IN (
        SELECT tenant_id FROM restaurant_owners WHERE owner_user_id = $4 AND active = true
      )
    `, [normalizedName, normalizedEmail, normalizedPhone, req.owner.id]);
    await client.query('COMMIT');

    const owner = updatedOwner.rows[0];
    res.json({
      success: true,
      message: 'Profile updated',
      owner: { id: owner.id, name: owner.name, email: owner.email, resetRequired: owner.reset_required },
      profile: {
        name: owner.name,
        username: owner.email,
        notificationEmail: normalizedEmail,
        mobileNumber: normalizedPhone
      }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('OWNER PROFILE UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.post('/logout', authenticateOwner, async (req, res) => {
  try {
    await revokeToken(tokenFromRequest(req));
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    console.error('OWNER LOGOUT ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/dashboard', authenticateOwner, async (req, res) => {
  try {
    const restaurants = await pool.query(`
      SELECT t.id, t.name, t.restaurant_code,
             l.license_key,
             l.status AS license_status,
             l.expires_at AS license_expires_at,
             p.code AS package_code,
             p.name AS package_name,
             s.status AS subscription_status,
             s.expires_at AS subscription_expires_at,
             GREATEST((s.expires_at::date - CURRENT_DATE), 0) AS days_remaining,
             EXISTS (
               SELECT 1
               FROM tenant_modules tm
               JOIN modules m ON m.id = tm.module_id
               WHERE tm.tenant_id = t.id AND tm.enabled = true
                 AND m.code = 'MOBILE_APP' AND m.status = 'ACTIVE'
             ) AS mobile_app_enabled,
             hb.last_heartbeat_at,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS pos_status,
             hb.pos_version, hb.backup_status, hb.printer_status
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN subscription_plans p ON p.id = s.plan_id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE ro.owner_user_id = $1 AND ro.active = true
      ORDER BY t.name
    `, [req.owner.id]);
    const organizations = await pool.query(`
      SELECT o.id, o.name,
             COUNT(DISTINCT t.id) AS branch_count,
             COALESCE(SUM(today.net_sales), 0) AS today_net_sales,
             COALESCE(SUM(today.orders_count), 0) AS today_orders,
             COALESCE(SUM(monthly.net_sales), 0) AS month_net_sales,
             COALESCE(SUM(monthly.orders_count), 0) AS month_orders,
             COALESCE(SUM(CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '10 minutes' THEN 1 ELSE 0 END), 0) AS online_branches
      FROM restaurant_owners ro
      JOIN organization_restaurants org_rest ON org_rest.tenant_id = ro.tenant_id AND org_rest.active = true
      JOIN organizations o ON o.id = org_rest.organization_id
      JOIN tenants t ON t.id = org_rest.tenant_id
      LEFT JOIN tenant_daily_reports today ON today.tenant_id = t.id AND today.report_date = CURRENT_DATE
      LEFT JOIN tenant_daily_reports monthly ON monthly.tenant_id = t.id AND monthly.report_date >= DATE_TRUNC('month', CURRENT_DATE)
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE ro.owner_user_id = $1 AND ro.active = true
      GROUP BY o.id
      ORDER BY o.name
    `, [req.owner.id]);
    res.json({
      success: true,
      owner: { id: req.ownerUser.id, name: req.ownerUser.name, email: req.ownerUser.email },
      restaurants: restaurants.rows,
      organizations: organizations.rows
    });
  } catch (err) {
    console.error('OWNER DASHBOARD ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/list', authenticate, async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, active, reset_required, created_at FROM owner_users ORDER BY created_at DESC');
    res.json({ success: true, owners: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/create', authenticate, async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 6) return res.status(400).json({ success: false, message: 'Name, email and 6+ character password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO owner_users (name, email, password_hash, reset_required)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, email, active, reset_required, created_at`,
      [name, email, hash]
    );
    res.json({ success: true, owner: result.rows[0] });
  } catch (err) {
    console.error('OWNER CREATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/reset-password', authenticate, async (req, res) => {
  const { ownerId, password } = req.body || {};
  if (!ownerId || !password || String(password).length < 6) return res.status(400).json({ success: false, message: 'Owner and 6+ character password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE owner_users SET password_hash = $1, reset_required = true, updated_at = NOW() WHERE id = $2', [hash, ownerId]);
    res.json({ success: true, message: 'Owner password reset' });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/assign', authenticate, async (req, res) => {
  const { ownerId, restaurantCode } = req.body || {};
  if (!ownerId || !restaurantCode) return res.status(400).json({ success: false, message: 'ownerId and restaurantCode required' });
  try {
    const tenant = await pool.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantCode]);
    if (tenant.rowCount === 0) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    await pool.query(`
      INSERT INTO restaurant_owners (owner_user_id, tenant_id, active)
      VALUES ($1, $2, true)
      ON CONFLICT(owner_user_id, tenant_id) DO UPDATE SET active = true
    `, [ownerId, tenant.rows[0].id]);
    res.json({ success: true, message: 'Owner assigned' });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/remove', authenticate, async (req, res) => {
  const { ownerId, restaurantCode } = req.body || {};
  if (!ownerId || !restaurantCode) return res.status(400).json({ success: false, message: 'ownerId and restaurantCode required' });
  try {
    await pool.query(`
      UPDATE restaurant_owners SET active = false
      WHERE owner_user_id = $1 AND tenant_id = (SELECT id FROM tenants WHERE restaurant_code = $2)
    `, [ownerId, restaurantCode]);
    res.json({ success: true, message: 'Owner removed from restaurant' });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
