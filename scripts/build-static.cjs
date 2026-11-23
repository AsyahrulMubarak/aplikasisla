'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const assets = [
    "absen.html",
    "achievement-score.css",
    "achievement-score.js",
    "depan_001.png",
    "employee-account.js",
    "fonts/Amiri-OFL.txt",
    "fonts/Amiri-Regular.ttf",
    "index.html",
    "installation-location.css",
    "installation-location.js",
    "invoice-followups.js",
    "invoice-reminder.js",
    "lobby-credit.css",
    "lobby-credit.js",
    "lobby-motion.js",
    "manifest.json",
    "performa.css",
    "performa.html",
    "performa.js",
    "revenue-realtime.js",
    "sales-workspace.css",
    "sales-workspace.js",
    "serial-device.css",
    "serial-device.js",
    "slipgaji.html",
    "status-pegawai.js",
    "sw.js",
    "theme.css",
    "theme.js",
    "ticket-admin-whatsapp.js",
    "ticket-assessment.css",
    "ticket-assessment.js",
    "ticket-workflow.css",
    "ticket-workflow.js",
    "workspace-media.js",
];

for (const asset of assets) {
    if (!fs.statSync(path.join(root, asset)).isFile()) {
        throw new Error(`Missing frontend asset: ${asset}`);
    }
}

fs.rmSync(output, { recursive: true, force: true });
for (const asset of assets) {
    const destination = path.join(output, asset);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, asset), destination);
}
console.log(`Prepared ${assets.length} frontend assets.`);
