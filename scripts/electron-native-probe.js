const path = require('node:path');
// Resolve from the repository POS directory, not the caller's current directory.
// This keeps the probe reliable when launched from a desktop shortcut or another shell.
const db = require(path.join(__dirname, '..', 'pos-app', 'node_modules', 'better-sqlite3'));
const probe = new db(':memory:');
probe.prepare('SELECT 1').get();
probe.close();
process.stdout.write(`${process.versions.modules}\n`);
process.exit(0);
