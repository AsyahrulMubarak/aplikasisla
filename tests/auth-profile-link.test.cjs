const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const uidBintang = 'ba61aa84-61f6-49de-a2e5-e95a771adf63';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} tidak ditemukan`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} tidak lengkap`);
}

for (const backend of ['code.js', 'coderaha.js.txt']) {
  test(`${backend}: profil Bintang mendapat UID Auth dan hasilnya diverifikasi`, () => {
    const source = fs.readFileSync(path.join(root, backend), 'utf8');
    const profile = { username: 'bintang', username_login: 'bintang', auth_id: null };
    const calls = [];
    const context = vm.createContext({
      encodeURIComponent,
      callSupabaseServiceRole_(endpoint, method = 'get', payload) {
        calls.push({ endpoint, method, payload });
        if (method === 'patch') profile.auth_id = payload.auth_id;
        return [structuredClone(profile)];
      }
    });
    new vm.Script(extractFunction(source, 'tautkanProfilSupabaseAuth_')).runInContext(context);

    assert.equal(context.tautkanProfilSupabaseAuth_(' BINTANG ', uidBintang, true), true);
    assert.equal(profile.auth_id, uidBintang);
    assert.ok(calls.some(call => call.method === 'patch' && call.endpoint.includes('username_login=eq.bintang')));
    assert.equal(calls.at(-1).method, 'get');
  });
}

test('frontend menyerahkan pembuatan Auth dan profil kepada satu layanan Supabase', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const functionSource = extractFunction(html, 'simpanUserBaru');
  assert.match(functionSource, /kirimProfilSupabase_\(modeEditUser \? 'ubahProfil' : 'buatProfil'/);
  assert.doesNotMatch(functionSource, /payload\.auth_id|callSupabase\(|kelolaAkunAuthOlehAdmin_/);
  assert.match(html, /reconcileSupabaseAuthProfiles/);
});

