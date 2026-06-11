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
      SELECT l.status, l.expires_at, l.sync_token, t.id AS tenant_id
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

    const modules = await pool.query(`
      SELECT m.code
      FROM tenant_modules tm
      JOIN modules m ON m.id = tm.module_id
      WHERE tm.tenant_id = $1
        AND tm.enabled = true
        AND m.status = 'ACTIVE'
      ORDER BY m.code
    `, [license.tenant_id]);

    res.json({
      valid: true,
      expiresAt: license.expires_at,
      syncToken: license.sync_token,
      enabledModules: modules.rows.map((row) => row.code)
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
