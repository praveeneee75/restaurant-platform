const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
router.use(authenticate);

const CHANNELS = new Set(['SMS', 'WHATSAPP', 'EMAIL']);
const AUDIENCES = new Set(['ALL_CUSTOMERS', 'ONLINE_CUSTOMERS', 'NEW_LEADS', 'INACTIVE_CUSTOMERS']);
const PROVIDERS = new Set(['SMPP', 'MSG91', 'TWILIO', 'GUPSHUP', 'AWS_SES', 'SENDGRID', 'CUSTOM_HTTP']);

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

async function tenantForRestaurant(restaurantId) {
  const result = await pool.query('SELECT * FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  return result.rows[0] || null;
}

async function messagingEnabled(tenantId) {
  const result = await pool.query(`
    SELECT true AS enabled
    FROM tenant_modules tm
    JOIN modules m ON m.id = tm.module_id
    WHERE tm.tenant_id = $1 AND tm.enabled = true AND m.status = 'ACTIVE' AND m.code = 'MESSAGING'
    LIMIT 1
  `, [tenantId]);
  return result.rowCount > 0;
}

async function estimateRecipients(tenantId, channel, audience) {
  const field = channel === 'EMAIL' ? 'customer_email' : 'customer_phone';
  const baseWhere = [`tenant_id = $1`, `${field} IS NOT NULL`, `BTRIM(${field}) <> ''`];
  if (audience === 'NEW_LEADS') baseWhere.push(`created_at >= NOW() - INTERVAL '30 days'`);
  if (audience === 'INACTIVE_CUSTOMERS') baseWhere.push(`created_at < NOW() - INTERVAL '60 days'`);
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT DISTINCT ${field}
      FROM online_orders
      WHERE ${baseWhere.join(' AND ')}
    ) contacts
  `, [tenantId]);
  return result.rows[0]?.count || 0;
}

async function requireMessaging(tenantId) {
  if (!await messagingEnabled(tenantId)) {
    const err = new Error('Messaging module is not enabled for this restaurant. Add it to the plan or enable it as an add-on.');
    err.status = 403;
    throw err;
  }
}

router.get('/providers', async (_req, res) => {
  res.json({
    success: true,
    providers: [
      { code: 'SMPP', name: 'Direct SMPP account', bestFor: 'Indian DLT sender IDs and per-restaurant telecom accounts' },
      { code: 'MSG91', name: 'MSG91', bestFor: 'India SMS, WhatsApp, OTP and DLT templates' },
      { code: 'GUPSHUP', name: 'Gupshup', bestFor: 'WhatsApp Business and India conversational messaging' },
      { code: 'TWILIO', name: 'Twilio', bestFor: 'Global SMS and WhatsApp where sender rules allow it' },
      { code: 'AWS_SES', name: 'Amazon SES', bestFor: 'Low-cost transactional and bulk email' },
      { code: 'SENDGRID', name: 'SendGrid', bestFor: 'Marketing email templates and analytics' },
      { code: 'CUSTOM_HTTP', name: 'Custom HTTP API', bestFor: 'Any Indian aggregator with REST API credentials' }
    ]
  });
});

router.get('/account', async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    const enabled = await messagingEnabled(tenant.id);
    const account = await pool.query(`
      SELECT provider, provider_account_name, sender_id, sms_enabled, whatsapp_enabled, email_enabled,
             smpp_host, smpp_port, smpp_system_id,
             CASE WHEN smpp_password IS NULL OR smpp_password = '' THEN false ELSE true END AS has_smpp_password,
             api_base_url,
             CASE WHEN api_key IS NULL OR api_key = '' THEN false ELSE true END AS has_api_key,
             whatsapp_business_id, email_from_name, email_from_address, status, notes, updated_at
      FROM tenant_messaging_accounts
      WHERE tenant_id = $1
    `, [tenant.id]);
    const campaignResult = await pool.query(`
      SELECT id, channel, audience, campaign_name, status, recipients_estimate, scheduled_at, created_at
      FROM messaging_campaigns
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [tenant.id]);
    res.json({ success: true, enabled, account: account.rows[0] || null, campaigns: campaignResult.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/account', async (req, res) => {
  const {
    restaurantId,
    provider,
    providerAccountName,
    senderId,
    smsEnabled,
    whatsappEnabled,
    emailEnabled,
    smppHost,
    smppPort,
    smppSystemId,
    smppPassword,
    apiBaseUrl,
    apiKey,
    whatsappBusinessId,
    emailFromName,
    emailFromAddress,
    status,
    notes
  } = req.body || {};
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const selectedProvider = clean(provider || 'SMPP', 40).toUpperCase();
  if (!PROVIDERS.has(selectedProvider)) return res.status(400).json({ success: false, message: 'Unsupported messaging provider' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    await requireMessaging(tenant.id);
    const existing = await pool.query('SELECT * FROM tenant_messaging_accounts WHERE tenant_id = $1', [tenant.id]);
    const result = await pool.query(`
      INSERT INTO tenant_messaging_accounts (
        tenant_id, provider, provider_account_name, sender_id, sms_enabled, whatsapp_enabled, email_enabled,
        smpp_host, smpp_port, smpp_system_id, smpp_password, api_base_url, api_key, whatsapp_business_id,
        email_from_name, email_from_address, status, notes, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT(tenant_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        provider_account_name = EXCLUDED.provider_account_name,
        sender_id = EXCLUDED.sender_id,
        sms_enabled = EXCLUDED.sms_enabled,
        whatsapp_enabled = EXCLUDED.whatsapp_enabled,
        email_enabled = EXCLUDED.email_enabled,
        smpp_host = EXCLUDED.smpp_host,
        smpp_port = EXCLUDED.smpp_port,
        smpp_system_id = EXCLUDED.smpp_system_id,
        smpp_password = COALESCE(NULLIF(EXCLUDED.smpp_password, ''), tenant_messaging_accounts.smpp_password),
        api_base_url = EXCLUDED.api_base_url,
        api_key = COALESCE(NULLIF(EXCLUDED.api_key, ''), tenant_messaging_accounts.api_key),
        whatsapp_business_id = EXCLUDED.whatsapp_business_id,
        email_from_name = EXCLUDED.email_from_name,
        email_from_address = EXCLUDED.email_from_address,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING id, provider, sender_id, status
    `, [
      tenant.id,
      selectedProvider,
      clean(providerAccountName, 160) || null,
      clean(senderId, 80) || null,
      smsEnabled !== false,
      whatsappEnabled === true,
      emailEnabled === true,
      clean(smppHost, 160) || null,
      smppPort ? Number(smppPort) : null,
      clean(smppSystemId, 120) || null,
      clean(smppPassword, 240) || null,
      clean(apiBaseUrl, 240) || null,
      clean(apiKey, 400) || null,
      clean(whatsappBusinessId, 160) || null,
      clean(emailFromName, 160) || null,
      clean(emailFromAddress, 180) || null,
      ['ACTIVE', 'DRAFT', 'DISABLED'].includes(clean(status, 20).toUpperCase()) ? clean(status, 20).toUpperCase() : 'DRAFT',
      clean(notes, 500) || null
    ]);
    await pool.query(`
      INSERT INTO saas_audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value)
      VALUES ($1, $2, 'UPSERT_MESSAGING_ACCOUNT', 'TENANT', $3, $4, $5)
    `, [
      req.user?.id || null,
      req.user?.role || null,
      tenant.id,
      existing.rows[0] ? JSON.stringify({ provider: existing.rows[0].provider, sender_id: existing.rows[0].sender_id, status: existing.rows[0].status }) : null,
      JSON.stringify(result.rows[0])
    ]).catch(() => {});
    res.json({ success: true, message: 'Messaging account saved', account: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

router.post('/campaigns', async (req, res) => {
  const { restaurantId, channel, audience, campaignName, messageBody, scheduledAt } = req.body || {};
  if (!restaurantId || !channel || !campaignName || !messageBody) {
    return res.status(400).json({ success: false, message: 'Restaurant, channel, campaign name and message are required' });
  }
  const selectedChannel = clean(channel, 20).toUpperCase();
  const selectedAudience = clean(audience || 'ALL_CUSTOMERS', 40).toUpperCase();
  if (!CHANNELS.has(selectedChannel)) return res.status(400).json({ success: false, message: 'Unsupported channel' });
  if (!AUDIENCES.has(selectedAudience)) return res.status(400).json({ success: false, message: 'Unsupported audience' });
  try {
    const tenant = await tenantForRestaurant(restaurantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    await requireMessaging(tenant.id);
    const account = await pool.query('SELECT * FROM tenant_messaging_accounts WHERE tenant_id = $1 AND status = $2', [tenant.id, 'ACTIVE']);
    if (account.rowCount === 0) return res.status(400).json({ success: false, message: 'Activate messaging gateway before creating campaigns' });
    const allowed = (selectedChannel === 'SMS' && account.rows[0].sms_enabled)
      || (selectedChannel === 'WHATSAPP' && account.rows[0].whatsapp_enabled)
      || (selectedChannel === 'EMAIL' && account.rows[0].email_enabled);
    if (!allowed) return res.status(400).json({ success: false, message: `${selectedChannel} is not enabled for this restaurant` });
    const estimate = await estimateRecipients(tenant.id, selectedChannel, selectedAudience);
    const status = scheduledAt ? 'SCHEDULED' : 'DRAFT';
    const result = await pool.query(`
      INSERT INTO messaging_campaigns (tenant_id, channel, audience, campaign_name, message_body, status, recipients_estimate, scheduled_at, created_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      RETURNING id, channel, audience, campaign_name, status, recipients_estimate, scheduled_at, created_at
    `, [
      tenant.id,
      selectedChannel,
      selectedAudience,
      clean(campaignName, 160),
      clean(messageBody, 1600),
      status,
      estimate,
      scheduledAt || null,
      req.user?.id || null
    ]);
    res.json({ success: true, message: `${status === 'SCHEDULED' ? 'Campaign scheduled' : 'Campaign saved as draft'} for ${estimate} estimated recipient(s).`, campaign: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : publicError(err) });
  }
});

module.exports = router;
