    if (data.action === 'getDaftarPengajuan' || data.action === 'getRiwayatPengajuan') {
      if (!punyaHakKelola) return buatOutputJson_({ status: 'gagal', pesan: 'Akses Ditolak: Approval absensi khusus Manajemen.' });

      var endpointCuti = data.action === 'getDaftarPengajuan'
        ? 'pengajuan_cuti?status=eq.Menunggu&order=waktu_pengajuan.desc'
        : 'pengajuan_cuti?status=neq.Menunggu&order=waktu_disetujui.desc&limit=50';
      var dbCuti = callSupabase_(SUPABASE_URL + endpointCuti);
      if (data.action === 'getDaftarPengajuan') {
        dbCuti = dbCuti.filter(function(row) { return bolehMemutuskanPengajuan_(userLogin, row); });
      }

      var resCuti = dbCuti.map(function(row) {
        return {
          "ID Pengajuan": row.id_pengajuan, "Waktu Pengajuan": row.waktu_pengajuan, "Nama Pegawai": row.nama_pegawai, "Role": row.role,
          "Jenis (Sakit/Izin)": row.jenis, "Tanggal Mulai": row.tanggal_mulai, "Selesai": row.tanggal_selesai, "Kembali Bekerja": row.kembali_bekerja_pada || null, "Alasan": row.alasan,
          "Bukti Foto": row.bukti_foto, "Status (Menunggu/Disetujui/Ditolak)": row.status, "Disetujui Oleh": row.disetujui_oleh, "Waktu Disetujui": row.waktu_disetujui
        };
      });
      return buatOutputJson_({ status: 'sukses', data: resCuti });
    }

    // ----------------------------------------------------
    // MENU: AJUKAN SAKIT / IZIN
    // ----------------------------------------------------
    if (data.action === 'ajukanSakitIzin') {
      var jenis = (data.jenis || '').trim();
      var tanggalMulai = String(data.tanggalMulai || '').trim();
      var tanggalSelesai = jenis === 'Sakit' ? null : String(data.selesai || '').trim();
      var alasanPengajuan = String(data.alasan || '').trim();
      if (['Sakit', 'Izin'].indexOf(jenis) === -1) return buatOutputJson_({ status: 'gagal', pesan: "Jenis pengajuan tidak valid." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai) || (jenis === 'Izin' && (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesai) || tanggalSelesai < tanggalMulai))) {
        return buatOutputJson_({ status: 'gagal', pesan: "Rentang tanggal pengajuan tidak valid." });
      }
      if (!alasanPengajuan) return buatOutputJson_({ status: 'gagal', pesan: "Alasan pengajuan wajib diisi." });
      if (!data.buktiFotoBase64 || String(data.buktiFotoBase64).length <= 50) {
        return buatOutputJson_({ status: 'gagal', pesan: "Bukti foto pengajuan wajib dilampirkan." });
      }

      var linkBukti = "";
      if (data.buktiFotoBase64 && data.buktiFotoBase64.length > 50) {
        var folder = DriveApp.getFolderById(FOLDER_DRIVE_ID);
        var splitBase = data.buktiFotoBase64.split(',');
        var contentType = splitBase[0].split(';')[0].replace('data:', '');
        var byteCharacters = Utilities.base64Decode(splitBase[1]);
        var blob = Utilities.newBlob(byteCharacters, contentType, "Cuti_" + userLogin.namaAsli + "_" + new Date().getTime() + ".jpg");
        var file = folder.createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        linkBukti = file.getUrl();
      }

      var idPengajuan = "PGJ-" + Utilities.formatDate(new Date(), "Asia/Makassar", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().substring(0, 5).toUpperCase();
      callSupabase_(SUPABASE_URL + 'pengajuan_cuti', 'POST', {
        id_pengajuan: idPengajuan, waktu_pengajuan: new Date().toISOString(), nama_pegawai: userLogin.namaAsli, role: userLogin.role,
        jenis: jenis, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai, alasan: alasanPengajuan, bukti_foto: linkBukti, status: 'Menunggu'
      });

      // WA hanya diberikan kepada pihak yang berhak memutuskan pengajuan ini.
      var semuaUsers = callSupabase_(SUPABASE_URL + 'users?select=role,no_wa,hak_akses_cabang');
      var waAtasan = semuaUsers.filter(function(u) { return bolehMemutuskanPengajuan_(u, userLogin) && u.no_wa; }).map(function(u) { return normalisasiNoWA_(u.no_wa); });
      var noWAPengaju = normalisasiNoWA_(userLogin.noWA);
      var kontakPengaju = /^\d{8,15}$/.test(noWAPengaju) ? '\nWA Pengaju: +' + noWAPengaju + '\nHubungi Pengaju: https://wa.me/' + noWAPengaju : '\nWA Pengaju: belum terdaftar';
      var pesanWA = "🚨 PENGAJUAN SAKIT/IZIN BARU\n\nNama: " + userLogin.namaAsli + kontakPengaju + "\nJenis: " + jenis + "\nAlasan: " + alasanPengajuan + "\n\nMohon tinjau dan berikan persetujuan via sistem SLA.\n\nBuka aplikasi: https://aplikasisla.vercel.app/\nSetelah login, pilih Absensi > Approval Pengajuan.";
      kirimBroadcastFonnte_(waAtasan, pesanWA);

      return buatOutputJson_({ status: 'sukses', pesan: 'Pengajuan berhasil disimpan dan menunggu approval.' });
    }

    // ----------------------------------------------------
    // MENU: RESPON PENGAJUAN CUTI (APPROVAL)
    // ----------------------------------------------------
    if (data.action === 'responPengajuan') {
      if (!punyaHakKelola) return buatOutputJson_({ status: 'gagal', pesan: 'Akses Ditolak: hanya Manajemen yang dapat memutuskan pengajuan.' });
      var keputusan = String(data.keputusan || '').trim();
      var idPengajuan = data.idPengajuan;
      if (['Disetujui', 'Ditolak'].indexOf(keputusan) === -1) return buatOutputJson_({ status: 'gagal', pesan: "Keputusan tidak valid." });

      var dbPengajuan = callSupabase_(SUPABASE_URL + 'pengajuan_cuti?id_pengajuan=eq.' + encodeURIComponent(idPengajuan));
      if (!dbPengajuan || dbPengajuan.length === 0) return buatOutputJson_({ status: 'gagal', pesan: "ID Pengajuan tidak ditemukan." });
      var targetCuti = dbPengajuan[0];
      if (!bolehMemutuskanPengajuan_(userLogin, targetCuti)) return buatOutputJson_({ status: 'gagal', pesan: 'Akses Ditolak: Anda tidak berhak memutuskan pengajuan ini.' });
      if (String(targetCuti.status || '') !== 'Menunggu') return buatOutputJson_({ status: 'gagal', pesan: 'Pengajuan ini sudah diputuskan sebelumnya.' });

      // Catatan harian dibentuk saat pembacaan dari rentang efektif pengajuan.
      // Trigger database menetapkan waktu kembali, termasuk jika approval terlambat.
      callSupabase_(SUPABASE_URL + 'pengajuan_cuti?id_pengajuan=eq.' + encodeURIComponent(idPengajuan), 'PATCH', {
        status: keputusan, disetujui_oleh: userLogin.namaAsli, waktu_disetujui: new Date().toISOString()
      });

      return buatOutputJson_({ status: 'sukses', pesan: "Pengajuan berhasil " + keputusan.toLowerCase() + " oleh " + userLogin.namaAsli });
    }
