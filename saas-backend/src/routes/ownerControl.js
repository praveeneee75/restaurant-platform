const express = require('express');
const crypto = require('crypto');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { requireOwner, requireOwnedTenant } = require('../middleware/ownerScope');
const { publicError } = require('../config');

const router = express.Router();
const DOMAINS = new Set(['MENU', 'BILLING', 'BACKUP', 'ONLINE_ORDERING']);
const COMMANDS = new Set(['REQUEST_SYNC', 'REFRESH_LICENSE', 'RUN_BACKUP', 'PUBLISH_MENU']);
const DOMAIN_CAPABILITY = { MENU: 'REMOTE_MENU', BILLING: 'REMOTE_BILLING', BACKUP: 'REMOTE_BACKUP', ONLINE_ORDERING: 'REMOTE_ONLINE_ORDERING' };

function json(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function validateDomain(domain, payload) {
  if (!DOMAINS.has(domain)) throw new Error('Unsupported remote configuration domain');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Configuration must be an object');
  const encoded = JSON.stringify(payload);
  if (encoded.length > 2_000_000) throw new Error('Configuration payload is too large');
  if (domain === 'BACKUP') {
    delete payload.restorePath;
    delete payload.restore_action;
    if (payload.backup_interval_minutes != null) {
      const minutes = Number(payload.backup_interval_minutes);
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10080) throw new Error('Backup interval must be between 5 and 10080 minutes');
    }
  }
  return payload;
}

async function queueCommand(db, tenant, type, payload, ownerId) {
  const result = await db.query(`
    INSERT INTO tenant_remote_commands
      (tenant_id, restaurant_code, command_type, payload, status, requested_by, expires_at)
    VALUES ($1, $2, $3, $4::jsonb, 'PENDING', $5, NOW() + INTERVAL '24 hours')
    RETURNING *
  `, [tenant.id, tenant.restaurant_code, type, JSON.stringify(payload || {}), ownerId || null]);
  return result.rows[0];
}

async function capabilityEnabled(tenantId, code) {
  const result = await pool.query('SELECT 1 FROM tenant_owner_capabilities WHERE tenant_id = $1 AND capability_code = $2 AND enabled = true', [tenantId, code]);
  return result.rowCount > 0;
}

