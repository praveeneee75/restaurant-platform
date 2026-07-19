require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db/db');
const { config, requireProductionConfig, publicError } = require('./config');
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenants');

requireProductionConfig();

const app = express();
const healthCache = {
  checkedAt: 0,
  ttlMs: Number(process.env.SAAS_HEALTH_CACHE_MS || 5000),
  database: { status: 'UNKNOWN' },
  success: true
};

app.use((req, res, next) => {
  const startedAt = Date.now();
  const writeHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    if (!res.headersSent) res.setHeader('X-Response-Time-Ms', String(Date.now() - startedAt));
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs > Number(process.env.SAAS_SLOW_REQUEST_MS || 1000)) {
      console.warn(`Slow K'Master POS request ${req.method} ${req.originalUrl} ${durationMs}ms`);
    }
  });
  next();
});
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: config.nodeEnv === 'production' ? '1h' : 0,
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

const nativeMobileOrigins = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost'
]);
const configuredCorsOrigins = config.corsOrigin === '*'
  ? '*'
  : new Set(config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (configuredCorsOrigins === '*' || configuredCorsOrigins.has(origin) || nativeMobileOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: configuredCorsOrigins !== '*'
}));
app.use(express.json());

app.get('/health', async (req, res) => {
  const health = {
    success: true,
    app: "K'Master POS",
    environment: config.nodeEnv,
    database: { status: 'UNKNOWN' },
    timestamp: new Date().toISOString()
  };

  if (Date.now() - healthCache.checkedAt <= healthCache.ttlMs) {
    health.success = healthCache.success;
    health.database = healthCache.database;
  } else {
    try {
      await pool.query('SELECT 1');
      health.database.status = 'OK';
      healthCache.success = true;
      healthCache.database = { status: 'OK' };
    } catch (err) {
      health.success = false;
      health.database.status = 'ERROR';
      health.database.message = publicError(err);
      healthCache.success = false;
      healthCache.database = health.database;
      res.status(503);
    }
    healthCache.checkedAt = Date.now();
  }

  res.json(health);
});

app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: publicError(err) });
  }
});

app.get('/', (req, res) => {
  res.send("K'Master POS backend running");
});

app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);
app.use('/license', require('./routes/license'));
app.use('/updates', require('./routes/updates'));
app.use('/online-ordering', require('./routes/onlineOrdering'));
app.use('/sync', require('./routes/sync'));
app.use('/owner/reports', require('./routes/ownerReports'));
app.use('/owner-control', require('./routes/ownerControl'));
app.use('/owners', require('./routes/owners'));
app.use('/subscriptions', require('./routes/subscriptions'));
app.use('/monitoring', require('./routes/monitoring'));
app.use('/partners', require('./routes/partners'));
app.use('/modules', require('./routes/modules'));
app.use('/messaging', require('./routes/messaging'));
app.use('/mobile', require('./routes/mobile'));
app.use('/tenants', require('./routes/tenantModules'));
app.use('/organizations', require('./routes/organizations'));
app.use('/inquiries', require('./routes/inquiries'));

app.listen(config.port, () => {
  console.log(`K'Master POS backend running on port ${config.port}`);
  pool.query('SELECT 1')
    .then(() => {
      healthCache.checkedAt = Date.now();
      healthCache.success = true;
      healthCache.database = { status: 'OK' };
    })
    .catch((err) => {
      healthCache.checkedAt = Date.now();
      healthCache.success = false;
      healthCache.database = { status: 'ERROR', message: publicError(err) };
    });
});
