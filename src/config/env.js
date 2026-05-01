const dotenv = require('dotenv');

dotenv.config();

const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshTokenLength: Number(process.env.REFRESH_TOKEN_LENGTH || 48),
  },
};

module.exports = config;
