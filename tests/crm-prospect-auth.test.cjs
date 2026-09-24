const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map(marker => html.indexOf(marker)).find(index => index >= 0);
  assert.notEqual(start, undefined, `${name} tidak ditemukan`);
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < html.length; index += 1) {
    const character = html[index];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${name} tidak lengkap`);
}

const filterContext = vm.createContext({});
new vm.Script([
  extractFunction('statusProspekKanonis_'),
  extractFunction('normalisasiNilaiFilterProspek_'),
  extractFunction('daftarSalesProspek_'),
  extractFunction('prospekSesuaiFilter_')
].join('\n')).runInContext(filterContext);

const prospect = {
  'ID Prospek': 'PRP-001',
  'Nama Calon Customer': 'Toko Amanah',
  'No WA': '6281234567890',
  'Kebutuhan': 'CCTV',
  'Status Prospek': 'Tahap Penawaran',
  'Sales Penanggung Jawab': 'Abu Abdillah, Bintang'
};

test('prospect filters match an exact sales member and exact status', () => {
  assert.equal(filterContext.prospekSesuaiFilter_(prospect, 'amanah', 'bintang', 'tahap penawaran'), true);
  assert.equal(filterContext.prospekSesuaiFilter_(prospect, '', 'intang', 'tahap penawaran'), false);
  assert.equal(filterContext.prospekSesuaiFilter_(prospect, '', 'bintang', 'penawaran'), false);
});

test('legacy prospect statuses collapse into their canonical filter values', () => {
  assert.equal(filterContext.statusProspekKanonis_('Closing'), 'Closing / Deal');
  assert.equal(filterContext.statusProspekKanonis_('closing/deal'), 'Closing / Deal');
  assert.equal(filterContext.statusProspekKanonis_('Proses Servis'), 'On Progress');
  assert.equal(filterContext.statusProspekKanonis_('Proses Service'), 'On Progress');
  assert.equal(filterContext.prospekSesuaiFilter_({ ...prospect, 'Status Prospek': 'Closing' }, '', '', 'Closing / Deal'), true);
  assert.equal(filterContext.prospekSesuaiFilter_({ ...prospect, 'Status Prospek': 'Proses Servis' }, '', '', 'On Progress'), true);
});

test('prospect sales and status controls are unique', () => {
  for (const id of ['filter-sales-prospek', 'filter-status-prospek', 'prospek-filter-section']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
});

test('new profiles persist the Auth UID returned before the profile insert', () => {
  const source = extractFunction('simpanUserBaru');
  const authCall = source.indexOf('kelolaAkunAuthOlehAdmin_(usernameTargetBaru, inputPw, true)');
  const authIdPayload = source.indexOf('payload.auth_id = authIdBaru');
  const profileInsert = source.indexOf("callSupabase('users', 'POST', payload)");
  assert.ok(authCall >= 0 && authIdPayload > authCall && profileInsert > authIdPayload);
  assert.match(html, /reconcileSupabaseAuthProfiles/);
});

test('all inline scripts remain valid JavaScript', () => {
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (script.trim()) assert.doesNotThrow(() => new vm.Script(script));
  }
});
