// Klaim sales terpusat. Modul ini disertakan pada backend Kendari dan Raha.
function adminKendariUntukKlaim_(user) {
  if (!user) return false;
  var role = String(user.role || user.Role || '').trim().toLowerCase();
  var cabang = String(user.hak_akses_cabang || user.Hak_Akses_Cabang || '').trim().toLowerCase();
  return role === 'admin' && ['', 'kendari', 'semua'].indexOf(cabang) !== -1;
}

function identitasKlaimSales_(dataUser) {
  if (!verifikasiSessionToken_(dataUser)) throw new Error('Sesi tidak sah atau telah kedaluwarsa.');
  var username = String(dataUser.Username || '').trim().toLowerCase().replace(/\s+/g, '');
  var rows = callSupabaseServiceRole_('users?username_login=eq.' + encodeURIComponent(username) +
    '&select=username_login,nama_asli,role,hak_akses_cabang&limit=2', 'get', null);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Profil pengguna tidak ditemukan atau ambigu.');
  return rows[0];
}

function prosesKlaimSales_(data) {
  var aktor = identitasKlaimSales_(data.user);
  var action = String(data.action || '');
  var admin = adminKendariUntukKlaim_(aktor);
  if (action === 'getKlaimSales') {
    if (!admin) throw new Error('Menu Klaim Sales hanya dapat diakses oleh Admin Kendari.');
    var fields = 'id_tiket,cabang,klien_lokasi,pekerjaan,sales,status_banding,sales_pengaju,' +
      'keterangan_sales,alasan_admin,klaim_sales_id,klaim_sales_username,' +
      'klaim_sales_diajukan_pada,klaim_sales_diputuskan_pada,klaim_sales_admin';
    var rows = [], page;
    do {
      page = callSupabaseServiceRole_('tiket?select=' + fields +
        '&status_banding=in.(Diajukan,Diterima,Ditolak)&or=(cabang.eq.Kendari,cabang.eq.Raha,cabang.is.null)' +
        '&order=klaim_sales_diajukan_pada.desc.nullslast,id_tiket.asc&limit=500&offset=' + rows.length, 'get', null);
      if (!Array.isArray(page)) throw new Error('Respons daftar klaim tidak valid.');
      rows = rows.concat(page);
    } while (page.length === 500);
    return { status: 'sukses', data: rows };
  }
  var id = String(data.idTiket || '').trim();
  var cabang = normalisasiCabangOperasional_(data.cabang);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || !cabang) throw new Error('ID tiket atau cabang tidak valid.');
  if (action === 'getBuktiKlaimSales') {
    if (!admin) throw new Error('Bukti klaim hanya dapat diakses oleh Admin Kendari.');
    var filterCabang = cabang === 'Kendari' ? '&or=(cabang.eq.Kendari,cabang.is.null)' : '&cabang=eq.Raha';
    var buktiRows = callSupabaseServiceRole_('tiket?id_tiket=eq.' + encodeURIComponent(id) + filterCabang +
      '&status_banding=in.(Diajukan,Diterima,Ditolak)&select=bukti_banding&limit=2', 'get', null);
    if (!Array.isArray(buktiRows) || buktiRows.length !== 1) throw new Error('Pengajuan klaim tidak ditemukan atau ambigu.');
    return { status: 'sukses', data: String(buktiRows[0].bukti_banding || '') };
  }
  var rpc, payload = { p_actor: aktor.username_login, p_id_tiket: id, p_cabang: cabang };
  if (action === 'ajukanBanding') {
    if (String(aktor.role || '').trim().toLowerCase() !== 'sales') throw new Error('Hanya Sales dapat mengajukan klaim.');
    payload.p_keterangan = String(data.keteranganSales || '').trim();
    payload.p_bukti = String(data.buktiBanding || '');
    var foto = payload.p_bukti.split('|#|');
    if (foto.length < 1 || foto.length > 3 || payload.p_bukti.length > 3500000 ||
        foto.some(function(item) { return !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item); })) {
      throw new Error('Unggah 1 sampai 3 foto bukti yang valid (maksimal total 3,5 MB).');
    }
    if (payload.p_keterangan.length > 3000) throw new Error('Keterangan maksimal 3000 karakter.');
    rpc = 'sla_ajukan_klaim_sales';
  } else if (action === 'responBanding') {
    if (!admin) throw new Error('Hanya Admin Kendari dapat menerima atau menolak klaim.');
    payload.p_keputusan = String(data.statusBanding || '').trim();
    payload.p_alasan = String(data.alasanAdmin || '').trim();
    if (['Diterima', 'Ditolak'].indexOf(payload.p_keputusan) === -1) throw new Error('Keputusan klaim tidak valid.');
    if (payload.p_keputusan === 'Ditolak' && !payload.p_alasan) throw new Error('Alasan penolakan wajib diisi.');
    if (payload.p_alasan.length > 3000) throw new Error('Alasan maksimal 3000 karakter.');
    rpc = 'sla_respon_klaim_sales';
  } else { throw new Error('Action klaim tidak dikenal.'); }

  // Database mengunci tiket dan menyimpan perubahan + antrean WA dalam satu transaksi.
  // Nama Sales serta penerima WA tidak pernah diambil dari payload browser.
  var result = callSupabaseServiceRole_('rpc/' + rpc, 'post', payload);
  if (!result || !result.klaim_id) throw new Error('Respons penyimpanan klaim tidak valid.');
  var notif;
  try { notif = prosesAntreanNotifKlaimSales_(result.klaim_id); }
  catch (error) {
    console.error('Notifikasi klaim tersimpan untuk dicoba ulang: ' + error.message);
    notif = { terkirim: 0, gagal: 1, tertunda: true };
  }
  return { status: 'sukses', klaim: result, notifikasi: notif };
}

