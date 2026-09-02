const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('.js'))
  .sort();
const failed = [];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(root, 'tests', test)], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.status === 0) {
    console.log(`PASS ${test}`);
  } else {
    failed.push(test);
    console.error(`FAIL ${test}`);
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }
}

console.log(`Complete regression: ${tests.length - failed.length}/${tests.length} passed.`);
if (failed.length) {
  console.error(`Failed: ${failed.join(', ')}`);
  process.exit(1);
}
