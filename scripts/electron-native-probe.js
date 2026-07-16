const path = require('node:path');
const db = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));
const probe = new db(':memory:');
probe.prepare('SELECT 1').get();
probe.close();
process.stdout.write(`${process.versions.modules}\n`);
process.exit(0);
