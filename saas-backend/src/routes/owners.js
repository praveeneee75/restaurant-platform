const express = require('express');
const { validStateCode } = require('../utils/indiaStates');
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

router.get('/restaurants', authenticateOwner, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, t.contact_email
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      WHERE ro.owner_user_id = $1 AND ro.active = true
      ORDER BY t.name
    `, [req.ownerUser.id]);
    res.json({ success: true, restaurants: publicRestaurantRows(result.rows) });
  } catch (err) {
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

router.get('/branch-profiles', authenticateOwner, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.restaurant_code, t.name, t.legal_name, t.gstin, t.fssai_license_no,
             t.sac_code, t.tax_rate, t.state_code, t.address_line_1, t.address_line_2,
             t.city, t.state, t.country, t.phone, t.email, t.currency, t.timezone
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      WHERE ro.owner_user_id = $1 AND ro.active = true
      ORDER BY t.name
    `, [req.owner.id]);
    res.json({ success: true, branches: result.rows });
  } catch (err) {
    console.error('OWNER BRANCH PROFILES ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.put('/branch-profiles/:restaurantCode', authenticateOwner, async (req, res) => {
  const profile = req.body || {};
  const required = ['name','legalName','sacCode','stateCode','addressLine1','city','state','country','phone','email','currency','timezone'];
  const missing = required.filter((key) => !String(profile[key] || '').trim());
  if (missing.length) return res.status(400).json({ success: false, message: `Complete the required branch fields: ${missing.join(', ')}` });
  if (!/^\d{2}$/.test(String(profile.stateCode))) return res.status(400).json({ success: false, message: 'Select a valid Indian state or union territory' });
  if (!validStateCode(profile.state, profile.stateCode)) return res.status(400).json({ success: false, message: 'State and GST state code do not match' });
  if (!/^\d{6,8}$/.test(String(profile.sacCode))) return res.status(400).json({ success: false, message: 'SAC code must contain 6 to 8 digits' });
  if (profile.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(profile.gstin).trim().toUpperCase())) return res.status(400).json({ success: false, message: 'Enter a valid GSTIN' });
  if (profile.gstin && String(profile.gstin).trim().slice(0,2) !== String(profile.stateCode)) return res.status(400).json({ success: false, message: 'GSTIN prefix must match the selected GST state code' });
  if (profile.fssaiLicenseNo && !/^\d{14}$/.test(String(profile.fssaiLicenseNo).replace(/\D/g, ''))) return res.status(400).json({ success: false, message: 'FSSAI number must contain 14 digits' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email))) return res.status(400).json({ success: false, message: 'Enter a valid branch email' });
  try {
    const result = await pool.query(`
      UPDATE tenants t SET name=$1, legal_name=$2, gstin=NULLIF($3,''), fssai_license_no=NULLIF($4,''),
        sac_code=$5, tax_rate=$6, state_code=$7, address_line_1=$8, address_line_2=$9,
        city=$10, state=$11, country=$12, phone=$13, email=$14, currency=$15, timezone=$16, updated_at=NOW()
      WHERE t.restaurant_code=$17 AND EXISTS (
        SELECT 1 FROM restaurant_owners ro WHERE ro.tenant_id=t.id AND ro.owner_user_id=$18 AND ro.active=true
      ) RETURNING t.restaurant_code, t.name
    `, [String(profile.name).trim(), String(profile.legalName).trim(), String(profile.gstin || '').trim().toUpperCase(), String(profile.fssaiLicenseNo || '').replace(/\D/g,''), String(profile.sacCode).trim(), Number(profile.taxRate || 0), String(profile.stateCode), String(profile.addressLine1).trim(), String(profile.addressLine2 || '').trim(), String(profile.city).trim(), String(profile.state).trim(), String(profile.country).trim(), String(profile.phone).trim(), String(profile.email).trim().toLowerCase(), String(profile.currency).trim().toUpperCase(), String(profile.timezone).trim(), String(req.params.restaurantCode).trim().toUpperCase(), req.owner.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Branch not found or not assigned to this owner' });
    res.json({ success: true, message: `${result.rows[0].name} profile saved. POS will receive it at next authentication.` });
  } catch (err) {
    console.error('OWNER BRANCH PROFILE UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/branch-profiles/:restaurantCode/disconnect', authenticateOwner, async (req, res) => {
  const restaurantCode = String(req.params.restaurantCode || '').trim().toUpperCase();
  try {
    const assigned = await pool.query(`SELECT t.restaurant_code, t.name FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      WHERE ro.owner_user_id = $1 AND ro.active = true ORDER BY t.name`, [req.owner.id]);
    if (assigned.rowCount <= 1) return res.status(400).json({ success: false, message: 'Keep at least one outlet connected to this owner account' });
    const result = await pool.query(`UPDATE restaurant_owners ro SET active = false
      FROM tenants t WHERE ro.tenant_id = t.id AND ro.owner_user_id = $1
        AND ro.active = true AND t.restaurant_code = $2 RETURNING t.name`, [req.owner.id, restaurantCode]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Connected outlet not found' });
    res.json({ success: true, message: `${result.rows[0].name} was disconnected from this owner account. Restaurant and POS data were not deleted.` });
  } catch (err) {
    console.error('OWNER BRANCH DISCONNECT ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
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

router.get('/dashboard/statistics', authenticateOwner, async (req, res) => {
  const requestedDate = String(req.query.date || '').trim();
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : new Date().toISOString().slice(0, 10);
  const requestedRestaurant = String(req.query.restaurantId || 'ALL').trim();
  try {
    const result = await pool.query(`
      SELECT t.id, t.name, t.restaurant_code,
             COALESCE(r.gross_sales, 0) AS gross_sales,
             COALESCE(r.net_sales, 0) AS net_sales,
             COALESCE(r.tax_amount, 0) AS tax_amount,
             COALESCE(r.discount_amount, 0) AS discount_amount,
             COALESCE(r.refunds_amount, 0) AS refunds_amount,
             COALESCE(r.orders_count, 0) AS orders_count,
             COALESCE(r.cash_total, 0) AS cash_total,
             COALESCE(r.card_total, 0) AS card_total,
             COALESCE(r.upi_total, 0) AS upi_total,
             r.updated_at,
             s.executive_sales,
             s.reprint_summary,
             s.received_at AS snapshot_received_at
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      LEFT JOIN tenant_daily_reports r ON r.tenant_id = t.id AND r.report_date = $2::date
      LEFT JOIN tenant_operational_snapshots s ON s.tenant_id = t.id
      WHERE ro.owner_user_id = $1 AND ro.active = true
        AND ($3 = 'ALL' OR t.restaurant_code = $3)
      ORDER BY t.name
    `, [req.owner.id, reportDate, requestedRestaurant]);
    if (requestedRestaurant !== 'ALL' && !result.rowCount) {
      return res.status(404).json({ success: false, message: 'Restaurant not found for this owner' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = result.rows.map((row) => {
      const sales = row.executive_sales && typeof row.executive_sales === 'object' ? row.executive_sales : {};
      const leakage = sales.leakage || {};
      const bills = leakage.bills || {};
      const reprints = row.reprint_summary && typeof row.reprint_summary === 'object' ? row.reprint_summary : {};
      const currentOnly = reportDate === today;
      return {
        name: row.name,
        restaurantCode: row.restaurant_code,
        orders: Number(row.orders_count || 0),
        sales: Number(row.gross_sales || 0),
        netSales: Number(row.net_sales || 0),
        tax: Number(row.tax_amount || 0),
        discount: Number(row.discount_amount || 0),
        refunds: Number(row.refunds_amount || 0),
        cashCollection: Number(row.cash_total || 0),
        cardCollection: Number(row.card_total || 0),
        upiCollection: Number(row.upi_total || 0),
        onlineSales: currentOnly ? Number(sales.onlineOrders?.sales || 0) : 0,
        modified: currentOnly ? Number(bills.modified || 0) : 0,
        reprinted: currentOnly ? Number(bills.reprinted || reprints.count || reprints.total || 0) : 0,
        waivedOff: currentOnly ? Number(bills.waived || 0) : 0,
        roundOff: currentOnly ? Number(sales.today?.roundOff || sales.roundOff || 0) : 0,
        deliveryCharge: currentOnly ? Number(sales.today?.deliveryCharge || sales.deliveryCharge || 0) : 0,
        containerCharge: currentOnly ? Number(sales.today?.containerCharge || sales.containerCharge || 0) : 0,
        serviceCharge: currentOnly ? Number(sales.today?.serviceCharge || sales.serviceCharge || 0) : 0,
        reportUpdatedAt: row.updated_at || null,
        snapshotUpdatedAt: row.snapshot_received_at || null
      };
    });
    const sumFields = ['orders', 'sales', 'netSales', 'tax', 'discount', 'refunds', 'cashCollection', 'cardCollection', 'upiCollection', 'onlineSales', 'modified', 'reprinted', 'waivedOff', 'roundOff', 'deliveryCharge', 'containerCharge', 'serviceCharge'];
    const totals = Object.fromEntries(sumFields.map((field) => [field, rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)]));
    res.json({ success: true, reportDate, restaurantId: requestedRestaurant, totals, outlets: rows });
  } catch (err) {
    console.error('OWNER DASHBOARD STATISTICS ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/dashboard/live-orders', authenticateOwner, async (req, res) => {
  const requestedRestaurant = String(req.query.restaurantId || 'ALL').trim();
  try {
    const result = await pool.query(`
      SELECT t.name, t.restaurant_code, s.live_operations, s.received_at
      FROM restaurant_owners ro
      JOIN tenants t ON t.id = ro.tenant_id
      LEFT JOIN tenant_operational_snapshots s ON s.tenant_id = t.id
      WHERE ro.owner_user_id = $1 AND ro.active = true
        AND ($2 = 'ALL' OR t.restaurant_code = $2)
      ORDER BY t.name
    `, [req.owner.id, requestedRestaurant]);
    if (requestedRestaurant !== 'ALL' && !result.rowCount) {
      return res.status(404).json({ success: false, message: 'Restaurant not found for this owner' });
    }
    const orders = [];
    let lastUpdatedAt = null;
    result.rows.forEach((row) => {
      const operations = row.live_operations && typeof row.live_operations === 'object' ? row.live_operations : {};
      Object.entries(operations).forEach(([channel, values]) => {
        (Array.isArray(values) ? values : []).forEach((order) => {
          if (String(order.reference || '').toUpperCase().startsWith('DRAFT-')) return;
          orders.push({ ...order, channel, outletName: row.name, restaurantCode: row.restaurant_code });
        });
      });
      if (row.received_at && (!lastUpdatedAt || new Date(row.received_at) > new Date(lastUpdatedAt))) lastUpdatedAt = row.received_at;
    });
    const running = orders.filter((order) => !/PENDING|PREPAR|WAITING|READY|OUT_FOR_DELIVERY/i.test(String(order.status || '')));
    const pending = orders.filter((order) => /PENDING|PREPAR|WAITING|READY|OUT_FOR_DELIVERY/i.test(String(order.status || '')));
    const tables = [];
    const tableKeys = new Set();
    orders.filter((order) => order.channel === 'dineIn' && order.table).forEach((order) => {
      const key = `${order.restaurantCode}:${order.table}`;
      if (tableKeys.has(key)) return;
      tableKeys.add(key);
      const tableOrders = orders.filter((candidate) => candidate.restaurantCode === order.restaurantCode && candidate.channel === 'dineIn' && candidate.table === order.table);
      tables.push({ outletName: order.outletName, restaurantCode: order.restaurantCode, table: order.table, orders: tableOrders.length, amount: tableOrders.reduce((sum, item) => sum + Number(item.total || 0), 0) });
    });
    res.json({ success: true, restaurantId: requestedRestaurant, running, pending, tables, lastUpdatedAt });
  } catch (err) {
    console.error('OWNER LIVE ORDERS ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/dashboard/online-orders', authenticateOwner, async (req, res) => {
  const restaurantId = String(req.query.restaurantId || 'ALL').trim();
  const source = String(req.query.source || 'ALL').trim().toUpperCase();
  const status = String(req.query.status || 'ALL').trim().toUpperCase();
  const orderNo = String(req.query.orderNo || '').trim().slice(0, 80);
  const allowedHours = new Set([24, 120, 168, 720]);
  const hours = allowedHours.has(Number(req.query.hours)) ? Number(req.query.hours) : 120;
  const allowedStatuses = new Set(['ALL', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'REJECTED', 'CANCELLED']);
  if (!allowedStatuses.has(status) || !['ALL', 'HOME_WEBSITE', 'FOODPANDA'].includes(source)) {
    return res.status(400).json({ success: false, message: 'Invalid online-order filter' });
  }
  try {
    const result = await pool.query(`
      SELECT o.id, o.order_no, o.order_type, o.customer_name, o.customer_phone,
             o.customer_email, o.delivery_address, o.payment_mode, o.payment_status,
             o.order_status, o.subtotal, o.discount_amount, o.delivery_fee,
             o.tax_amount, o.total_amount, o.notes, o.pos_pulled_at, o.pos_order_id,
             o.created_at, o.updated_at, t.name AS outlet_name, t.restaurant_code,
             'HOME_WEBSITE'::text AS source
      FROM online_orders o
      JOIN restaurant_owners ro ON ro.tenant_id = o.tenant_id AND ro.active = true
      JOIN tenants t ON t.id = o.tenant_id
      WHERE ro.owner_user_id = $1
        AND ($2 = 'ALL' OR t.restaurant_code = $2)
        AND o.created_at >= NOW() - ($3::text || ' hours')::interval
        AND ($4 = 'ALL' OR o.order_status = $4)
        AND ($5 = '' OR o.order_no ILIKE '%' || $5 || '%')
        AND ($6 IN ('ALL', 'HOME_WEBSITE'))
      ORDER BY o.created_at DESC
      LIMIT 250
    `, [req.owner.id, restaurantId, hours, status, orderNo, source]);
    const totals = result.rows.reduce((sum, order) => ({ orders: sum.orders + 1, amount: sum.amount + Number(order.total_amount || 0) }), { orders: 0, amount: 0 });
    res.json({ success: true, filters: { restaurantId, source, status, orderNo, hours }, totals, orders: result.rows });
  } catch (err) {
    console.error('OWNER ONLINE ORDERS ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/dashboard/reports', authenticateOwner, async (req, res) => {
  const reportType = String(req.query.type || 'day-wise').trim().toLowerCase();
  const restaurantId = String(req.query.restaurantId || 'ALL').trim();
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fromDate || '')) ? String(req.query.fromDate) : today;
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.toDate || '')) ? String(req.query.toDate) : fromDate;
  if (!['day-wise', 'sales', 'item-wise', 'online', 'discount'].includes(reportType)) {
    return res.status(400).json({ success: false, message: 'Unsupported report type' });
  }
  try {
    let result;
    if (reportType === 'item-wise') {
      result = await pool.query(`SELECT t.name AS outlet, i.item_name AS item,
        SUM(i.quantity_sold)::numeric AS quantity, SUM(i.total_sales)::numeric AS sales
        FROM tenant_item_sales i JOIN tenants t ON t.id = i.tenant_id
        JOIN restaurant_owners ro ON ro.tenant_id = t.id AND ro.active = true
        WHERE ro.owner_user_id = $1 AND ($2 = 'ALL' OR t.restaurant_code = $2)
          AND i.report_date BETWEEN $3::date AND $4::date
        GROUP BY t.id, i.item_name ORDER BY t.name, sales DESC`, [req.owner.id, restaurantId, fromDate, toDate]);
    } else if (reportType === 'online') {
      result = await pool.query(`SELECT t.name AS outlet, o.order_no, o.order_type, o.customer_name,
        o.order_status, o.payment_mode, o.total_amount AS total, o.created_at
        FROM online_orders o JOIN tenants t ON t.id = o.tenant_id
        JOIN restaurant_owners ro ON ro.tenant_id = t.id AND ro.active = true
        WHERE ro.owner_user_id = $1 AND ($2 = 'ALL' OR t.restaurant_code = $2)
          AND o.created_at::date BETWEEN $3::date AND $4::date
        ORDER BY o.created_at DESC LIMIT 1000`, [req.owner.id, restaurantId, fromDate, toDate]);
    } else if (reportType === 'sales') {
      result = await pool.query(`SELECT t.name AS outlet,
        SUM(r.orders_count)::numeric AS orders, SUM(r.gross_sales)::numeric AS gross_sales,
        SUM(r.discount_amount)::numeric AS discount, SUM(r.tax_amount)::numeric AS tax,
        SUM(r.net_sales)::numeric AS net_sales
        FROM tenant_daily_reports r JOIN tenants t ON t.id = r.tenant_id
        JOIN restaurant_owners ro ON ro.tenant_id = t.id AND ro.active = true
        WHERE ro.owner_user_id = $1 AND ($2 = 'ALL' OR t.restaurant_code = $2)
          AND r.report_date BETWEEN $3::date AND $4::date
        GROUP BY t.id ORDER BY net_sales DESC`, [req.owner.id, restaurantId, fromDate, toDate]);
    } else {
      result = await pool.query(`SELECT t.name AS outlet, r.report_date AS date,
        r.orders_count AS orders, r.gross_sales, r.discount_amount AS discount,
        r.tax_amount AS tax, r.net_sales, r.refunds_amount AS refunds
        FROM tenant_daily_reports r JOIN tenants t ON t.id = r.tenant_id
        JOIN restaurant_owners ro ON ro.tenant_id = t.id AND ro.active = true
        WHERE ro.owner_user_id = $1 AND ($2 = 'ALL' OR t.restaurant_code = $2)
          AND r.report_date BETWEEN $3::date AND $4::date
          AND ($5 != 'discount' OR r.discount_amount != 0)
        ORDER BY r.report_date DESC, t.name`, [req.owner.id, restaurantId, fromDate, toDate, reportType]);
    }
    res.json({ success: true, reportType, restaurantId, fromDate, toDate, rows: result.rows });
  } catch (err) {
    console.error('OWNER MOBILE REPORT ERROR:', err.message);
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