router.get('/admin/capabilities', authenticate, async (req, res) => {
  const restaurantId = String(req.query.restaurantId || '').trim();
  const tenant = await pool.query('SELECT id, restaurant_code, name FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  if (!tenant.rowCount) return res.status(404).json({ success: false, message: 'Restaurant not found' });
  const rows = await pool.query('SELECT capability_code, enabled, updated_at FROM tenant_owner_capabilities WHERE tenant_id = $1 ORDER BY capability_code', [tenant.rows[0].id]);
  res.json({ success: true, restaurant: tenant.rows[0], capabilities: rows.rows });
});

router.put('/admin/capabilities', authenticate, async (req, res) => {
  const restaurantId = String(req.body?.restaurantId || '').trim();
  const capabilities = req.body?.capabilities;
  if (!restaurantId || !capabilities || typeof capabilities !== 'object') return res.status(400).json({ success: false, message: 'Restaurant and capabilities required' });
  const tenant = await pool.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  if (!tenant.rowCount) return res.status(404).json({ success: false, message: 'Restaurant not found' });
  for (const [code, enabled] of Object.entries(capabilities)) {
    await pool.query(`INSERT INTO tenant_owner_capabilities (tenant_id, capability_code, enabled, updated_at)
      VALUES ($1, $2, $3, NOW()) ON CONFLICT(tenant_id, capability_code) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [tenant.rows[0].id, String(code).toUpperCase(), Boolean(enabled)]);
  }
  res.json({ success: true, message: 'Owner capability policy updated; POS receives it on license validation' });
});

router.post('/admin/change-approval', authenticate, async (req, res) => {
  const restaurantId = String(req.body?.restaurantId || '').trim();
  const tenant = await pool.query('SELECT id FROM tenants WHERE restaurant_code = $1', [restaurantId]);
  if (!tenant.rowCount) return res.status(404).json({ success: false, message: 'Restaurant not found' });
  const result = await pool.query(`INSERT INTO tenant_change_approvals
    (tenant_id, change_type, summary, payload, requested_by) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
  [tenant.rows[0].id, String(req.body?.changeType || 'LICENSE_PROFILE').toUpperCase(), String(req.body?.summary || 'License-sensitive settings changed'), JSON.stringify(req.body?.payload || {}), req.user?.id || null]);
  res.json({ success: true, approval: result.rows[0], message: 'Owner confirmation requested' });
});

router.use('/owner', requireOwner, requireOwnedTenant);

router.get('/owner/dashboard', async (req, res) => {
  try {
    const [snapshot, heartbeat, alerts, commands, reports, items, capabilities, approvals] = await Promise.all([
      pool.query('SELECT * FROM tenant_operational_snapshots WHERE tenant_id = $1', [req.tenant.id]),
      pool.query('SELECT * FROM pos_heartbeats WHERE tenant_id = $1', [req.tenant.id]),
      pool.query("SELECT * FROM tenant_owner_alerts WHERE tenant_id = $1 AND status != 'RESOLVED' ORDER BY created_at DESC LIMIT 50", [req.tenant.id]),
      pool.query('SELECT id, command_type, status, message, requested_at, acknowledged_at FROM tenant_remote_commands WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT 30', [req.tenant.id]),
      pool.query('SELECT * FROM tenant_daily_reports WHERE tenant_id = $1 ORDER BY report_date DESC LIMIT 90', [req.tenant.id]),
      pool.query('SELECT item_name, SUM(quantity_sold) quantity_sold, SUM(total_sales) total_sales FROM tenant_item_sales WHERE tenant_id = $1 AND report_date >= CURRENT_DATE - 30 GROUP BY item_name ORDER BY total_sales DESC LIMIT 25', [req.tenant.id]),
      pool.query('SELECT capability_code FROM tenant_owner_capabilities WHERE tenant_id = $1 AND enabled = true ORDER BY capability_code', [req.tenant.id]),
      pool.query("SELECT id, change_type, summary, payload, status, requested_at, expires_at FROM tenant_change_approvals WHERE tenant_id = $1 AND status = 'AWAITING_OWNER' AND expires_at > NOW() ORDER BY requested_at DESC", [req.tenant.id])
    ]);
    const snap = snapshot.rows[0] || {};
    res.json({
      success: true,
      restaurant: { id: req.tenant.id, code: req.tenant.restaurant_code, name: req.tenant.name },
      freshness: { lastSnapshotAt: snap.received_at || null, lastHeartbeatAt: heartbeat.rows[0]?.last_heartbeat_at || null },
      liveOperations: json(snap.live_operations, { dineIn: [], parcel: [], party: [], online: [] }),
      executiveSales: json(snap.executive_sales, {}),
      refunds: json(snap.refund_summary, {}),
      promocodes: json(snap.promocode_summary, {}),
      configurationSnapshot: json(snap.configuration_snapshot, {}),
      dailyReports: reports.rows,
      topItems: items.rows,
      health: heartbeat.rows[0] || null,
      alerts: alerts.rows,
      commands: commands.rows
      ,capabilities: capabilities.rows.map((row) => row.capability_code)
      ,pendingApprovals: approvals.rows
    });
  } catch (err) {
    console.error('OWNER CONTROL DASHBOARD ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/owner/approvals/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE tenant_change_approvals SET status = 'CONFIRMED', confirmed_by = $1, confirmed_at = NOW()
      WHERE id = $2 AND tenant_id = $3 AND status = 'AWAITING_OWNER' AND expires_at > NOW() RETURNING *`, [req.user.id, req.params.id, req.tenant.id]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Approval is unavailable or expired' }); }
    const command = await queueCommand(client, req.tenant, 'REFRESH_LICENSE', { approvalId: result.rows[0].id, requiresLocalReauthentication: true, summary: result.rows[0].summary }, req.user.id);
    await client.query('COMMIT');
    res.json({ success: true, approval: result.rows[0], command, message: 'Confirmed. POS will notify restaurant staff to reauthenticate the license.' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ success: false, message: publicError(err) }); }
  finally { client.release(); }
});

router.get('/owner/config', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT domain, version, payload, status, created_at, applied_at, apply_message
      FROM tenant_remote_configs WHERE tenant_id = $1
      ORDER BY domain, version DESC
    `, [req.tenant.id]);
    const latest = {};
    result.rows.forEach((row) => { if (!latest[row.domain]) latest[row.domain] = row; });
    res.json({ success: true, configurations: latest });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.put('/owner/config/:domain', async (req, res) => {
  const domain = String(req.params.domain || '').toUpperCase();
  try {
    if (!await capabilityEnabled(req.tenant.id, DOMAIN_CAPABILITY[domain])) return res.status(403).json({ success: false, message: 'This remote capability is not enabled for the owner' });
    const payload = validateDomain(domain, { ...(req.body?.payload || {}) });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionRow = await client.query('SELECT COALESCE(MAX(version), 0) + 1 version FROM tenant_remote_configs WHERE tenant_id = $1 AND domain = $2', [req.tenant.id, domain]);
      const version = Number(versionRow.rows[0].version);
      const result = await client.query(`
        INSERT INTO tenant_remote_configs (tenant_id, domain, version, payload, status, created_by)
        VALUES ($1, $2, $3, $4::jsonb, 'PENDING', $5)
        RETURNING *
      `, [req.tenant.id, domain, version, JSON.stringify(payload), req.user.id]);
      await queueCommand(client, req.tenant, 'APPLY_CONFIG', { domain, version }, req.user.id);
      await client.query('COMMIT');
      res.json({ success: true, configuration: result.rows[0], message: `Version ${version} queued for POS` });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/owner/commands', async (req, res) => {
  const type = String(req.body?.type || '').toUpperCase();
  if (!COMMANDS.has(type)) return res.status(400).json({ success: false, message: 'Unsupported command' });
  try {
    const needed = type === 'RUN_BACKUP' ? 'REMOTE_BACKUP' : type === 'PUBLISH_MENU' ? 'REMOTE_MENU' : 'REMOTE_COMMANDS';
    if (!await capabilityEnabled(req.tenant.id, needed)) return res.status(403).json({ success: false, message: 'This remote command is not enabled for the owner' });
    const command = await queueCommand(pool, req.tenant, type, req.body?.payload || {}, req.user.id);
    res.json({ success: true, command, message: 'Command queued for the restaurant POS' });
  } catch (err) { res.status(500).json({ success: false, message: publicError(err) }); }
});

async function posTenant(req) {
  const { restaurantId, licenseKey, syncToken } = req.body || {};
  const result = await pool.query(`
    SELECT t.* FROM tenants t JOIN licenses l ON l.tenant_id = t.id
    WHERE t.restaurant_code = $1
      AND (($2::text IS NOT NULL AND l.license_key = $2) OR ($3::text IS NOT NULL AND l.sync_token = $3))
      AND l.status = 'ACTIVE' AND l.expires_at > NOW() LIMIT 1
  `, [restaurantId, licenseKey || null, syncToken || null]);
  return result.rows[0] || null;
}

router.post('/pos/push-snapshot', async (req, res) => {
  try {
    const tenant = await posTenant(req);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid POS credentials' });
    const { liveOperations, executiveSales, refundSummary, promocodeSummary, configurationSnapshot } = req.body;
    await pool.query(`
      INSERT INTO tenant_operational_snapshots
        (tenant_id, live_operations, executive_sales, refund_summary, promocode_summary, configuration_snapshot, received_at)
      VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
      ON CONFLICT(tenant_id) DO UPDATE SET
        live_operations = EXCLUDED.live_operations, executive_sales = EXCLUDED.executive_sales,
        refund_summary = EXCLUDED.refund_summary, promocode_summary = EXCLUDED.promocode_summary,
        configuration_snapshot = EXCLUDED.configuration_snapshot, received_at = NOW()
    `, [tenant.id, JSON.stringify(liveOperations || {}), JSON.stringify(executiveSales || {}), JSON.stringify(refundSummary || {}), JSON.stringify(promocodeSummary || {}), JSON.stringify(configurationSnapshot || {})]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: publicError(err) }); }
});

router.post('/pos/pull', async (req, res) => {
  try {
    const tenant = await posTenant(req);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid POS credentials' });
    await pool.query("UPDATE tenant_remote_commands SET status = 'EXPIRED' WHERE tenant_id = $1 AND status = 'PENDING' AND expires_at <= NOW()", [tenant.id]);
    const commands = await pool.query(`
      SELECT id, command_type, payload, requested_at, expires_at
      FROM tenant_remote_commands WHERE tenant_id = $1 AND status = 'PENDING' AND expires_at > NOW()
      ORDER BY requested_at LIMIT 25
    `, [tenant.id]);
    const configs = await pool.query(`
      SELECT DISTINCT ON (domain) id, domain, version, payload
      FROM tenant_remote_configs WHERE tenant_id = $1 AND status IN ('PENDING','APPLYING')
      ORDER BY domain, version DESC
    `, [tenant.id]);
    res.json({ success: true, serverTime: new Date().toISOString(), commands: commands.rows, configurations: configs.rows });
  } catch (err) { res.status(500).json({ success: false, message: publicError(err) }); }
});

router.post('/pos/ack', async (req, res) => {
  try {
    const tenant = await posTenant(req);
    if (!tenant) return res.status(401).json({ success: false, message: 'Invalid POS credentials' });
    const status = req.body?.success ? 'APPLIED' : 'FAILED';
    if (req.body?.commandId) {
      await pool.query(`UPDATE tenant_remote_commands SET status = $1, message = $2, acknowledged_at = NOW() WHERE id = $3 AND tenant_id = $4`, [status, String(req.body.message || ''), req.body.commandId, tenant.id]);
    }
    if (req.body?.domain && req.body?.version) {
      await pool.query(`UPDATE tenant_remote_configs SET status = $1, apply_message = $2, applied_at = NOW() WHERE tenant_id = $3 AND domain = $4 AND version = $5`, [status, String(req.body.message || ''), tenant.id, String(req.body.domain).toUpperCase(), Number(req.body.version)]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: publicError(err) }); }
});

module.exports = router;
