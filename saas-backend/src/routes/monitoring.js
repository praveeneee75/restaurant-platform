const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
const heartbeatCredentialCache = new Map();
const HEARTBEAT_CACHE_MS = 5 * 60 * 1000;

function credentialCacheKey(restaurantId, licenseKey, syncToken) {
  return `${restaurantId}|${licenseKey || ''}|${syncToken || ''}`;
}

async function tenantForHeartbeat(restaurantId, licenseKey, syncToken) {
  const key = credentialCacheKey(restaurantId, licenseKey, syncToken);
  const cached = heartbeatCredentialCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;
  const tenant = await pool.query(`
    SELECT t.id
    FROM tenants t
    JOIN licenses l ON l.tenant_id = t.id
    WHERE t.restaurant_code = $1
      AND (($2::text IS NOT NULL AND l.license_key = $2) OR ($3::text IS NOT NULL AND l.sync_token = $3))
    LIMIT 1
  `, [restaurantId, licenseKey || null, syncToken || null]);
  if (tenant.rowCount > 0) {
    heartbeatCredentialCache.set(key, { tenant: tenant.rows[0], expiresAt: Date.now() + HEARTBEAT_CACHE_MS });
  }
  return tenant.rows[0] || null;
}

router.post('/heartbeat', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, posVersion, backupStatus, printerStatus, licenseStatus, appStatus } = req.body || {};
  if (!restaurantId || (!licenseKey && !syncToken)) return res.status(400).json({ success: false, message: 'restaurantId and sync credentials required' });
  try {
    const tenant = await tenantForHeartbeat(restaurantId, licenseKey, syncToken);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid heartbeat credentials' });
    await pool.query(`
      INSERT INTO pos_heartbeats (tenant_id, restaurant_code, pos_version, backup_status, printer_status, license_status, app_status, payload, last_heartbeat_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT(restaurant_code) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        pos_version = EXCLUDED.pos_version,
        backup_status = EXCLUDED.backup_status,
        printer_status = EXCLUDED.printer_status,
        license_status = EXCLUDED.license_status,
        app_status = EXCLUDED.app_status,
        payload = EXCLUDED.payload,
        last_heartbeat_at = NOW()
    `, [tenant.id, restaurantId, posVersion || null, backupStatus || null, printerStatus || null, licenseStatus || null, appStatus || 'OK', req.body || {}]);
    res.json({ success: true, message: 'Heartbeat recorded' });
  } catch (err) {
    console.error('POS HEARTBEAT ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/status', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, l.status AS license_status,
             hb.pos_version, hb.backup_status, hb.printer_status, hb.app_status,
             hb.last_heartbeat_at,
             CASE WHEN hb.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END AS online_status
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      ORDER BY t.created_at DESC
    `);
    res.json({ success: true, restaurants: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/diagnostics', authenticate, async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  try {
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, l.status AS license_status, l.expires_at,
             hb.pos_version, hb.backup_status, hb.printer_status, hb.app_status, hb.payload, hb.last_heartbeat_at,
             latest_sync.status AS sync_status, latest_sync.message AS sync_message, latest_sync.created_at AS last_sync_at
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      LEFT JOIN LATERAL (
        SELECT status, message, created_at FROM tenant_sync_logs WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
      ) latest_sync ON true
      WHERE t.restaurant_code = $1
    `, [restaurantId]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    const notes = await pool.query('SELECT * FROM support_notes WHERE restaurant_code = $1 ORDER BY created_at DESC LIMIT 50', [restaurantId]);
    res.json({ success: true, diagnostics: result.rows[0], supportNotes: notes.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/support-notes', authenticate, async (req, res) => {
  const { restaurantId, note } = req.body || {};
  if (!restaurantId || !note) return res.status(400).json({ success: false, message: 'restaurantId and note required' });
  try {
    const tenant = await pool.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantId]);
    const result = await pool.query(`
      INSERT INTO support_notes (tenant_id, restaurant_code, note, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [tenant.rows[0]?.id || null, restaurantId, note, req.user?.id || null]);
    res.json({ success: true, note: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
