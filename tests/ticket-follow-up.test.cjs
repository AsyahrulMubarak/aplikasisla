const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(process.env.SLA_FOLLOWUP_HTML || path.resolve(__dirname, '../index.html'), 'utf8');

function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function harness(options = {}) {
  const calls = [], toasts = [];
  const row = { id_tiket: 'TKT-UJI', cabang: 'Kendari', status: 'Pending', teknisi: 'Syawal', klien_lokasi: 'Klien Uji', jenis_pekerjaan: 'Perbaikan printer', ...options.row };
  const context = vm.createContext({
    penggunaAktif: { Role: 'admin', Username: 'admin-uji', 'Nama Asli': 'Admin Uji' },
    cabangAktif: 'Kendari',
    API_URL_CABANG: { Kendari: 'gateway-kendari', Raha: 'gateway-raha' },
    globalTickets: [{ 'ID Tiket': row.id_tiket, Status: 'Menunggu', Teknisi: 'Teknisi Lama' }],
    globalUsers: options.users || [{ Role: 'teknisi', Username: 'syawal', 'Nama Asli': 'Muhammad Syawal', 'No WA': '081234567890', Cabang: 'Kendari' }],
    followUpTiketSedangDikirim_: new Set(),
    perbaruiStatusSLAAktualTiket_: ticket => ticket,
    renderTickets: () => {},
    showToast: (message, type) => toasts.push({ message, type }),
    callSupabase: async endpoint => { calls.push({ endpoint }); return options.read ? options.read(endpoint) : [row]; },
    kirimKeBackend_: async (url, action, payload) => { calls.push({ url, action, payload }); return options.send ? options.send(payload) : { status: 'sukses', terkirim: true }; }
  });
  for (const name of ['rolePengguna', 'normalisasiCabang', 'dataSesuaiCabangAktif_', 'idAman_', 'eventHandlerAman_', 'endpointFilterSupabase_', 'normalisasiWASementara_', 'daftarTeknisiUnikTiket_', 'kunciNamaPekerjaanTeknisi_', 'namaTeknisiPenggantian_', 'tanggalCatatanPenggantian_', 'riwayatPenggantianTeknisi_', 'petakanTiketSupabase_', 'statusFollowUpTiket_', 'bolehFollowUpTiket_', 'namaTeknisiFollowUpTiket_', 'tombolFollowUpTiket_', 'pesanFollowUpTiket_', 'penerimaFollowUpTiket_', 'kirimFollowUpTiket']) {
    vm.runInContext(extract(name), context);
  }
  return { context, calls, toasts, row };
}

test('each eligible status sends a distinct scheduling question through the authenticated relay', async () => {
  for (const [status, question] of [[' menunggu ', /Kapan tiket ini akan mulai dikerjakan\?/], ['on  progress', /progres terbaru[\s\S]*dilanjutkan[\s\S]*perkiraan selesai/], ['PENDING', /Apa kendala[\s\S]*pekerjaan dapat dilanjutkan/]]) {
    const { context, calls, toasts } = harness({ row: { status } });
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.match(calls[0].endpoint, /^tiket\?id_tiket=eq.TKT-UJI&cabang=eq.Kendari&limit=1$/);
    assert.equal(calls[1].url, 'gateway-kendari');
    assert.equal(calls[1].action, 'relayWA');
    assert.equal(calls[1].payload.nomorTujuan, '6281234567890');
    assert.match(calls[1].payload.pesan, question);
    assert.match(calls[1].payload.pesan, /TKT-UJI[\s\S]*Klien Uji[\s\S]*Perbaikan printer[\s\S]*Admin Uji/);
    assert.equal(toasts.at(-1).type, 'success');
  }
});

