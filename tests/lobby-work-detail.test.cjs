const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const roster = fs.readFileSync(__dirname + '/../status-pegawai.js', 'utf8');
function extract(name) {
    const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
    assert.ok(match, name);
    return match[0];
}
function harness({ role = 'admin', access = 'Kendari', branch = 'Kendari', request } = {}) {
    const nodes = new Map(), calls = [], warnings = [];
    const node = () => ({ textContent: '', innerHTML: '', value: '', hidden: true, open: false, dataset: {}, children: [], attributes: {}, listeners: {}, style: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(key, listener) { this.listeners[key] = listener; },
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; },
        showModal() { this.open = true; },
        close() { this.open = false; c.batalkanDetailPekerjaanLobby_(); }
    });
    const field = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
    const navigation = () => { throw new Error('Popup must keep the lobby open'); };
    const c = vm.createContext({ AbortController, console, encodeURIComponent,
        penggunaAktif: { Role: role, Hak_Akses_Cabang: access, SessionToken: 'fixture' }, API_URL_CABANG: { Kendari: 'fixture', Raha: 'fixture' },
        document: { getElementById: field, createElement: node }, punyaAksesLobby: () => true,
        showToast: (...args) => warnings.push(args), aktifkanCabangDanMuat: navigation, switchTab: navigation,
        callSupabase: async (...args) => { calls.push(args); return request ? request(...args) : [{ id_tiket: 'TKT-199', cabang: branch, jenis_pekerjaan: 'Servis printer\nGanti roller', klien_lokasi: 'Klien contoh', teknisi: 'Teknisi A', status: 'On Progress' }]; }
    });
    vm.runInContext('let permintaanDetailPekerjaanLobby_ = null;\n' + ['idAman_', 'normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang', 'batalkanDetailPekerjaanLobby_', 'bukaDetailPekerjaanLobby_'].map(extract).join('\n') + '\n' + roster, c);
    field('lobby-cabang').value = branch;
    return { c, field, calls, warnings, node };
}

test('ticket click opens the job description popup without switching page or branch', async () => {
    const { c, field, calls } = harness();
    await c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
    assert.equal(field('modal-detail-pekerjaan-lobby').open, true);
    assert.equal(field('work-detail-body').hidden, false);
    assert.equal(field('work-detail-reference').textContent, 'TKT-199 · Kendari');
    assert.equal(field('work-detail-description').textContent, 'Servis printer\nGanti roller');
    assert.equal(field('work-detail-client').textContent, 'Klien contoh');
    assert.equal(field('work-detail-status').textContent, '');
    assert.equal(field('work-detail-body').attributes['aria-busy'], 'false');
    assert.equal(calls.length, 1);
    const [endpoint, method, payload, options] = calls[0], query = new URL('https://fixture/' + endpoint).searchParams;
    assert.equal(query.get('id_tiket'), 'eq.TKT-199');
    assert.equal(query.get('or'), '(cabang.eq.Kendari,cabang.is.null)');
    assert.equal(query.get('select'), 'id_tiket,klien_lokasi,jenis_pekerjaan,teknisi,status,cabang');
    assert.equal(method, 'GET'); assert.equal(payload, null); assert.equal(options.dariLobby, true);
});

test('Raha details stay scoped to Raha; staff and out-of-scope clicks never read ticket data', async () => {
    const h = harness({ role: 'admin_raha', access: 'Raha', branch: 'Raha' });
    await h.c.bukaDetailPekerjaanLobby_('TKT-199', 'Raha');
    assert.equal(new URL('https://fixture/' + h.calls[0][0]).searchParams.get('cabang'), 'eq.Raha');
    for (const role of ['teknisi', 'sales']) {
        const denied = harness({ role });
        await denied.c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
        assert.equal(denied.calls.length, 0); assert.equal(denied.field('modal-detail-pekerjaan-lobby').open, false);
    }
    const denied = harness();
    await denied.c.bukaDetailPekerjaanLobby_('TKR-199', 'Raha');
    assert.equal(denied.calls.length, 0); assert.equal(denied.warnings.length, 1);
});

test('missing, ambiguous or foreign-branch tickets show an error with no stale detail', async () => {
    for (const rows of [[], [{ id_tiket: 'TKT-199', cabang: 'Raha' }], [{ id_tiket: 'TKT-OTHER', cabang: 'Kendari' }], [{ id_tiket: 'TKT-199' }, { id_tiket: 'TKT-199' }]]) {
        const { c, field } = harness({ request: async () => rows });
        await c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
        assert.equal(field('work-detail-body').hidden, true);
        assert.match(field('work-detail-status').textContent, /Detail tiket belum tersedia/);
        assert.equal(field('modal-detail-pekerjaan-lobby').open, true);
    }
    const { c, field } = harness({ request: async () => { throw new Error('Tidak dapat terhubung'); } });
    await c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
    assert.equal(field('work-detail-body').hidden, true);
    assert.equal(field('work-detail-status').textContent, 'Tidak dapat terhubung');
});

test('closing a popup cancels its fetch and ignores the eventual result', async () => {
    let resolve;
    const { c, field, calls } = harness({ request: () => new Promise(done => { resolve = done; }) });
    const pending = c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
    assert.equal(field('modal-detail-pekerjaan-lobby').open, true);
    field('modal-detail-pekerjaan-lobby').close();
    assert.equal(calls[0][3].signal.aborted, true);
    resolve([{ id_tiket: 'TKT-199', cabang: 'Kendari', jenis_pekerjaan: 'Late result' }]);
    await pending;
    assert.equal(field('modal-detail-pekerjaan-lobby').open, false);
    assert.equal(field('work-detail-body').hidden, true);
    assert.equal(field('work-detail-description').textContent, '');
});

test('a newer ticket wins over a late response; HTML in descriptions stays plain text', async () => {
    const pending = [], { c, field, calls } = harness({ request: () => new Promise(resolve => pending.push(resolve)) });
    const first = c.bukaDetailPekerjaanLobby_('TKT-199', 'Kendari');
    const second = c.bukaDetailPekerjaanLobby_('TKT-201', 'Kendari');
    assert.equal(calls[0][3].signal.aborted, true);
    const description = '<img src=x onerror=alert(1)>\nDetail pekerjaan';
    pending[1]([{ id_tiket: 'TKT-201', cabang: 'Kendari', jenis_pekerjaan: description }]); await second;
    pending[0]([{ id_tiket: 'TKT-199', cabang: 'Kendari', jenis_pekerjaan: 'Old result' }]); await first;
    assert.equal(field('work-detail-reference').textContent, 'TKT-201 · Kendari');
    assert.equal(field('work-detail-description').textContent, description);
    assert.equal(field('work-detail-description').innerHTML, '');
});

test('roster buttons announce job detail and preserve the ticket ID and branch for the callback', async () => {
    const { c, node } = harness(), target = node(), opened = [];
    c.renderStatusPegawai_(target, { cabang: 'Raha', data: [{ nama: 'Teknisi A', tiket: ['TKR-1'] }] }, true, async (...args) => opened.push(args));
    const button = target.children[1].children[0].children[1].children[1];
    assert.equal(button.attributes['aria-label'], 'Lihat deskripsi pekerjaan tiket TKR-1');
    await button.listeners.click();
    assert.deepEqual(Array.from(opened[0]), ['TKR-1', 'Raha']);
    assert.equal(button.disabled, false);
});
