const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const root = path.resolve(__dirname, '..');
const helpers = fs.readFileSync(path.join(root, 'maintenance/leave-projection.gs'), 'utf8');
const payroll = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
const form = fs.readFileSync(path.join(root, 'absen.html'), 'utf8');
const name = 'Pegawai Uji';
const dayKey = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const c = vm.createContext({ Date, formatKunciTanggal_: dayKey,
  buatTanggalMakassar_: (day, minutes) => new Date(day + 'T' + String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ':00+08:00'),
  Utilities: { formatDate: value => dayKey(value) + ' ' + new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }) }
});
vm.runInContext(helpers, c);
const leave = (extra = {}) => ({ id_pengajuan: 'PGJ-TEST', nama_pegawai: name, role: 'sales', jenis: 'Izin', tanggal_mulai: '2026-09-09', tanggal_selesai: '2026-09-13', status: 'Disetujui', ...extra });
const entry = (day, time, type = 'Masuk', extra = {}) => ({ id_absen: 'REAL-' + day + time, nama_pegawai: name, waktu_absen: day + 'T' + time + '+08:00', tipe_absen: type, status_disiplin: 'Tepat Waktu', ...extra });
const project = (rows, requests, begin = '2026-09-01', end = '2026-09-30', now = '2026-09-10T15:00:00+08:00') => JSON.parse(JSON.stringify(c.proyeksikanAbsensiPengajuan_(rows, requests, begin, end, new Date(now))));
const markers = rows => rows.filter(r => ['Sakit', 'Izin'].includes(r.tipe_absen));
const legacy = (p, day) => entry(day, '08:00:00', p.jenis, { id_absen: 'ABS-' + p.id_pengajuan + '-' + day.replaceAll('-', ''), status_disiplin: 'Pengajuan Disetujui' });

test('example: first real afternoon return on September 9 suppresses all remaining leave through 13', () => {
  const p = leave(), real = entry('2026-09-09', '12:21:27', 'Masuk Setelah Istirahat');
  const input = ['09','10','11','12','13'].map(d => legacy(p, '2026-09-' + d)).concat([real, entry('2026-09-10','08:07:05')]);
  const original = structuredClone(input), result = project(input, [p]);
  assert.equal(markers(result).length, 1);
  assert.equal(dayKey(markers(result)[0].waktu_absen), '2026-09-09');
  assert.equal(markers(result)[0].kembali_bekerja_pada, new Date(real.waktu_absen).toISOString());
  assert.equal(result.filter(r => r.tipe_absen.includes('Masuk')).length, 2);
  assert.deepEqual(input, original); assert.equal(p.tanggal_selesai, '2026-09-13');
});

test('return before work begins leaves no leave marker that day', () => {
  assert.equal(markers(project([entry('2026-09-09','07:59:59')], [leave()])).length, 0);
  assert.equal(markers(project([entry('2026-09-09','08:00:00')], [leave()])).length, 0);
});

test('no physical return preserves the original planned leave range', () => {
  assert.equal(markers(project([], [leave()])).length, 5);
});

test('system-generated entry, manual correction, exit, and another employee never close leave', () => {
  const rows = [entry('2026-09-09','08:00:00','Masuk',{status_disiplin:'Lupa Absen Masuk'}), entry('2026-09-09','09:00:00','Koreksi - Absen Masuk'), entry('2026-09-09','10:00:00','Masuk',{status_disiplin:'Koreksi Manual'}), entry('2026-09-09','17:00:00','Keluar'), entry('2026-09-09','08:00:00','Masuk',{nama_pegawai:'Pegawai Lain'})];
  assert.equal(markers(project(rows, [leave()])).length, 5);
});

test('entry before the leave starts or after its end does not truncate it', () => {
  assert.equal(markers(project([entry('2026-09-08','08:00:00'), entry('2026-09-14','08:00:00')], [leave()])).length, 5);
});

