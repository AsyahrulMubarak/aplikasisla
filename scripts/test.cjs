'use strict';

const { spawnSync } = require('node:child_process');
const { globSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = globSync('{tests,maintenance,aplikasi kpi/tests}/**/*.test.{cjs,mjs}', {
    cwd: root,
}).sort();

if (!files.length) {
    throw new Error('No active SLA test files found.');
}

process.env.TZ = 'Asia/Makassar';
console.log(`Running ${files.length} SLA test files.`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    cwd: root,
    stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
