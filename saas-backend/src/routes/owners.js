const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { config, publicError } = require('../config');

const router = express.Router();

function ownerToken(user) {
  return jwt.sign({ id: user.id, role: 'OWNER_USER', type: 'OWNER' }, config.jwtSecret, { expiresIn: '8h' });
}

function authenticateOwner(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ success: false, message: 'Invalid token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], config.jwtSecret);
    if (decoded.type !== 'OWNER') return res.status(403).json({ success: false, message: 'Owner access required' });
    req.owner = decoded;
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

router.post('/change-password', authenticateOwner, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ success: false, message: 'Current password and a 6+ character new password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM owner_users WHERE id = $1 AND active = true', [req.owner.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Owner not found' });
    if (!await bcrypt.compare(currentPassword, result.rows[0].password_hash)) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE owner_users SET password_hash = $1, reset_required = false, updated_at = NOW() WHERE id = $2', [hash, req.owner.id]);
    res.json({ success: true, message: 'Password changed' });
  } catch (err) {
    console.error('OWNER CHANGE PASSWORD ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/dashboard', authenticateOwner, async (req, res) => {
  try {
    const restaurants = await pool.query(`
      SELECT t.id, t.name, t.restaurant_code,
             l.status AS license_status,
             s.status AS subscription_status,
             s.expires_at AS subscription_expires_at,
             GREATEST((s.expires_at::date - CURRENT_DATE), 0) AS days_remaining,
             hb.last_heartbeat_at,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS pos_status,
             hb.pos_version, hb.backup_status, hb.printer_status
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      WHERE ro.owner_user_id = $1 AND ro.active = true
      ORDER BY t.name
    `, [req.owner.id]);
    res.json({ success: true, restaurants: restaurants.rows });
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
