const pool = require('../db/db');
const authenticate = require('./authMiddleware');

function requireOwner(req, res, next) {
  authenticate(req, res, async () => {
    if (req.user?.type !== 'OWNER' || !req.user?.id) {
      return res.status(403).json({ success: false, message: 'Owner access required' });
    }
    const active = await pool.query('SELECT id FROM owner_users WHERE id = $1 AND active = true', [req.user.id]);
    if (!active.rowCount) return res.status(401).json({ success: false, message: 'Owner account is inactive' });
    next();
  });
}

async function tenantForOwner(ownerId, restaurantCode) {
  const result = await pool.query(`
    SELECT t.*
    FROM restaurant_owners ro
    JOIN tenants t ON t.id = ro.tenant_id
    WHERE ro.owner_user_id = $1 AND ro.active = true AND t.restaurant_code = $2
    LIMIT 1
  `, [ownerId, restaurantCode]);
  return result.rows[0] || null;
}

async function requireOwnedTenant(req, res, next) {
  const restaurantCode = String(req.query.restaurantId || req.body?.restaurantId || req.params.restaurantId || '').trim();
  if (!restaurantCode) return res.status(400).json({ success: false, message: 'restaurantId required' });
  const tenant = await tenantForOwner(req.user.id, restaurantCode);
  if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found for this owner' });
  req.tenant = tenant;
  next();
}

module.exports = { requireOwner, requireOwnedTenant, tenantForOwner };
