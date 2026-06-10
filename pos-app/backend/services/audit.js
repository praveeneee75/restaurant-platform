const SENSITIVE_KEYS = new Set([
  'pin',
  'pin_hash',
  'password',
  'password_hash',
  'license_key',
  'token',
  'jwt',
  'secret'
]);

function maskValue(value) {
  if (Array.isArray(value)) return value.map(maskValue);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((masked, [key, entry]) => {
    masked[key] = SENSITIVE_KEYS.has(String(key).toLowerCase()) ? '[MASKED]' : maskValue(entry);
    return masked;
  }, {});
}

function stringify(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(maskValue(value));
}

function logAudit(db, data) {
  db.prepare(`
    INSERT INTO audit_logs (
      restaurant_id, user_id, user_role, actor_user_id, actor_role,
      action, entity_type, entity_id, old_value, new_value, performed_by, details, ip_address
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.restaurantId || null,
    data.userId || data.actor?.id || data.actor?.userId || null,
    data.userRole || data.actor?.role || null,
    data.userId || data.actor?.id || data.actor?.userId || null,
    data.userRole || data.actor?.role || null,
    data.action,
    data.entityType,
    data.entityId || null,
    stringify(data.oldValue),
    stringify(data.newValue),
    data.performedBy || data.actor?.username || data.actor?.name || data.actor?.role || null,
    stringify(data.details ?? data.newValue),
    data.ipAddress || null
  );
}

function logComplianceEvent(db, data) {
  db.prepare(`
    INSERT INTO compliance_events (event_type, severity, message, entity_type, entity_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    data.eventType,
    data.severity || 'INFO',
    data.message || '',
    data.entityType || null,
    data.entityId || null
  );
}

module.exports = { logAudit, logComplianceEvent, maskValue };