test('open-ended sickness grows through today only, never pre-fills future dates', () => {
  const p = leave({ jenis:'Sakit', tanggal_selesai:null });
  assert.deepEqual(markers(project([], [p])).map(r => dayKey(r.waktu_absen)), ['2026-09-09','2026-09-10']);
  assert.equal(markers(project([], [p], '2026-10-01','2026-10-31')).length, 0);
});

test('legacy sickness continues past its old end date until a real return', () => {
  const p=leave({jenis:'Sakit',tanggal_mulai:'2026-09-12',tanggal_selesai:'2026-09-12'});
  const ongoing=project([], [p], '2026-09-01','2026-09-30','2026-09-16T15:00:00+08:00');
  assert.deepEqual(markers(ongoing).map(r=>dayKey(r.waktu_absen)),['2026-09-12','2026-09-13','2026-09-14','2026-09-15','2026-09-16']);
  const returned=project([entry('2026-09-15','08:00:00')],[p],'2026-09-01','2026-09-30','2026-09-16T15:00:00+08:00');
  assert.deepEqual(markers(returned).map(r=>dayKey(r.waktu_absen)),['2026-09-12','2026-09-13','2026-09-14']);
  assert.equal(p.tanggal_selesai,'2026-09-12');
});

test('legacy illness continues across months, without future autofill', () => {
  const p=leave({jenis:'Sakit',tanggal_mulai:'2026-08-29',tanggal_selesai:'2026-08-31'});
  assert.equal(markers(project([], [p])).length,10);
  assert.equal(markers(project([], [{...p,kembali_bekerja_pada:'2026-08-31T08:00:00+08:00'}])).length,0);
  let query=''; const cx=vm.createContext({SUPABASE_URL:'https://example.invalid/',Date,callSupabase_:url=>{query=url;return []},formatKunciTanggal_:dayKey});
  vm.runInContext(helpers,cx);cx.bacaAbsensiEfektifPengajuan_([], '2026-09-01','2026-09-30',name);
  assert.match(query,/or=\(jenis.eq.Sakit,tanggal_selesai.is.null/);
  assert.ok(query.includes('nama_pegawai=eq.'+encodeURIComponent(name)));
});

test('open-ended sickness closes on real attendance and keeps only earlier illness', () => {
  const p = leave({ jenis:'Sakit', tanggal_selesai:null });
  const result = project([entry('2026-09-10','12:30:00','Masuk Setelah Istirahat')], [p]);
  assert.equal(markers(result).length, 2);
  assert.ok(markers(result).every(r => r.kembali_bekerja_pada));
});

test('stored return timestamp closes a prior-month request when reading a later month', () => {
  const p = leave({ tanggal_mulai:'2026-08-29', tanggal_selesai:'2026-09-13', kembali_bekerja_pada:'2026-08-31T12:00:00+08:00' });
  assert.equal(markers(project([legacy(p, '2026-09-09')], [p])).length, 0);
});

test('a long ongoing illness projects only the requested month', () => {
  const p = leave({ jenis:'Sakit', tanggal_mulai:'2026-08-01', tanggal_selesai:null });
  assert.equal(markers(project([], [p])).length, 10);
});

test('repeated projection is idempotent and unrelated manual leave records survive', () => {
  const p = leave(), manual = entry('2026-09-15','08:00:00','Izin',{status_disiplin:'Manual'});
  const one = project([manual, entry('2026-09-09','12:00:00')], [p]);
  assert.deepEqual(project(one, [p]), one); assert.ok(one.some(r => r.id_absen === manual.id_absen));
});

test('rejected and pending requests never create approved attendance', () => {
  assert.equal(project([], [leave({status:'Menunggu'}),leave({status:'Ditolak'})]).length, 0);
});

function calculate(rows, now = '2026-09-10T15:00:00+08:00') {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const cx = vm.createContext({ Date:FixedDate, globalUsers:[{'Nama Asli':name,'Gaji Pokok':1000000,Role:'sales',Hak_Akses_Cabang:'Kendari'}],
    globalAbsen:rows.map(r => ({'Nama Pegawai':r.nama_pegawai,'Waktu Absen':r.waktu_absen,'Tipe Absen':r.tipe_absen,'Keterangan':r.keterangan||'', 'Status Disiplin':r.status_disiplin||'', 'Kembali Bekerja':r.kembali_bekerja_pada||''})),
    globalTickets:[], formatRp:v=>'Rp '+Math.round(v), ambilVariabelPayroll:()=>({luarKota:'',fee:0,kasbon:0}) });
  vm.runInContext(payroll.slice(payroll.indexOf('        function normalisasiCabangPayroll'),payroll.indexOf('        function generateSlipIndividu')),cx);
  const result = cx.kalkulasiGajiPegawai(name,'2026-09',26);
  const row = day => result.barisHTML.split('<tr ').find(r=>r.includes(day+'/09/2026'));
  const styles = day => [...row(day).matchAll(/<td(?:\s([^>]*))?>/g)].map(m=>m[1]||'');
  return {row, styles, result};
}

test('payroll retains green before afternoon return, clears subsequent slots/days, and preserves Sunday', () => {
  const p=leave(), rows=project([entry('2026-09-09','12:21:27','Masuk Setelah Istirahat'),entry('2026-09-09','17:49:33','Keluar'),entry('2026-09-10','08:07:05')],[p]);
  const result=calculate(rows);
  assert.match(result.styles('09')[1],/#bbf7d0/); assert.match(result.styles('09')[2],/#bbf7d0/);
  assert.doesNotMatch(result.styles('09')[3],/#bbf7d0/); assert.doesNotMatch(result.styles('09')[4],/#bbf7d0/);
  for(const d of ['10','11','12','13']) assert.doesNotMatch(result.row(d),/#bbf7d0|ID Pengajuan|>Izin</);
  assert.match(result.row('13'),/#fecdd3/);
  assert.doesNotMatch(result.row('11'),/Alpa/);
});

test('morning return clears all green slots while preserving a real late-entry marker', () => {
  const r=calculate(project([entry('2026-09-09','09:10:00'),entry('2026-09-09','17:00:00','Keluar')],[leave()]));
  assert.ok(r.styles('09').slice(1,5).every(s=>!s.includes('#bbf7d0')));
  assert.match(r.styles('09')[1],/#fef08a/);
});

test('an early afternoon exit after returning is no longer colored as leave', () => {
  const rows=project([entry('2026-09-09','12:21:27','Masuk Setelah Istirahat'),entry('2026-09-09','13:30:00','Keluar')],[leave()]);
  const r=calculate(rows);
  assert.match(r.styles('09')[1],/#bbf7d0/);
  assert.doesNotMatch(r.styles('09')[2],/#bbf7d0/);
  assert.doesNotMatch(r.styles('09')[3],/#bbf7d0/);
});

test('sickness retains blue before return and preserves the existing auto-exit penalty color', () => {
  const rows=project([entry('2026-09-09','12:30:00','Masuk Setelah Istirahat'),entry('2026-09-09','15:30:00','Keluar',{status_disiplin:'Auto Keluar Penalti (Potongan 90 Menit)'})],[leave({jenis:'Sakit',tanggal_selesai:null})]);
  const r=calculate(rows); assert.match(r.styles('09')[1],/#bfdbfe/); assert.match(r.styles('09')[3],/#ffffff/); assert.match(r.styles('09')[4],/#e2e8f0/);
  assert.doesNotMatch(r.row('10'),/#bfdbfe/);
});

test('old overlapping sick requests remain blue with empty times after the three-day autofill quota', () => {
  const requests=[leave({id_pengajuan:'PGJ-EARLIER',jenis:'Sakit',tanggal_mulai:'2026-09-08',tanggal_selesai:'2026-09-08',kembali_bekerja_pada:'2026-09-08T12:36:00+08:00'}),leave({id_pengajuan:'PGJ-12',jenis:'Sakit',tanggal_mulai:'2026-09-12',tanggal_selesai:'2026-09-12'}),leave({id_pengajuan:'PGJ-14',jenis:'Sakit',tanggal_mulai:'2026-09-14',tanggal_selesai:'2026-09-14'})];
  const rows=project([],requests,'2026-09-01','2026-09-30','2026-09-16T15:00:00+08:00');
  const r=calculate(rows,'2026-09-16T15:00:00+08:00');
  for(const d of ['12','14']) assert.match(r.row(d),/>08:00</);
  for(const d of ['15','16']){
    assert.ok(r.styles(d).slice(1,5).every(s=>s.includes('#bfdbfe')));
    const cells=[...r.row(d).matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
    assert.deepEqual(cells.slice(1,5),['-','-','-','-']);
    assert.equal(cells[6],'-');assert.match(r.row(d),/Sakit \(Kuota Habis/);assert.doesNotMatch(r.row(d),/Alpa|#1e293b/);
  }
  assert.match(r.row('13'),/#fecdd3/);assert.doesNotMatch(r.row('17'),/08:00|Alpa|Kuota/);
});

test('form toggles end-date visibility and validation only for Sakit', () => {
  const ids=['pengajuan-mulai','pengajuan-selesai','pengajuan-jenis','pengajuan-selesai-field','pengajuan-sakit-info'];
  const el=Object.fromEntries(ids.map(id=>[id,{value:'',style:{},required:true,disabled:false}]));
  el['pengajuan-mulai'].value='2026-09-10'; el['pengajuan-jenis'].value='Sakit';
  const cx=vm.createContext({document:{getElementById:id=>el[id]}});
  vm.runInContext(form.slice(form.indexOf('        function sinkronTanggalPengajuan()'),form.indexOf('        function bukaModalPengajuan()')),cx);
  cx.sinkronTanggalPengajuan(); assert.equal(el['pengajuan-selesai'].required,false); assert.equal(el['pengajuan-selesai-field'].style.display,'none');
  el['pengajuan-jenis'].value='Izin'; cx.sinkronTanggalPengajuan(); assert.equal(el['pengajuan-selesai'].required,true); assert.equal(el['pengajuan-selesai'].disabled,false);
});

test('sick form submits without an end date, while leave requires one', async () => {
  for (const jenis of ['Sakit','Izin']) {
    const el={}; for(const id of ['pengajuan-jenis','pengajuan-mulai','pengajuan-selesai','pengajuan-alasan','pengajuan-foto','btn-kirim-pengajuan','loading-overlay','loading-text','form-pengajuan-cuti']) el[id]={value:'',style:{},files:[{}],reset(){}};
    el['pengajuan-jenis'].value=jenis; el['pengajuan-mulai'].value='2026-09-10'; el['pengajuan-alasan'].value='Test';
    const payloads=[]; const cx=vm.createContext({penggunaAktif:{Role:'sales'},document:{getElementById:id=>el[id]},showToast(){},kompresFoto:async()=> 'mock-photo',payloadDenganSesi:(action,p)=>p,API_ABSEN_URL:'test',fetchAntiCORS:async(u,p)=>{payloads.push(p);return {status:'sukses'};},tutupModal(){}});
    vm.runInContext(form.slice(form.indexOf('        async function kirimPengajuanCuti('),form.indexOf('        function escapeHTML(')),cx);
    await cx.kirimPengajuanCuti({preventDefault(){}});
    assert.equal(payloads.length,jenis==='Sakit'?1:0); if(jenis==='Sakit')assert.equal(payloads[0].selesai,null);
  }
});

test('changed frontend scripts compile', () => {
  for(const html of [form,payroll])for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(script.trim())new vm.Script(script);
});
