const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
function extract(name) {
    const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
    assert.ok(match, name); return match[0];
}
function harness({ role = 'admin', branch = 'Semua', salary = 2000000, profileFailure = false,
    salaryFailure = false, committedTimeout = false, refreshFailure = false, profileWait = null, own = false, welcome = null } = {}) {
    const fields = new Map(), calls = [], notices = [], sessions = [];
    function field(id) {
        if (!fields.has(id)) {
            let value = '';
            fields.set(id, { get value() { return value; }, set value(v) { value = String(v); },
                style: {}, disabled: false, readOnly: false, required: false, hidden: true,
                classList: { add() {}, remove() {} } });
        }
        return fields.get(id);
    }
    const target = { Username: 'employee raha', 'Nama Asli': 'Pegawai Contoh', Email: 'example@example.test',
        'No WA': '6281234567890', Role: 'admin_raha', Hak_Akses_Cabang: 'Raha', 'Gaji Pokok': salary };
    const database = { salary };
    const actor = own ? { ...target, Role: role, Hak_Akses_Cabang: branch } : { Username: 'admin', Role: role, Hak_Akses_Cabang: branch };
    const c = vm.createContext({ console: { error() {} }, Number, penggunaAktif: actor, globalUsers: [target],
        modeEditUser: false, waktuLoginAktif: 1, document: { getElementById: field }, window: { scrollTo() {} },
        cariUserDariKunciProfil_: () => target,
        showToast: (message, kind) => notices.push({ message, kind }),
        simpanSesiAktif: () => sessions.push(JSON.parse(JSON.stringify(actor))),
        validasiPasswordBaru_: password => { if (password.length < 8) throw Error('Password terlalu pendek'); },
        angkaRupiahSupabase_: value => Number(value || 0),
        pastikanHasilMutasiSupabase_: rows => { assert.equal(rows.length, 1); },
        kirimProfilSupabase_: async (action, body) => {
            calls.push({ kind: 'profile', action, body: JSON.parse(JSON.stringify(body)) });
            if (profileWait) await profileWait;
            if (profileFailure) throw Error('Profil ditolak');
            if (action === 'ubahProfil' && body.profil.gaji_pokok !== database.salary) throw Error('Gaji pokok sudah berbeda. Muat ulang profil.');
            if (action === 'buatProfil') database.salary = body.profil.gaji_pokok;
            return { data: [{ ...body.profil, gaji_pokok: database.salary }], passwordDiubah: Boolean(body.passwordBaru),
                ...(action === 'buatProfil' && welcome ? { notifikasiSelamatDatang: welcome } : {}) };
        },
        apiGajiManajemen_: async body => {
            calls.push({ kind: 'salary', body: JSON.parse(JSON.stringify(body)) });
            if (salaryFailure) throw Error('Layanan gaji belum tersedia');
            if (body.gajiLama !== database.salary) throw Error('Gaji berubah. Muat ulang.');
            database.salary = body.gajiBaru;
            if (committedTimeout) throw Error('Respons terputus');
            return { status: 'sukses', notifikasiTertunda: 0 };
        },
        ambilSemuaData: async () => { if (refreshFailure) throw Error('Tidak dapat memuat data'); }
    });
    vm.runInContext('let gajiEditUser_ = null;\n' + ['normalisasiCabang', 'bolehKelolaGaji_', 'toggleTargetSales',
        'perbaruiAlasanGajiUser_', 'siapkanProfilPribadi', 'aktifkanEditUser', 'batalEditUser', 'simpanUserBaru'].map(extract).join('\n'), c);
    function edit(value = salary, reason = '') {
        c.aktifkanEditUser('employee_raha'); field('new-gapok').value = value; field('new-gapok-reason').value = reason;
        c.perbaruiAlasanGajiUser_();
    }
    const submit = () => c.simpanUserBaru({ preventDefault() {} });
    return { c, field, calls, notices, sessions, database, target, actor, edit, submit };
}