test('buttons follow ticket status, permitted roles, assignment and sanitizer rules', () => {
  const { context } = harness();
  const ticket = { 'ID Tiket': 'TKT-UJI', Status: 'Pending', Teknisi: 'Syawal' };
  for (const role of ['admin', 'admin_raha', 'manager', 'direktur', 'sales']) {
    context.penggunaAktif.Role = role;
    assert.match(context.tombolFollowUpTiket_(ticket), /onclick="kirimFollowUpTiket\('TKT-UJI'\)"/);
  }
  for (const role of ['teknisi', 'freelance', '']) {
    context.penggunaAktif.Role = role;
    assert.equal(context.tombolFollowUpTiket_(ticket), '');
  }
  context.penggunaAktif.Role = 'admin';
  for (const status of ['Selesai', 'Cancel', 'Outsource', 'Claim Garansi', '__proto__', 'constructor']) {
    assert.equal(context.tombolFollowUpTiket_({ ...ticket, Status: status }), '');
  }
  assert.match(context.tombolFollowUpTiket_({ ...ticket, Teknisi: ' belum ditugaskan ' }), /disabled[\s\S]*Tugaskan teknisi/);
  assert.equal(context.tombolFollowUpTiket_({ ...ticket, 'ID Tiket': "bad');alert(1)//" }), '');
  assert.equal(context.eventHandlerAman_("kirimFollowUpTiket('TKT-UJI')"), true);
  assert.equal(context.eventHandlerAman_("kirimFollowUpTiket('TKT-UJI');alert(1)"), false);
});

test('fresh assignment and status override stale card information', async () => {
  const { context, calls } = harness({ row: { status: 'Menunggu', teknisi: 'Teknisi Baru' }, users: [{ Role: 'teknisi', 'Nama Asli': 'Teknisi Baru', 'No WA': '082200000001', Cabang: 'Kendari' }] });
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.equal(calls[1].payload.nomorTujuan, '6282200000001');
  assert.match(calls[1].payload.pesan, /Status: \*Menunggu\*/);
  assert.equal(context.globalTickets[0].Teknisi, 'Teknisi Baru');
});

