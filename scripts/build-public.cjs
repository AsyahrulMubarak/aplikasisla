// Only these browser assets are published. Backend source, tests and secrets
// are deliberately outside the static output directory.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const files = ['index.html', 'absen.html', 'slipgaji.html', 'sw.js', 'manifest.json', 'depan_001.png', 'pts.html', 'assets/pts-session.js'];
function verifyOutput(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const relative = path.relative(output, target).replace(/\\/g, '/');
    if (entry.isSymbolicLink() || !(entry.isDirectory()
      ? files.some(file => file.startsWith(relative + '/'))
      : files.includes(relative))) {
      throw new Error(`Unexpected public asset: ${relative}. Review the output directory before publishing.`);
    }
    if (entry.isDirectory()) verifyOutput(target);
  }
}
verifyOutput(output);
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`Prepared ${files.length} public assets.`);