test('Admin Edit User accepts a salary change through the audited salary API with the original username', async () => {
    const h = harness(); h.edit(2250000, 'Evaluasi kinerja');
    assert.equal(h.field('new-gapok').readOnly, false);
    assert.equal(h.field('new-gapok-change').hidden, false);
    assert.equal(h.field('new-gapok-reason').required, true);
    await h.submit();
    assert.equal(h.calls[0].body.profil.gaji_pokok, 2000000, 'Profile update preserves the original salary');
    assert.deepEqual(h.calls[1], { kind: 'salary', body: { action: 'ubahGajiPokok', usernameTarget: 'employee raha',
        gajiLama: 2000000, gajiBaru: 2250000, alasan: 'Evaluasi kinerja' } });
    assert.equal(h.database.salary, 2250000); assert.equal(h.target['Gaji Pokok'], 2250000);
    assert.match(h.notices.at(-1).message, /Gaji pokok berhasil disimpan.*WhatsApp pegawai telah dikirim/);
    assert.equal(h.field('btn-tambah-user').disabled, false);
});

test('Unchanged salary updates only the profile and does not require a reason', async () => {
    const h = harness(); h.edit(); await h.submit();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].kind, 'profile');
    assert.equal(h.field('new-gapok-reason').required, false);
});

test('Empty reasons and invalid salary amounts are rejected before any write', async () => {
    for (const value of ['-1', '2000000.5', 'invalid', '9007199254740992', '']) {
        const h = harness(); h.edit(value, 'Evaluasi kinerja'); await h.submit();
        assert.equal(h.calls.length, 0, value); assert.match(h.notices.at(-1).message, /nominal rupiah bulat/);
    }
    for (const reason of ['', '   ', 'a'.repeat(1001)]) {
        const h = harness(); h.edit(2250000, reason); await h.submit();
        assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /Isi alasan/);
    }
});

test('Unauthorized staff keep a locked salary field and tampering cannot call the salary API', async () => {
    for (const [role, branch] of [['admin_raha', 'Raha'], ['admin', 'Raha'], ['teknisi', 'Raha'], ['sales', 'Kendari']]) {
        const h = harness({ role, branch }); h.edit(2250000, 'Alasan');
        assert.equal(h.field('new-gapok').readOnly, true); await h.submit();
        assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /tidak berhak/);
    }
    for (const role of ['admin', 'manager', 'direktur', 'teknisi']) {
        const h = harness({ role }); h.edit(2250000, 'Alasan'); h.c.siapkanProfilPribadi();
        assert.equal(h.field('new-gapok').readOnly, true);
        assert.equal(h.field('new-gapok-change').hidden, true);
        assert.equal(h.field('new-gapok-reason').required, false);
    }
});

test('Profile rejection or a concurrent salary change prevents the salary write', async () => {
    for (const options of [{ profileFailure: true }, {}]) {
        const h = harness(options); h.edit(2250000, 'Evaluasi kinerja');
        if (!options.profileFailure) h.database.salary = 2100000;
        await h.submit(); assert.equal(h.calls.length, 1);
        assert.equal(h.field('new-gapok').value, '2250000');
        assert.match(h.notices.at(-1).message, /Gagal menyimpan profil/);
    }
});

test('A salary failure preserves the pending amount and reason and reports the saved profile', async () => {
    const h = harness({ salaryFailure: true }); h.edit(2250000, 'Evaluasi kinerja');
    h.field('new-password').value = 'ExampleOnly123!'; await h.submit();
    assert.match(h.notices.at(-1).message, /Profil tersimpan, tetapi perubahan gaji belum terkonfirmasi/);
    assert.equal(h.database.salary, 2000000);
    assert.equal(h.field('new-gapok').value, '2250000');
    assert.equal(h.field('new-gapok-reason').value, 'Evaluasi kinerja');
    assert.equal(h.field('new-password').value, '');
    assert.equal(h.field('btn-tambah-user').disabled, false);
    h.c.apiGajiManajemen_ = async body => { h.database.salary = body.gajiBaru; return { notifikasiTertunda: 1 }; };
    await h.submit(); assert.equal(h.database.salary, 2250000);
    assert.equal(h.calls.at(-1).body.passwordBaru, '', 'Retry does not repeat a completed password update');
    assert.match(h.notices.at(-1).message, /antrean pengiriman ulang/);
});

