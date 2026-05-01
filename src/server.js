const app = require('./app');
const config = require('./config/env');
const { initializeDatabase } = require('./db/init');
const { pool } = require('./db/pool');

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    await pool.end();
    process.exit(1);
  }
}

startServer();
