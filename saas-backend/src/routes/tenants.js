const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');
const { sendRestaurantWelcomeEmail } = require('../services/emailService');

const router = express.Router();

async function enablePlanModules(client, tenantId, planId) {
  await client.query(`
    INSERT INTO tenant_modules (tenant_id, module_id, enabled, activated_at, deactivated_at)
    SELECT $1, module_id, true, NOW(), NULL
    FROM subscription_plan_modules
    WHERE plan_id = $2 AND included = true
    ON CONFLICT(tenant_id, module_id) DO UPDATE SET
      enabled = true,
      activated_at = NOW(),
      deactivated_at = NULL
  `, [tenantId, planId]);
}

router.post('/create', authenticate, async (req, res) => {
  const {
    name, ownerName, ownerEmail, ownerPhone, country, currency, expiryDate,
    planCode, startsAt, paymentAmount, paymentMode, referenceNo
  } = req.body;

  if (!name || !ownerName || !ownerEmail || !ownerPhone) {
    return res.status(400).json({ success: false, message: 'Restaurant name, contact name, email and mobile number are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ownerEmail).trim())) {
    return res.status(400).json({ success: false, message: 'Enter a valid owner email address' });
  }
  const normalizedPhone = String(ownerPhone).replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile number with country code' });
  }

  const client = await pool.connect();
  let welcomeDetails;
  try {
    const restaurantCode = `RESTO${Math.floor(10000 + Math.random() * 90000)}`;
    const tenantId = uuidv4();
    const licenseKey = uuidv4();
    const syncToken = uuidv4();
    const expiresAt = expiryDate || null;

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenants (id, restaurant_code, name, country, currency, contact_name, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, restaurantCode, name, country || null, currency || null, ownerName.trim(), ownerEmail.trim().toLowerCase(), normalizedPhone]
    );
    const license = await client.query(
      `INSERT INTO licenses (tenant_id, license_key, sync_token, expires_at, status)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW() + INTERVAL '1 year'), 'ACTIVE')
       RETURNING expires_at`,
      [tenantId, licenseKey, syncToken, expiresAt]
    );
    let subscription = null;
    let planName = 'Standard';
    if (planCode) {
      const plan = await client.query('SELECT * FROM subscription_plans WHERE code = $1 AND active = true', [planCode]);
      if (plan.rowCount === 0) throw new Error('Selected license package not found');
      const startDate = startsAt || new Date().toISOString().slice(0, 10);
      const sub = await client.query(`
        INSERT INTO subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
        VALUES ($1, $2, 'ACTIVE', $3::date, $3::date + ($4::int * INTERVAL '1 day'))
        RETURNING *
      `, [tenantId, plan.rows[0].id, startDate, plan.rows[0].duration_days]);
      subscription = sub.rows[0];
      planName = plan.rows[0].name;
      await client.query('UPDATE licenses SET status = $1, expires_at = $2 WHERE tenant_id = $3', ['ACTIVE', subscription.expires_at, tenantId]);
      await enablePlanModules(client, tenantId, plan.rows[0].id);
      if (Number(paymentAmount || 0) > 0) {
        await client.query(`
          INSERT INTO subscription_payments (subscription_id, tenant_id, amount, payment_mode, reference_no)
          VALUES ($1, $2, $3, $4, $5)
        `, [subscription.id, tenantId, paymentAmount, paymentMode || null, referenceNo || null]);
      }
    }

    const normalizedEmail = String(ownerEmail).trim().toLowerCase();
    const existingOwner = await client.query(
      'SELECT id, name, email, active FROM owner_users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );
    let owner = existingOwner.rows[0];
    let temporaryPassword = null;
    if (owner && !owner.active) {
      throw new Error('An inactive owner account already uses this email. Reactivate it before creating the customer.');
    }
    if (!owner) {
      temporaryPassword = `Km!${crypto.randomBytes(8).toString('hex')}`;
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      const createdOwner = await client.query(
        `INSERT INTO owner_users (name, email, password_hash, active, reset_required)
         VALUES ($1, $2, $3, true, true)
         RETURNING id, name, email`,
        [String(ownerName).trim(), normalizedEmail, passwordHash]
      );
      owner = createdOwner.rows[0];
    }
    await client.query(
      `INSERT INTO restaurant_owners (owner_user_id, tenant_id, active)
       VALUES ($1, $2, true)
       ON CONFLICT(owner_user_id, tenant_id) DO UPDATE SET active = true`,
      [owner.id, tenantId]
    );

    await client.query('COMMIT');

    welcomeDetails = {
      restaurantName: name,
      restaurantCode,
      licenseKey,
      expiresAt: subscription?.expires_at || license.rows[0].expires_at,
      planName,
      ownerEmail: owner.email,
      ownerPhone: normalizedPhone,
      temporaryPassword
    };
    let notification;
    try {
      notification = await sendRestaurantWelcomeEmail(welcomeDetails);
    } catch (emailError) {
      console.error('WELCOME EMAIL ERROR:', emailError.message);
      notification = { sent: false, reason: 'Customer created, but the welcome email could not be sent' };
    }

    res.json({
      success: true,
      restaurantCode,
      restaurantId: restaurantCode,
      licenseKey,
      syncToken,
      subscription,
      owner: { id: owner.id, name: owner.name, email: owner.email, created: Boolean(temporaryPassword) },
      temporaryPassword,
      notification
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('TENANT CREATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  } finally {
    client.release();
  }
});

router.get('/list', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.name,
        t.restaurant_code,
        t.mobile_pos_url,
        t.contact_name,
        t.contact_email,
        t.contact_phone,
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

router.post('/update-customer-details', authenticate, async (req, res) => {
  const { restaurantCode, contactName, notificationEmail, contactPhone } = req.body || {};

  if (!restaurantCode) {
    return res.status(400).json({ success: false, message: 'restaurantCode required' });
  }
  const normalizedEmail = String(notificationEmail || '').trim().toLowerCase();
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ success: false, message: 'Enter a valid notification email address' });
  }
  const normalizedPhone = String(contactPhone || '').replace(/[^\d+]/g, '');
  if (normalizedPhone && !/^\+?\d{8,15}$/.test(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid phone number with country code' });
  }

  try {
    const result = await pool.query(
      `UPDATE tenants
       SET contact_name = NULLIF($1, ''),
           contact_email = NULLIF($2, ''),
           contact_phone = NULLIF($3, '')
       WHERE restaurant_code = $4`,
      [String(contactName || '').trim(), normalizedEmail, normalizedPhone, restaurantCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    res.json({ success: true, message: 'Customer details updated' });
  } catch (err) {
    console.error('TENANT CUSTOMER DETAILS UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
