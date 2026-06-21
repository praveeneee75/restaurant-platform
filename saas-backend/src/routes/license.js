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
      SELECT l.status, l.expires_at, l.sync_token,
             t.id AS tenant_id, t.name AS restaurant_name,
             p.code AS package_code, p.name AS package_name
      FROM licenses l
      JOIN tenants t ON t.id = l.tenant_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN subscription_plans p ON p.id = s.plan_id
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

    const release = await pool.query(`
      SELECT version, release_notes, mandatory_update
      FROM releases
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    res.json({
      valid: true,
      restaurantName: license.restaurant_name,
      expiresAt: license.expires_at,
      syncToken: license.sync_token,
      packageCode: license.package_code || null,
      packageName: license.package_name || null,
      enabledModules: modules.rows.map((row) => row.code),
      updatePolicy: release.rowCount === 0 ? null : {
        latestVersion: release.rows[0].version,
        minimumVersion: release.rows[0].mandatory_update ? release.rows[0].version : null,
        mandatory: release.rows[0].mandatory_update,
        releaseNotes: release.rows[0].release_notes || ''
      }
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
