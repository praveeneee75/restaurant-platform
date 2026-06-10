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

app.use(express.static(path.join(__dirname, '../public')));
app.use(cors({
  origin: config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((origin) => origin.trim()),
  credentials: config.corsOrigin !== '*'
}));
app.use(express.json());

app.get('/health', async (req, res) => {
  const health = {
    success: true,
    app: 'SaaS Backend',
    environment: config.nodeEnv,
    database: { status: 'UNKNOWN' },
    timestamp: new Date().toISOString()
  };

  try {
    await pool.query('SELECT 1');
    health.database.status = 'OK';
  } catch (err) {
    health.success = false;
    health.database.status = 'ERROR';
    health.database.message = publicError(err);
    res.status(503);
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
  res.send('SaaS backend running');
});

app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);
app.use('/license', require('./routes/license'));
app.use('/updates', require('./routes/updates'));
app.use('/sync', require('./routes/sync'));
app.use('/owner/reports', require('./routes/ownerReports'));

app.listen(config.port, () => {
  console.log(`SaaS backend running on port ${config.port}`);
});
