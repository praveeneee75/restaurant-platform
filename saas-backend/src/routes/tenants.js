const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();

router.post('/create', authenticate, async (req, res) => {
  const { name, country, currency, expiryDate, mobilePosUrl } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: 'Restaurant name required' });
  }

  try {
    const restaurantCode = `RESTO${Math.floor(10000 + Math.random() * 90000)}`;
    const tenantId = uuidv4();
    const licenseKey = uuidv4();
    const syncToken = uuidv4();
    const expiresAt = expiryDate || null;

    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO tenants (id, restaurant_code, name, country, currency, mobile_pos_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, restaurantCode, name, country || null, currency || null, mobilePosUrl || null]
    );
    await pool.query(
      `INSERT INTO licenses (tenant_id, license_key, sync_token, expires_at, status)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW() + INTERVAL '1 year'), 'ACTIVE')`,
      [tenantId, licenseKey, syncToken, expiresAt]
    );
    await pool.query('COMMIT');

    res.json({
      success: true,
      restaurantCode,
      restaurantId: restaurantCode,
      licenseKey,
      syncToken
    });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('TENANT CREATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/list', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.name,
        t.restaurant_code,
        t.mobile_pos_url,
        l.license_key,
        l.expires_at,
        l.status,
        latest_sync.created_at AS last_sync_at,
        latest_sync.status AS sync_status,
        COALESCE(today.net_sales, 0) AS today_revenue
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT created_at, status
        FROM tenant_sync_logs
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_sync ON true
      LEFT JOIN tenant_daily_reports today
        ON today.tenant_id = t.id AND today.report_date = CURRENT_DATE
      ORDER BY t.created_at DESC
    `);

    res.json({ success: true, tenants: result.rows });
  } catch (err) {
    console.error('TENANT LIST ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/update-license', authenticate, async (req, res) => {
  const { restaurantCode, expiresAt, status } = req.body;

  if (!restaurantCode || !expiresAt) {
    return res.status(400).json({ success: false, message: 'restaurantCode and expiresAt required' });
  }

  try {
    const result = await pool.query(`
      UPDATE licenses
      SET expires_at = $1,
          status = $2
      WHERE tenant_id = (
        SELECT id FROM tenants WHERE restaurant_code = $3
      )
    `, [expiresAt, status || 'ACTIVE', restaurantCode]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    res.json({ success: true, message: 'License updated' });
  } catch (err) {
    console.error('LICENSE UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/update-mobile-url', authenticate, async (req, res) => {
  const { restaurantCode, mobilePosUrl } = req.body;

  if (!restaurantCode) {
    return res.status(400).json({ success: false, message: 'restaurantCode required' });
  }

  try {
    const result = await pool.query(
      'UPDATE tenants SET mobile_pos_url = $1 WHERE restaurant_code = $2',
      [mobilePosUrl || null, restaurantCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    res.json({ success: true, message: 'Mobile POS URL updated' });
  } catch (err) {
    console.error('TENANT MOBILE URL UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
