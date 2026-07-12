require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');
const {
  ThermalPrinter,
  PrinterTypes
} = require('node-thermal-printer');

const DATA_DIR = process.env.POS_DATA_DIR || path.join(__dirname, '../../pos-app/data');
const HEALTH_PORT = Number(process.env.PRINT_AGENT_HEALTH_PORT || 3100);
const POLL_INTERVAL_MS = Number(process.env.PRINT_AGENT_POLL_INTERVAL_MS || 3000);
const state = {
  startedAt: new Date().toISOString(),
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  processedJobs: 0
};

function getRestaurantDbPath() {
  const files = fs.readdirSync(DATA_DIR);
  const dbFile = files.find(f => f.startsWith('restaurant_') && f.endsWith('.db'));

  if (!dbFile) {
    console.log('No restaurant DB found');
    return null;
  }

  return path.join(DATA_DIR, dbFile);
}

async function processPrintJobs() {
  state.lastRunAt = new Date().toISOString();
  const dbPath = getRestaurantDbPath();
  if (!dbPath) return;

  const db = new Database(dbPath);

  // Ensure table exists (self-heal)
  db.exec(`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      kitchen_id INTEGER,
      printer_id INTEGER,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const jobs = db.prepare(`
    SELECT * FROM print_jobs
    WHERE status = 'PENDING'
    ORDER BY created_at
  `).all();

  if (jobs.length === 0) {
    db.close();
    return;
  }

  console.log(`🖨 Found ${jobs.length} print jobs`);

  for (const job of jobs) {
    try {
      const payload = JSON.parse(job.payload);

      await printKOT(payload);

      db.prepare(`
        UPDATE print_jobs
        SET status = 'PRINTED',
            attempts = attempts + 1
        WHERE id = ?
      `).run(job.id);

      console.log(`✅ Printed job ${job.id}`);
      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
      state.processedJobs += 1;

    } catch (err) {
      console.error('❌ Print failed:', err.message);
      state.lastError = err.message;

      db.prepare(`
        UPDATE print_jobs
        SET status = 'FAILED',
            attempts = attempts + 1
        WHERE id = ?
      `).run(job.id);
    }
  }

  db.close();
}

async function printKOT(payload) {

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'tcp://192.168.68.72:9100',
    options: {
      timeout: 5000
    }
  });

  const isConnected = await printer.isPrinterConnected();

  if (!isConnected) {
    throw new Error('Printer not reachable');
  }

  printer.alignCenter();
  printer.bold(true);
  printer.println("KITCHEN ORDER TICKET");
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.println("Order: " + payload.orderId);
  printer.println("KOT: " + (payload.kotReference || `${payload.orderId}-${payload.suborderNo || 1}`));
  printer.println("Table: " + (payload.tableNumber || "PARCEL"));
  printer.drawLine();

  payload.items.forEach(item => {
    printer.println(`${item.quantity} x ${item.name}`);
  });

  printer.drawLine();
  printer.println(new Date().toLocaleString());

  printer.cut();

  await printer.execute();
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Not found' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      app: 'Print Agent',
      version: require('../package.json').version,
      dataDirectory: DATA_DIR,
      ...state,
      timestamp: new Date().toISOString()
    }));
  });

  server.listen(HEALTH_PORT, '127.0.0.1', () => {
    console.log(`🖨 Print Agent health at http://127.0.0.1:${HEALTH_PORT}/health`);
  });
  server.on('error', (err) => {
    console.warn(`Print Agent health endpoint skipped: ${err.message}`);
  });
}

console.log('🖨 Print Agent Started');
startHealthServer();
processPrintJobs();
setInterval(() => {
  processPrintJobs();
}, POLL_INTERVAL_MS);
