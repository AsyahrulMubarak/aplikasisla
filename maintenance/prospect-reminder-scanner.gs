function getTglFollowUpTerakhir(tglInput, riwayatText) {
  var tgl = tglInput instanceof Date ? new Date(tglInput.getTime()) : new Date(tglInput);

  if (riwayatText && String(riwayatText).trim() !== "") {
    var matches = String(riwayatText).match(/\[(\d{2}\/\d{2}\/\d{4})/g);
    if (matches && matches.length > 0) {
      var lastMatch = matches[matches.length - 1].replace('[', '');
      var parts = lastMatch.split('/');
      var tahun = parseInt(parts[2], 10);
      var bulan = parseInt(parts[1], 10) - 1;
      var tanggal = parseInt(parts[0], 10);
      var tglDariRiwayat = new Date(tahun, bulan, tanggal);

      // Cegah tanggal tidak valid seperti 32/13/2026 dinormalisasi diam-diam oleh Date().
      if (tglDariRiwayat.getFullYear() === tahun &&
          tglDariRiwayat.getMonth() === bulan &&
          tglDariRiwayat.getDate() === tanggal) {
        tgl = tglDariRiwayat;
      }
    }
  }

  return tgl;
}

// Mengirim satu per satu dengan jeda agar loop scanner tidak membanjiri Fonnte.
function kirimNotifWAProspekDenganJeda_(nomorTujuan, pesan) {
  var berhasil = kirimNotifWA(nomorTujuan, pesan);
  Utilities.sleep(2000);
  return berhasil;
}

function statusProspekMenghentikanReminder_(status) {
  var nilai = String(status || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (nilai === 'proses servis' || nilai === 'proses service') nilai = 'on progress';
  return !nilai || /closing|batal|tanpa keterangan|on progress|pending/.test(nilai);
}

// Sheet dipakai scanner lama, sedangkan perubahan status aplikasi berada di Supabase.
// Verifikasi tepat sebelum peringatan/penutupan agar status lama tidak memicu pesan.
function bolehKirimReminderProspek_(idProspek, cabang) {
  var id = String(idProspek || '').trim();
  if (!id) return false;
  var filterCabang = cabang === 'Raha' ? '&cabang=eq.Raha' : '&or=(cabang.eq.Kendari,cabang.is.null)';
  try {
    var rows = callSupabaseServiceRole_('prospek?select=id_prospek,status_prospek,cabang&id_prospek=eq.' +
      encodeURIComponent(id) + filterCabang + '&limit=1');
    return Array.isArray(rows) && rows.length === 1 && String(rows[0].id_prospek) === id &&
      !statusProspekMenghentikanReminder_(rows[0].status_prospek);
  } catch (errorStatus) {
    console.error('Reminder prospek dilewati: status terbaru tidak dapat diverifikasi.');
    return false;
  }
}

function jalankanScannerProspek_(ss, usersData, now) {
  var sheetProspek = ss.getSheetByName("Prospek");
  if (!sheetProspek) return { status: "dilewati", pesan: "Sheet Prospek tidak ditemukan." };

  var dataProspek = sheetProspek.getDataRange().getValues();
  if (dataProspek.length < 2) return { status: "sukses", diperiksa: 0, terkirim: 0, hangus: 0 };

  var headerProspek = dataProspek[0] || [];
  var headerUsers = usersData[0] || [];
  var colNamaUser = headerUsers.indexOf("Nama Asli");
  var colWaUser = headerUsers.indexOf("No WA");
  var colIdProspek = headerProspek.indexOf("ID Prospek");
  var cabangReminder = cabangOperasional_();
  var colStatusProspek = headerProspek.indexOf("Status Prospek");
  var colWaktuFollowUp = headerProspek.indexOf("Waktu Follow Up Terakhir");
  var colRiwayatFollowUp = headerProspek.indexOf("Riwayat Follow Up");
  var colTanggalInput = headerProspek.indexOf("Tanggal Input");
  var colNamaCustomer = headerProspek.indexOf("Nama Calon Customer");
  var colKebutuhanProspek = headerProspek.indexOf("Kebutuhan");
  var colSalesProspek = headerProspek.indexOf("Sales Penanggung Jawab");

  if (colIdProspek === -1 || colNamaUser === -1 || colWaUser === -1 || colStatusProspek === -1 ||
      colTanggalInput === -1 || colSalesProspek === -1) {
    return { status: "gagal", pesan: "Header wajib Users/Prospek tidak lengkap." };
  }

  var colPeringatanCRM = headerProspek.indexOf("Waktu Peringatan CRM Terakhir");
  if (colPeringatanCRM === -1) {
    colPeringatanCRM = headerProspek.length;
    sheetProspek.getRange(1, colPeringatanCRM + 1).setValue("Waktu Peringatan CRM Terakhir");
    headerProspek.push("Waktu Peringatan CRM Terakhir");
  }

  var waMap = {};
  for (var u = 1; u < usersData.length; u++) {
    var namaUser = String(usersData[u][colNamaUser] || '').trim().toLowerCase();
    var noWaUser = String(usersData[u][colWaUser] || '').trim();
    if (namaUser && noWaUser) waMap[namaUser] = noWaUser;
  }

  var satuHariMs = 24 * 60 * 60 * 1000;
  var hariIni = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var jumlahDiperiksa = 0;
  var jumlahTerkirim = 0;
  var jumlahHangus = 0;
  var adaUpdateCRM = false;

  for (var p = 1; p < dataProspek.length; p++) {
    var rowProspek = dataProspek[p];
    var statusProspek = String(rowProspek[colStatusProspek] || '').trim();
    if (statusProspekMenghentikanReminder_(statusProspek)) continue;

    jumlahDiperiksa++;
    var nilaiTanggalInput = rowProspek[colTanggalInput];
    var riwayatFollowUp = colRiwayatFollowUp !== -1 ? rowProspek[colRiwayatFollowUp] : '';
    var nilaiWaktuAcuan = colWaktuFollowUp !== -1 && rowProspek[colWaktuFollowUp]
      ? rowProspek[colWaktuFollowUp]
      : nilaiTanggalInput;

    // Regex riwayat selalu menjadi sumber terbaru jika di dalamnya ada tanggal valid.
    var waktuAcuan = getTglFollowUpTerakhir(nilaiWaktuAcuan, riwayatFollowUp);
    if (!(waktuAcuan instanceof Date) || isNaN(waktuAcuan.getTime())) continue;

    var tanggalAcuan = new Date(waktuAcuan.getFullYear(), waktuAcuan.getMonth(), waktuAcuan.getDate());
    var bedaHari = Math.floor((hariIni.getTime() - tanggalAcuan.getTime()) / satuHariMs);
    if (bedaHari < 0) continue;
    // Pertahankan jadwal yang berlaku; sumber status terbaru wajib menyetujui pengiriman.
    if ((bedaHari >= 30 || (bedaHari > 0 && bedaHari % 3 === 0)) &&
        !bolehKirimReminderProspek_(rowProspek[colIdProspek], cabangReminder)) continue;

    var namaCustomerProspek = colNamaCustomer !== -1 ? String(rowProspek[colNamaCustomer] || '-') : '-';
    var kebutuhanProspek = colKebutuhanProspek !== -1 ? String(rowProspek[colKebutuhanProspek] || '-') : '-';
    var salesProspekStr = String(rowProspek[colSalesProspek] || '');
    var daftarSalesProspek = salesProspekStr.split(',');
    var daftarWaProspek = [];

    for (var s = 0; s < daftarSalesProspek.length; s++) {
      var namaSalesProspek = daftarSalesProspek[s].trim().toLowerCase();
      var noWaSales = waMap[namaSalesProspek];
      if (namaSalesProspek && noWaSales && daftarWaProspek.indexOf(noWaSales) === -1) {
        daftarWaProspek.push(noWaSales);
      }
    }

    if (bedaHari >= 30) {
      sheetProspek.getRange(p + 1, colStatusProspek + 1).setValue("Tanpa Keterangan");
      adaUpdateCRM = true;
      jumlahHangus++;

      var pesanProspekHangus = "⚠️ PROSPEK HANGUS (30 HARI) ⚠️\n\nAssalamu'alaikum,\nProspek atas nama " + namaCustomerProspek + " dibatalkan otomatis oleh sistem karena sudah 30 hari tidak ada follow-up/kejelasan.";
      for (var h = 0; h < daftarWaProspek.length; h++) {
        if (kirimNotifWAProspekDenganJeda_(daftarWaProspek[h], pesanProspekHangus)) jumlahTerkirim++;
      }
      continue;
    }

    if (bedaHari > 0 && bedaHari % 3 === 0 && daftarWaProspek.length > 0) {
      var nilaiPeringatanTerakhir = rowProspek[colPeringatanCRM];
      var sudahDiperingatiHariIni = false;
      if (nilaiPeringatanTerakhir) {
        var waktuPeringatanTerakhir = nilaiPeringatanTerakhir instanceof Date
          ? nilaiPeringatanTerakhir
          : new Date(nilaiPeringatanTerakhir);
        if (!isNaN(waktuPeringatanTerakhir.getTime())) {
          sudahDiperingatiHariIni = Utilities.formatDate(waktuPeringatanTerakhir, "Asia/Makassar", "yyyy-MM-dd") ===
            Utilities.formatDate(now, "Asia/Makassar", "yyyy-MM-dd");
        }
      }

      if (!sudahDiperingatiHariIni) {
        var pesanFollowUpCRM = "⏰ WAKTUNYA FOLLOW UP CRM ⏰\n\nAssalamu'alaikum, sudah " + bedaHari + " hari Anda belum mem-follow up prospek:\n\n👤 Nama: " + namaCustomerProspek + "\n📦 Kebutuhan: " + kebutuhanProspek + "\n\nSegera hubungi klien dan catat hasilnya di Aplikasi!";
        var seluruhTujuanBerhasil = true;

        for (var w = 0; w < daftarWaProspek.length; w++) {
          if (kirimNotifWAProspekDenganJeda_(daftarWaProspek[w], pesanFollowUpCRM)) {
            jumlahTerkirim++;
          } else {
            seluruhTujuanBerhasil = false;
          }
        }

        // Jika Fonnte gagal/rate-limit, jangan tandai sukses agar scanner dapat mencoba ulang.
        if (seluruhTujuanBerhasil) {
          sheetProspek.getRange(p + 1, colPeringatanCRM + 1).setValue(now);
          adaUpdateCRM = true;
        }
      }
    }
  }

  if (adaUpdateCRM) SpreadsheetApp.flush();
  return { status: "sukses", diperiksa: jumlahDiperiksa, terkirim: jumlahTerkirim, hangus: jumlahHangus };
}
