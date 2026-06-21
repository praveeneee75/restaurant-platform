const express = require('express');
const pool = require('../db/db');
const { publicError } = require('../config');

const router = express.Router();

router.get('/restaurants', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.restaurant_code AS "restaurantId",
        t.name,
        t.country,
        COALESCE(t.currency, 'INR') AS currency,
        COALESCE(t.mobile_pos_url, '') AS "posUrl",
        l.expires_at AS "expiresAt"
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      JOIN tenant_modules tm ON tm.tenant_id = t.id AND tm.enabled = true
      JOIN modules m ON m.id = tm.module_id AND m.status = 'ACTIVE' AND m.code = 'MOBILE_APP'
      LEFT JOIN LATERAL (
        SELECT status, expires_at
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON true
      WHERE l.status = 'ACTIVE'
        AND l.expires_at > NOW()
        AND COALESCE(s.status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(s.expires_at, l.expires_at::date) >= CURRENT_DATE
      ORDER BY t.name
    `);
    res.json({ success: true, restaurants: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
