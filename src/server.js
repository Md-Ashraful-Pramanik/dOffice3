const http = require('http');
const app = require('./app');
const config = require('./config/env');
const { initializeDatabase } = require('./db/init');
const { pool } = require('./db/pool');
const { initializeWebSocketServer } = require('./realtime/websocket');

async function startServer() {
  try {
    await initializeDatabase();

    const server = http.createServer(app);
    initializeWebSocketServer(server);

    server.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    await pool.end();
    process.exit(1);
  }
}

startServer();