function pesanNotifKlaimSales_(event) {
  var t = event.snapshot || {};
  var pembuka = event.jenis === 'Diajukan'
    ? '📌 *PENGAJUAN KLAIM SALES*\n\nAssalamu\'alaikum Admin Kendari, ada pengajuan klaim baru.'
    : '📌 *HASIL KLAIM SALES*\n\nAssalamu\'alaikum, pengajuan klaim Anda telah *' + event.jenis.toUpperCase() + '* oleh Admin Kendari.';
  var pesan = pembuka + '\n\nCabang: *' + (t.cabang || 'Kendari') + '*\nTiket: *' + t.id_tiket +
    '*\nSales Pengaju: *' + (t.sales || '-') + '*\nKlien: ' + (t.klien || '-') + '\nPekerjaan: ' + (t.pekerjaan || '-');
  if (event.jenis === 'Diajukan' && t.keterangan) pesan += '\nKeterangan Sales: ' + t.keterangan;
  if (event.jenis === 'Ditolak') pesan += '\nAlasan penolakan: ' + (t.alasan || '-');
  return pesan + (event.jenis === 'Diajukan'
    ? '\n\nBuka menu *Klaim Sales* di lobby untuk meninjau bukti dan memutuskan pengajuan.'
    : '\n\nSilakan lihat status pada tiket di SLA cabang terkait.') + '\nhttps://aplikasisla.vercel.app/';
}

function prosesAntreanNotifKlaimSales_(klaimId) {
  var lease = callSupabaseServiceRole_('rpc/sla_mulai_pengiriman_klaim_sales', 'post', {});
  if (!lease) return { terkirim: 0, gagal: 0, tertunda: true };
  var hasil = { terkirim: 0, gagal: 0 };
  try {
    // Ambil satu event per iterasi agar pengajuan paralel dapat ikut dikuras.
    // Lease global + jeda sebelum setiap kirim menjaga jarak >= 2 detik,
    // termasuk antar-batch dan antar-deployment Kendari/Raha.
    for (var i = 0; i < 10; i++) {
      var events = callSupabaseServiceRole_('rpc/sla_ambil_notif_klaim_sales', 'post', { p_klaim_id: null });
      if (!Array.isArray(events)) throw new Error('Respons antrean notifikasi tidak valid.');
      if (!events.length) break;
      var event = events[0], berhasil = false, errorPesan = '';
      try {
        var rows = callSupabaseServiceRole_('users?username_login=eq.' + encodeURIComponent(event.penerima_username) +
          '&select=username_login,role,hak_akses_cabang,no_wa&limit=2', 'get', null);
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Akun penerima tidak ditemukan atau ambigu.');
        if (event.jenis === 'Diajukan' && !adminKendariUntukKlaim_(rows[0])) throw new Error('Penerima sudah bukan Admin Kendari.');
        var nomor = normalisasiNoWA_(rows[0].no_wa);
        if (!/^628\d{7,12}$/.test(nomor)) throw new Error('Nomor WA penerima belum valid.');
        Utilities.sleep(2000);
        var wa = hasilKirimNotifWA_(nomor, pesanNotifKlaimSales_(event));
        berhasil = Boolean(wa && wa.ok);
        errorPesan = berhasil ? '' : String((wa && wa.pesan) || 'Gateway WA menolak pesan.');
      } catch (error) { errorPesan = error.message || String(error); }
      callSupabaseServiceRole_('rpc/sla_selesaikan_notif_klaim_sales', 'post', {
        p_id: event.id, p_lease_id: event.lease_id, p_terkirim: berhasil, p_error: errorPesan
      });
      if (!klaimId || event.klaim_id === klaimId) {
        if (berhasil) hasil.terkirim++; else hasil.gagal++;
      }
    }
    if (klaimId) {
      var pending = callSupabaseServiceRole_('sla_notif_klaim_sales?klaim_id=eq.' + encodeURIComponent(klaimId) +
        '&terkirim_pada=is.null&select=id&limit=1', 'get', null);
      hasil.tertunda = !Array.isArray(pending) || pending.length > 0;
    }
    return hasil;
  } finally {
    callSupabaseServiceRole_('rpc/sla_akhiri_pengiriman_klaim_sales', 'post', { p_lease_id: lease });
  }
}

function kirimUlangNotifKlaimSales() {
  return prosesAntreanNotifKlaimSales_(null);
}

function pasangTriggerNotifKlaimSales() {
  if (cabangDeployment_() !== 'Kendari') throw new Error('Pasang trigger notifikasi terpusat hanya pada backend Kendari.');
  var sudahAda = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'kirimUlangNotifKlaimSales';
  });
  if (!sudahAda) ScriptApp.newTrigger('kirimUlangNotifKlaimSales').timeBased().everyMinutes(5).create();
  return { status: 'sukses', pesan: 'Antrean WA klaim diperiksa otomatis setiap 5 menit.' };
}