test('every assigned technician receives one message, with aliases and shared numbers deduplicated', async () => {
  const users = [
    { Role: 'teknisi', Username: 'syawal', 'Nama Asli': 'Muhammad Syawal', 'No WA': '081234567890', Cabang: 'Kendari' },
    { Role: 'teknisi', 'Nama Asli': 'Budi', 'No WA': '+62 822 0000 0001', Cabang: 'Kendari' },
    { Role: 'teknisi', 'Nama Asli': 'Andi', 'No WA': '082200000001', Cabang: 'Kendari' },
    { Role: 'sales', 'Nama Asli': 'Budi', 'No WA': '083300000001', Cabang: 'Kendari' },
    { Role: 'teknisi', 'Nama Asli': 'Budi', 'No WA': '084400000001', Cabang: 'Raha' }
  ];
  const { context, calls } = harness({ row: { teknisi: 'Syawal, Muhammad Syawal, Budi, Andi, Budi' }, users });
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.deepEqual(calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567890', '6282200000001']);
});

test('no WhatsApp is sent for missing, ambiguous, invalid or unassigned technician profiles', async () => {
  for (const options of [
    { row: { teknisi: 'Belum Ditugaskan' } },
    { users: [] },
    { users: [{ Role: 'teknisi', Username: 'syawal', 'No WA': 'invalid', Cabang: 'Kendari' }] },
    { users: [1, 2].map(n => ({ Role: 'teknisi', Username: 'syawal', 'No WA': '081234567890', Cabang: 'Kendari' })) }
  ]) {
    const { context, calls, toasts } = harness(options);
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.equal(calls.filter(c => c.action).length, 0);
    assert.equal(toasts.at(-1).type, 'error');
    assert.equal(context.followUpTiketSedangDikirim_.size, 0);
  }
});

test('finished, unavailable and wrong-branch tickets cannot trigger follow-up', async () => {
  for (const options of [{ row: { status: 'Selesai' } }, { row: { status: 'Cancel' } }, { row: { cabang: 'Raha' } }, { read: async () => [] }]) {
    const { context, calls, toasts } = harness(options);
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.equal(calls.filter(c => c.action).length, 0);
    assert.equal(toasts.at(-1).type, 'error');
  }
});

test('unauthorized roles and a branch switch while loading cannot send messages', async () => {
  const forbidden = harness();
  forbidden.context.penggunaAktif.Role = 'teknisi';
  await forbidden.context.kirimFollowUpTiket('TKT-UJI');
  assert.equal(forbidden.calls.length, 0);
  let finishRead;
  const switched = harness({ read: () => new Promise(resolve => { finishRead = resolve; }) });
  const pending = switched.context.kirimFollowUpTiket('TKT-UJI');
  switched.context.cabangAktif = 'Raha';
  finishRead([switched.row]);
  await pending;
  assert.equal(switched.calls.filter(c => c.action).length, 0);
});

test('an in-flight guard prevents duplicate sends and survives card rerendering', async () => {
  let finishSend;
  const { context, calls } = harness({ send: () => new Promise(resolve => { finishSend = resolve; }) });
  const first = context.kirimFollowUpTiket('TKT-UJI');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(context.tombolFollowUpTiket_(context.globalTickets[0]), /disabled[\s\S]*Mengirim WA/);
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.equal(calls.filter(c => c.action).length, 1);
  finishSend({ status: 'sukses', terkirim: true });
  await first;
  assert.equal(context.followUpTiketSedangDikirim_.size, 0);
});

test('partial failures and transport errors identify undelivered recipients accurately', async () => {
  for (const throws of [false, true]) {
    const { context, calls, toasts } = harness({
      row: { teknisi: 'Syawal, Budi' },
      users: [
        { Role: 'teknisi', Username: 'syawal', 'Nama Asli': 'Muhammad Syawal', 'No WA': '081234567890', Cabang: 'Kendari' },
        { Role: 'teknisi', 'Nama Asli': 'Budi', 'No WA': '082200000001', Cabang: 'Kendari' }
      ],
      send: async payload => { if (payload.nomorTujuan === '6281234567890') return { status: 'sukses', terkirim: true }; if (throws) throw new Error('Provider unavailable'); return { status: 'sukses', terkirim: false }; }
    });
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.equal(calls.filter(c => c.action).length, 2);
    assert.match(toasts.at(-1).message, /dikirim ke Muhammad Syawal[\s\S]*Gagal dikirim ke Budi/);
    assert.equal(toasts.at(-1).type, 'error');
  }
});

test('Raha tickets use the Raha relay and assigned Raha technician', async () => {
  const { context, calls } = harness({ row: { cabang: 'Raha', teknisi: 'Budi' }, users: [{ Role: 'teknisi', 'Nama Asli': 'Budi', 'No WA': '082200000001', Cabang: 'Raha' }] });
  context.cabangAktif = 'Raha';
  context.penggunaAktif.Role = 'admin_raha';
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.match(calls[0].endpoint, /cabang=eq.Raha/);
  assert.equal(calls[1].url, 'gateway-raha');
  assert.match(calls[1].payload.pesan, /Cabang: Raha/);
});

const replacementUsers = ['Teknisi Lama', 'Anggota Lama', 'Pengganti', 'Pengganti Baru'].map((name, i) => ({ Role: 'teknisi', Username: 'teknisi-' + i, 'Nama Asli': name, 'No WA': '08123456789' + i, Cabang: 'Kendari' }));

test('a replacement receives follow-up without notifying retained members of the old team', async () => {
  for (const status of ['Pending', 'On Progress', 'Menunggu']) {
    const { context, calls } = harness({ row: {
      status, teknisi: 'Pengganti, Anggota Lama', teknisi_sebelumnya: 'Teknisi Lama, Anggota Lama',
      riwayat_penggantian_teknisi: [{ dari: 'Teknisi Lama, Anggota Lama', ke: 'Pengganti, Anggota Lama', sumber: 'server' }]
    }, users: replacementUsers });
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.deepEqual(calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567892']);
    assert.match(calls[1].payload.pesan, /Teknisi: Pengganti\n/);
    assert.doesNotMatch(calls[1].payload.pesan, /Teknisi Lama|Anggota Lama/);
  }
});

test('legacy notes and previous-assignment metadata also exclude the old team', async () => {
  for (const metadata of [
    { teknisi_sebelumnya: 'Teknisi Lama, Anggota Lama' },
    { teknisi_sebelumnya: 'Teknisi Lama, Anggota Lama', riwayat_penggantian_teknisi: [] },
    { keterangan: '[13/10/2026, 08.00.00] 🔄 PERGANTIAN TEKNISI\nDari: Teknisi Lama, Anggota Lama\nKe: Pengganti, Anggota Lama' }
  ]) {
    const { context, calls } = harness({ row: { teknisi: 'Teknisi Lama, Anggota Lama, Pengganti', ...metadata }, users: replacementUsers });
    await context.kirimFollowUpTiket('TKT-UJI');
    assert.deepEqual(calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567892']);
  }
});

test('only the latest replacement determines exclusions, allowing a technician to be reassigned', async () => {
  const { context, calls } = harness({ row: {
    teknisi: 'Teknisi Lama', teknisi_sebelumnya: 'Pengganti',
    riwayat_penggantian_teknisi: [null, { dari: 'Teknisi Lama', ke: 'Pengganti' }, { dari: 'Pengganti', ke: 'Teknisi Lama' }, 'invalid']
  }, users: replacementUsers });
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.deepEqual(calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567890']);
});

test('replacement metadata cannot resurrect a technician who is no longer assigned', async () => {
  const { context, calls } = harness({ row: {
    teknisi: 'Pengganti Baru', teknisi_sebelumnya: 'Teknisi Lama',
    riwayat_penggantian_teknisi: [{ dari: 'Teknisi Lama', ke: 'Pengganti' }]
  }, users: replacementUsers });
  await context.kirimFollowUpTiket('TKT-UJI');
  assert.deepEqual(calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567893']);
});

test('old names are excluded after alias normalization and missing replacement blocks delivery', async () => {
  const alias = harness({ row: { teknisi: 'Muhammad Syawal, Pengganti', teknisi_sebelumnya: 'Syawal' }, users: replacementUsers });
  await alias.context.kirimFollowUpTiket('TKT-UJI');
  assert.deepEqual(alias.calls.filter(c => c.action).map(c => c.payload.nomorTujuan), ['6281234567892']);
  const missing = harness({ row: { teknisi: 'Teknisi Lama', teknisi_sebelumnya: 'Teknisi Lama' }, users: replacementUsers });
  await missing.context.kirimFollowUpTiket('TKT-UJI');
  assert.equal(missing.calls.filter(c => c.action).length, 0);
  assert.match(missing.toasts.at(-1).message, /Teknisi pengganti aktif belum ditetapkan/);
  assert.match(missing.context.tombolFollowUpTiket_(missing.context.globalTickets[0]), /disabled[\s\S]*Periksa teknisi pengganti/);
});

test('TKT-153 reduced-team server assignment keeps Muaz eligible without notifying Ardi S',async()=>{
 const h=harness({row:{teknisi:'Muaz',teknisi_sebelumnya:null,riwayat_penggantian_teknisi:[{dari:'Ardi S, Muaz',ke:'Muaz',sumber:'server'}]},users:[{Role:'teknisi',Username:'Muaz','Nama Asli':'Muaz','No WA':'081234567891',Cabang:'Kendari'}]});
 await h.context.kirimFollowUpTiket('TKT-UJI');assert.deepEqual(h.calls.filter(c=>c.action).map(c=>c.payload.nomorTujuan),['6281234567891']);assert.match(h.calls[1].payload.pesan,/Teknisi: Muaz\n/);assert.doesNotMatch(h.calls[1].payload.pesan,/Ardi S/);assert.doesNotMatch(h.context.tombolFollowUpTiket_(h.context.globalTickets[0]),/disabled/);
});