test('A lost salary response cannot repeat the financial change on retry', async () => {
    const h = harness({ committedTimeout: true }); h.edit(2250000, 'Evaluasi kinerja'); await h.submit();
    assert.equal(h.database.salary, 2250000); await h.submit();
    assert.equal(h.calls.filter(c => c.kind === 'salary').length, 1);
    assert.match(h.notices.at(-1).message, /Gaji pokok sudah berbeda/);
});

test('Salary decreases do not claim a WhatsApp notification and own changes refresh the session salary', async () => {
    const h = harness({ own: true }); h.edit(1900000, 'Penyesuaian disepakati'); await h.submit();
    assert.equal(h.actor['Gaji Pokok'], 1900000);
    assert.ok(h.sessions.some(s => s['Gaji Pokok'] === 1900000));
    assert.match(h.notices.at(-1).message, /Gaji pokok berhasil disimpan/);
    assert.doesNotMatch(h.notices.at(-1).message, /WhatsApp/);
});

test('Zero salaries, new user creation and cancellation keep their intended semantics', async () => {
    const zero = harness({ salary: 0 }); zero.edit();
    assert.equal(zero.field('new-gapok').value, '0'); await zero.submit(); assert.equal(zero.calls.length, 1);
    const create = harness(); create.edit(2250000, 'Alasan'); create.c.batalEditUser();
    assert.equal(create.field('new-gapok').value, ''); assert.equal(create.field('new-gapok-reason').value, '');
    assert.equal(create.field('new-gapok-change').hidden, true);
    create.field('new-username').value = 'new employee'; create.field('new-gapok').value = 1750000;
    create.field('new-password').value = 'ExampleOnly123!'; await create.submit();
    assert.equal(create.calls[0].action, 'buatProfil'); assert.equal(create.calls[0].body.profil.gaji_pokok, 1750000);
    assert.equal(create.calls.length, 1);
});

test('New profile saves show WhatsApp success or a warning while clearing the saved password', async () => {
    for (const terkirim of [true, false]) {
        const pesan = terkirim ? 'WhatsApp selamat datang dan akses akun sudah dikirim ke nomor pegawai.'
            : 'Profil tersimpan, tetapi pengiriman WhatsApp selamat datang belum terkonfirmasi.';
        const h = harness({ welcome: { terkirim, pesan } });
        h.c.batalEditUser(); h.field('new-username').value = 'new employee';
        h.field('new-gapok').value = 1750000; h.field('new-password').value = 'WelcomeOnly123!';
        await h.submit();
        assert.equal(h.calls.length, 1); assert.equal(h.calls[0].action, 'buatProfil');
        assert.ok(h.notices.at(-1).message.includes(pesan));
        assert.equal(h.notices.at(-1).kind, terkirim ? 'success' : 'warning');
        assert.equal(h.field('new-password').value, '');
        assert.ok(!h.notices.at(-1).message.includes('WelcomeOnly123!'));
    }
});

test('Repeated submits and switching targets while saving cannot produce a second write', async () => {
    let resolve; const wait = new Promise(done => resolve = done), h = harness({ profileWait: wait });
    h.edit(2250000, 'Evaluasi kinerja'); const pending = h.submit();
    await h.submit(); h.c.aktifkanEditUser('another'); assert.equal(h.field('new-gapok').value, '2250000');
    assert.equal(h.field('btn-batal-edit-user').disabled, true);
    resolve(); await pending; assert.equal(h.calls.filter(c => c.kind === 'salary').length, 1);
});

test('A refresh failure after a salary commit reports that the changes were saved', async () => {
    const h = harness({ refreshFailure: true }); h.edit(2250000, 'Evaluasi kinerja'); await h.submit();
    assert.equal(h.database.salary, 2250000);
    assert.match(h.notices.at(-1).message, /Perubahan tersimpan, tetapi data belum berhasil dimuat ulang/);
    assert.equal(h.field('loading').style.display, 'none');
    assert.equal(h.field('btn-tambah-user').disabled, false);
});
