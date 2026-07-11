require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL || (process.env.NODE_ENV === 'production' ? 'true' : 'false')
  }
};

function requireProductionConfig() {
  if (config.nodeEnv !== 'production') return;
  const missing = [];
  if (!config.jwtSecret) missing.push('JWT_SECRET');
  if (!config.db.password) missing.push('DB_PASSWORD');
  if (!config.db.host) missing.push('DB_HOST');
  if (!config.db.user) missing.push('DB_USER');
  if (!config.db.database) missing.push('DB_NAME');
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  if (config.jwtSecret.length < 32 || /change_me|replace_with|example\.com/i.test(config.jwtSecret)) {
    throw new Error('JWT_SECRET must be a real production secret of at least 32 characters');
  }
  if (/change_me|replace_with|example\.com/i.test(config.db.password)) {
    throw new Error('DB_PASSWORD still contains a template value');
  }
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(`${config.db.host}\n${config.corsOrigin}`)) {
    throw new Error('Production configuration contains a localhost or loopback value');
  }
}

function publicError(err) {
  if (config.nodeEnv === 'production') return 'Server error';
  return err.message;
}

module.exports = { config, requireProductionConfig, publicError };
