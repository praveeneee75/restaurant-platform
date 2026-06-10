const express = require('express');
const pool = require('../db/db');
const { publicError } = require('../config');

const router = express.Router();

router.post('/validate', async (req, res) => {
  const { restaurantId, licenseKey } = req.body;

  if (!restaurantId || !licenseKey) {
    return res.status(400).json({
      valid: false,
      message: 'Missing fields'
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT l.status, l.expires_at, l.sync_token
      FROM licenses l
      JOIN tenants t ON t.id = l.tenant_id
      WHERE t.restaurant_code = $1
      AND l.license_key = $2
      `,
      [restaurantId, licenseKey]
    );

    if (result.rowCount === 0) {
      return res.json({ valid: false });
    }

    const license = result.rows[0];

    if (license.status !== 'ACTIVE') {
      return res.json({ valid: false });
    }

    res.json({
      valid: true,
      expiresAt: license.expires_at,
      syncToken: license.sync_token
    });

  } catch (err) {
    console.error('LICENSE VALIDATE ERROR:', err.message);
    res.status(500).json({
      valid: false,
      message: publicError(err)
    });
  }
});

module.exports = router;
