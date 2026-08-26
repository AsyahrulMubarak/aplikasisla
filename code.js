// ==========================================
// MESIN MATEMATIKA SLA JAM KERJA (REVISI V2)
// 100% Sinkron dengan Sensor Jeda Ibadah
// ==========================================
function normalisasiCabangOperasional_(nilai) {
  var cabang = String(nilai || '').trim().toLowerCase();
  if (cabang === 'raha') return 'Raha';
  if (cabang === 'kendari') return 'Kendari';
  return '';
}

function cabangOperasional_(nilai) {
  var cabang = normalisasiCabangOperasional_(nilai);
  if (cabang) return cabang;
  var properties = PropertiesService.getScriptProperties();
  cabang = normalisasiCabangOperasional_(properties.getProperty('CABANG_AKTIF') || properties.getProperty('CABANG_DEFAULT'));
  if (!cabang) {
    try {
      var namaSpreadsheet = String(SpreadsheetApp.getActiveSpreadsheet().getName() || '').toLowerCase();
      if (namaSpreadsheet.indexOf('raha') !== -1) cabang = 'Raha';
      else if (namaSpreadsheet.indexOf('kendari') !== -1) cabang = 'Kendari';
    } catch (errorCabang) {
      // Konteks tanpa spreadsheet (misalnya unit test) tetap aman memakai Kendari.
    }
  }
  return cabang || 'Kendari';
}

function jamOperasionalCabang_(cabang) {
  return { mulai: 8, selesai: cabangOperasional_(cabang) === 'Raha' ? 20 : 17 };
}

function roleAdminUntukCabang_(cabang) {
  return cabangOperasional_(cabang) === 'Raha' ? 'admin_raha' : 'admin';
}

function pastikanKolomAkhir_(sheet, headers, namaKolom) {
  var indexKolom = headers.indexOf(namaKolom);
  if (indexKolom === -1) {
    indexKolom = headers.length;
    sheet.getRange(1, indexKolom + 1).setValue(namaKolom);
    headers.push(namaKolom);
  }
  return indexKolom;
}

function cabangDariBaris_(row, headers, fallbackCabang) {
  var colCabang = headers.indexOf('Cabang');
  var cabangBaris = colCabang !== -1 ? normalisasiCabangOperasional_(row[colCabang]) : '';
  return cabangOperasional_(cabangBaris || fallbackCabang);
}

function cariCabangTiketById_(sheetTiket, idTiket, fallbackCabang) {
  if (!sheetTiket || !idTiket) return cabangOperasional_(fallbackCabang);
  var dataTiket = sheetTiket.getDataRange().getValues();
  var headers = dataTiket[0] || [];
  for (var i = 1; i < dataTiket.length; i++) {
    if (String(dataTiket[i][0] || '').trim() === String(idTiket).trim()) {
      return cabangDariBaris_(dataTiket[i], headers, fallbackCabang);
    }
  }
  return cabangOperasional_(fallbackCabang);
}

function kirimNotifKeAdminCabang_(usersData, cabang, pesan) {
  if (!usersData || usersData.length < 2) return 0;
  var headers = usersData[0] || [];
  var colRole = headers.indexOf('Role');
  var colWA = headers.indexOf('No WA');
  if (colRole === -1 || colWA === -1) return 0;
  var roleTarget = roleAdminUntukCabang_(cabang);
  var terkirim = 0;
  for (var i = 1; i < usersData.length; i++) {
    var role = String(usersData[i][colRole] || '').trim().toLowerCase();
    var nomor = String(usersData[i][colWA] || '').trim();
    if (role === roleTarget && nomor && kirimNotifWA(nomor, pesan)) terkirim++;
  }
  return terkirim;
}

function hitungTenggatJamKerja(waktuMulai, durasiJam, cabang) {
  var jamOperasional = jamOperasionalCabang_(cabang);
  var dt = new Date(waktuMulai.getTime());
  var msSisa = durasiJam * 3600 * 1000;

  // Looping menit demi menit untuk akurasi mutlak yang sama dengan Mesin B
  while (msSisa > 0) {
    var hari = dt.getDay();
    var jam = dt.getHours();
    var menit = dt.getMinutes();

    // 1. Lewati hari Ahad (0 = Ahad)
    if (hari === 0) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(8, 0, 0, 0);
      continue;
    }

    // 2. Lewati waktu sebelum jam kerja (00.00 - 07.59)
    if (jam < jamOperasional.mulai) {
      dt.setHours(jamOperasional.mulai, 0, 0, 0);
      continue;
    }

    // 3. Lewati waktu setelah jam kerja cabang (Raha 20.00, Kendari 17.00)
    if (jam >= jamOperasional.selesai) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(jamOperasional.mulai, 0, 0, 0);
      continue;
    }

    var waktuIstirahat = false;

    // 4. Sensor Jeda Sholat Dzuhur (12.00 - 13.29)
    if (jam === 12 || (jam === 13 && menit < 30)) {
      waktuIstirahat = true;
    }

    // 5. Sensor Jeda Sholat Ashar (15.00 - 15.59)
    if (jam === 15) {
      waktuIstirahat = true;
    }

    // 6. Jika menit ini BUKAN waktu istirahat, kurangi sisa waktu SLA (Argo Berjalan)
    if (!waktuIstirahat) {
      var stepMs = 60000; // 1 Menit = 60.000 ms
      if (msSisa < stepMs) {
        dt.setTime(dt.getTime() + msSisa);
        msSisa = 0;
        break; // Selesai
      } else {
        msSisa -= stepMs;
      }
    }

    // Maju 1 menit ke depan
    dt.setTime(dt.getTime() + 60000);
  }

  return dt;
}

function hitungDurasiJamKerjaMs(waktuMulai, waktuSelesai, cabang) {
  var jamOperasional = jamOperasionalCabang_(cabang);
  var start = new Date(waktuMulai).getTime();
  var end = new Date(waktuSelesai).getTime();
  
  if (start >= end) return 0;
  
  var totalMs = 0;
  var current = new Date(start);
  
  // Looping menit demi menit untuk pembacaan jeda waktu yang akurat
  while (current.getTime() < end) {
    var hari = current.getDay();
    var jam = current.getHours();
    var menit = current.getMinutes();
    
    // 1. Lewati hari Ahad (0 = Ahad)
    if (hari !== 0) {
      
      // 2. Jam aktif mengikuti cabang tiket.
      if (jam >= jamOperasional.mulai && jam < jamOperasional.selesai) {
        
        var waktuIstirahat = false;
        
        // 3. Sensor Jeda Sholat Dzuhur (12.00 - 13.29)
        if (jam === 12 || (jam === 13 && menit < 30)) {
          waktuIstirahat = true;
        }
        
        // 4. Sensor Jeda Sholat Ashar (15.00 - 15.59)
        if (jam === 15) {
          waktuIstirahat = true;
        }
        
        // Jika menit ini bukan waktu istirahat, tambahkan ke total waktu (1 menit = 60.000 ms)
        if (!waktuIstirahat) {
          totalMs += 60000;
        }
      }
    }
    
    // Maju 1 menit ke depan
    current.setTime(current.getTime() + 60000);
  }
  
  return totalMs;
}

// ==========================================
// FUNGSI PENGIRIMAN WHATSAPP (FONNTE GATEWAY)
// ==========================================
function kirimNotifWA(nomorTujuan, pesan) {
  if (!nomorTujuan || nomorTujuan === "" || nomorTujuan === "-") return false;
  var tokenWA = PropertiesService.getScriptProperties().getProperty("FONNTE_TOKEN");
  if (!tokenWA) {
    console.error("Konfigurasi FONNTE_TOKEN belum tersedia di Script Properties.");
    return false;
  }
  var options = { "method": "post", "headers": { "Authorization": tokenWA }, "payload": { "target": nomorTujuan, "message": pesan, "delay": "2" }, "muteHttpExceptions": true };
  try {
    var response = UrlFetchApp.fetch("https://api.fonnte.com/send", options);
    var responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      console.error("Fonnte menolak pengiriman WA. HTTP " + responseCode + ": " + response.getContentText());
      return false;
    }

    // Fonnte dapat mengembalikan HTTP 200 tetapi status payload-nya gagal.
    var responseText = response.getContentText();
    try {
      var responseJson = JSON.parse(responseText);
      if (Object.prototype.hasOwnProperty.call(responseJson, "status") && responseJson.status !== true) {
        console.error("Fonnte gagal memproses pengiriman WA: " + responseText);
        return false;
      }
    } catch (parseError) {
      // Respons sukses lama/non-JSON tetap dianggap berhasil berdasarkan HTTP 2xx.
    }
    return true;
  } catch(e) {
    console.error("Gagal mengirim notifikasi WA: " + e.toString());
    return false;
  }
}

// Mengambil tanggal follow-up paling akhir dari riwayat, bukan dari format teks utuh.
// Contoh entri yang dikenali: [19/08/2026 09:15] ...
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

function jalankanScannerProspek_(ss, usersData, now) {
  var sheetProspek = ss.getSheetByName("Prospek");
  if (!sheetProspek) return { status: "dilewati", pesan: "Sheet Prospek tidak ditemukan." };

  var dataProspek = sheetProspek.getDataRange().getValues();
  if (dataProspek.length < 2) return { status: "sukses", diperiksa: 0, terkirim: 0, hangus: 0 };

  var headerProspek = dataProspek[0] || [];
  var headerUsers = usersData[0] || [];
  var colNamaUser = headerUsers.indexOf("Nama Asli");
  var colWaUser = headerUsers.indexOf("No WA");
  var colStatusProspek = headerProspek.indexOf("Status Prospek");
  var colWaktuFollowUp = headerProspek.indexOf("Waktu Follow Up Terakhir");
  var colRiwayatFollowUp = headerProspek.indexOf("Riwayat Follow Up");
  var colTanggalInput = headerProspek.indexOf("Tanggal Input");
  var colNamaCustomer = headerProspek.indexOf("Nama Calon Customer");
  var colKebutuhanProspek = headerProspek.indexOf("Kebutuhan");
  var colSalesProspek = headerProspek.indexOf("Sales Penanggung Jawab");

  if (colNamaUser === -1 || colWaUser === -1 || colStatusProspek === -1 ||
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
    var statusProspekLower = statusProspek.toLowerCase();
    if (statusProspekLower.indexOf('closing') !== -1 ||
        statusProspekLower.indexOf('batal') !== -1 ||
        statusProspekLower.indexOf('proses servis') !== -1 ||
        statusProspekLower.indexOf('tanpa keterangan') !== -1) continue;

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

// Fungsi publik untuk Time-driven Trigger harian khusus reminder Prospek.
function cekReminderProspek() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "dilewati", pesan: "Scanner lain masih berjalan." };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetUsers = ss.getSheetByName("Users");
    if (!sheetUsers) return { status: "dilewati", pesan: "Sheet Users tidak ditemukan." };
    return jalankanScannerProspek_(ss, sheetUsers.getDataRange().getValues(), new Date());
  } finally {
    lock.releaseLock();
  }
}

// Jalankan satu kali dari Apps Script untuk memasang ulang trigger pukul 07:00-08:00 WITA.
function pasangTriggerScannerProspekHarian() {
  var namaFungsi = "cekReminderProspek";
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === namaFungsi) ScriptApp.deleteTrigger(triggers[i]);
  }

  var trigger = ScriptApp.newTrigger(namaFungsi)
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone("Asia/Makassar")
    .create();

  return {
    status: "sukses",
    fungsi: namaFungsi,
    jadwal: "Setiap hari antara 07:00-08:00 Asia/Makassar",
    triggerId: trigger.getUniqueId()
  };
}

// =======================================================
// REVISI SURAT PENAWARAN: RESTART SLA ADMIN MENJADI 3 JAM
// =======================================================
function prosesRevisiSPBackend(idProspek, catatan, namaSales) {
  var idProspekBersih = String(idProspek || '').trim();
  var catatanBersih = String(catatan || '').trim();
  var namaSalesBersih = String(namaSales || '-').trim();

  if (idProspekBersih === '') throw new Error('ID Prospek wajib diisi.');
  if (catatanBersih === '') throw new Error('Catatan revisi wajib diisi.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetProspek = ss.getSheetByName('Prospek');
  if (!sheetProspek) throw new Error('Sheet Prospek tidak ditemukan.');

  var dataProspek = sheetProspek.getDataRange().getValues();
  var headerProspek = dataProspek[0] || [];
  var colIdProspek = headerProspek.indexOf('ID Prospek');
  var colStatusProspek = headerProspek.indexOf('Status Prospek');
  if (colIdProspek === -1 || colStatusProspek === -1) throw new Error('Kolom utama Prospek tidak lengkap.');

  function pastikanKolomProspek(namaKolom) {
    var indexKolom = headerProspek.indexOf(namaKolom);
    if (indexKolom === -1) {
      indexKolom = headerProspek.length;
      sheetProspek.getRange(1, indexKolom + 1).setValue(namaKolom);
      headerProspek.push(namaKolom);
    }
    return indexKolom;
  }

  var colWaktuMinta = pastikanKolomProspek('Waktu Minta Penawaran');
  var colWaktuSelesai = pastikanKolomProspek('Waktu Selesai Penawaran');
  var colTargetSLA = pastikanKolomProspek('Target SLA Penawaran (Jam)');
  var colCatatanRevisi = pastikanKolomProspek('Catatan Revisi SP');
  var colWaktuRevisi = pastikanKolomProspek('Waktu Revisi SP');

  var barisProspek = -1;
  for (var i = 1; i < dataProspek.length; i++) {
    if (String(dataProspek[i][colIdProspek] || '').trim() === idProspekBersih) {
      barisProspek = i + 1;
      break;
    }
  }
  if (barisProspek === -1) throw new Error('ID Prospek tidak ditemukan.');

  var waktuRevisi = new Date();
  var catatanUntukSheet = /^[=+\-@]/.test(catatanBersih) ? "'" + catatanBersih : catatanBersih;
  sheetProspek.getRange(barisProspek, colStatusProspek + 1).setValue('Revisi SP');
  sheetProspek.getRange(barisProspek, colWaktuMinta + 1).setValue(waktuRevisi);
  sheetProspek.getRange(barisProspek, colWaktuSelesai + 1).setValue('');
  sheetProspek.getRange(barisProspek, colTargetSLA + 1).setValue(3);
  sheetProspek.getRange(barisProspek, colCatatanRevisi + 1).setValue(catatanUntukSheet).setWrap(true);
  sheetProspek.getRange(barisProspek, colWaktuRevisi + 1).setValue(waktuRevisi);

  var pesanAdmin = "⚠️ *REVISI SURAT PENAWARAN*\n\nBismillah. Sales " + namaSalesBersih + " meminta revisi SP untuk prospek " + idProspekBersih + ".\n\n*Catatan Revisi:* " + catatanBersih + "\n\n⏱️ *SLA Revisi: 3 Jam*. Mohon segera diproses!";
  var sheetUsers = ss.getSheetByName('Users');
  var dataUsers = sheetUsers ? sheetUsers.getDataRange().getValues() : [];
  var headerUsers = dataUsers[0] || [];
  var colRoleUsers = headerUsers.indexOf('Role');
  var colWaUsers = headerUsers.indexOf('No WA');

  if (colRoleUsers !== -1 && colWaUsers !== -1) {
    for (var u = 1; u < dataUsers.length; u++) {
      if (String(dataUsers[u][colRoleUsers] || '').trim().toLowerCase() === 'admin') {
        var noWaAdmin = String(dataUsers[u][colWaUsers] || '').trim();
        if (noWaAdmin !== '') kirimNotifWA(noWaAdmin, pesanAdmin);
      }
    }
  }

  SpreadsheetApp.flush();
  return true;
}

// =======================================================
// DATA VARIABEL PAYROLL BULANAN (TERPISAH DARI PROFIL USERS)
// =======================================================
function getAtauBuatSheetPayrollBulanan_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Payroll Bulanan');
  var headerWajib = [
    'Kunci Payroll', 'Periode', 'Nama Pegawai', 'Fee Marketing', 'Kasbon',
    'Tanggal Luar Kota', 'Diperbarui Pada', 'Diperbarui Oleh'
  ];

  if (!sheet) sheet = ss.insertSheet('Payroll Bulanan');
  var headerAktual = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  headerWajib.forEach(function(namaKolom) {
    if (headerAktual.indexOf(namaKolom) === -1) {
      headerAktual.push(namaKolom);
      sheet.getRange(1, headerAktual.length).setValue(namaKolom);
    }
  });

  sheet.setFrozenRows(1);
  return { sheet: sheet, header: headerAktual };
}

function normalisasiTanggalLuarKota_(nilai) {
  var tanggalUnik = {};
  String(nilai || '').split(',').forEach(function(item) {
    var tanggal = parseInt(String(item).trim(), 10);
    if (!isNaN(tanggal) && tanggal >= 1 && tanggal <= 31) tanggalUnik[tanggal] = true;
  });
  return Object.keys(tanggalUnik).map(Number).sort(function(a, b) { return a - b; }).join(', ');
}

function ambilVariabelPayrollBackend(periode, namaPegawai) {
  var periodeBersih = String(periode || '').trim();
  var namaFilter = String(namaPegawai || '').trim().toLowerCase();
  if (!/^\d{4}-\d{2}$/.test(periodeBersih)) throw new Error('Format periode payroll tidak valid.');

  var payroll = getAtauBuatSheetPayrollBulanan_();
  var data = payroll.sheet.getDataRange().getValues();
  var header = data[0] || payroll.header;
  var colKunci = header.indexOf('Kunci Payroll');
  var colPeriode = header.indexOf('Periode');
  var colNama = header.indexOf('Nama Pegawai');
  var colFee = header.indexOf('Fee Marketing');
  var colKasbon = header.indexOf('Kasbon');
  var colLuarKota = header.indexOf('Tanggal Luar Kota');
  var colDiperbarui = header.indexOf('Diperbarui Pada');
  var colOleh = header.indexOf('Diperbarui Oleh');
  var hasil = [];

  for (var i = 1; i < data.length; i++) {
    var periodeBaris = String(data[i][colPeriode] || '').trim();
    var namaBaris = String(data[i][colNama] || '').trim();
    if (periodeBaris !== periodeBersih) continue;
    if (namaFilter !== '' && namaBaris.toLowerCase() !== namaFilter) continue;

    hasil.push({
      kunci: String(data[i][colKunci] || ''),
      periode: periodeBaris,
      namaPegawai: namaBaris,
      fee: parseFloat(data[i][colFee]) || 0,
      kasbon: parseFloat(data[i][colKasbon]) || 0,
      luarKota: String(data[i][colLuarKota] || ''),
      diperbaruiPada: data[i][colDiperbarui] || '',
      diperbaruiOleh: String(data[i][colOleh] || '')
    });
  }
  return hasil;
}

function simpanVariabelPayrollBackend(periode, namaPegawai, fee, kasbon, luarKota, diubahOleh) {
  var periodeBersih = String(periode || '').trim();
  var namaBersih = String(namaPegawai || '').trim();
  var aktorBersih = String(diubahOleh || '-').trim();
  if (!/^\d{4}-\d{2}$/.test(periodeBersih)) throw new Error('Format periode payroll tidak valid.');
  if (namaBersih === '') throw new Error('Nama pegawai wajib diisi.');

  // Kunci server-side: UI yang dimanipulasi tetap tidak dapat mengubah bulan lampau.
  var periodeSekarang = Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM');
  if (periodeBersih < periodeSekarang) throw new Error('Periode payroll yang sudah lewat telah dikunci.');

  var feeBersih = Math.max(0, parseFloat(fee) || 0);
  var kasbonBersih = Math.max(0, parseFloat(kasbon) || 0);
  var luarKotaBersih = normalisasiTanggalLuarKota_(luarKota);
  var kunciPayroll = periodeBersih + '_' + namaBersih.toLowerCase();
  var waktuUpdate = new Date();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var payroll = getAtauBuatSheetPayrollBulanan_();
    var sheet = payroll.sheet;
    var header = payroll.header;
    var data = sheet.getDataRange().getValues();
    var colKunci = header.indexOf('Kunci Payroll');
    var colPeriode = header.indexOf('Periode');
    var colNama = header.indexOf('Nama Pegawai');
    var colFee = header.indexOf('Fee Marketing');
    var colKasbon = header.indexOf('Kasbon');
    var colLuarKota = header.indexOf('Tanggal Luar Kota');
    var colDiperbarui = header.indexOf('Diperbarui Pada');
    var colOleh = header.indexOf('Diperbarui Oleh');
    var barisTarget = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colKunci] || '').trim().toLowerCase() === kunciPayroll) {
        barisTarget = i + 1;
        break;
      }
    }

    var nilaiLama = { fee: 0, kasbon: 0, luarKota: '' };
    var jenisPerubahan = 'CREATE';
    if (barisTarget === -1) {
      var barisBaru = new Array(header.length).fill('');
      barisBaru[colKunci] = kunciPayroll;
      barisBaru[colPeriode] = periodeBersih;
      barisBaru[colNama] = namaBersih;
      barisBaru[colFee] = feeBersih;
      barisBaru[colKasbon] = kasbonBersih;
      barisBaru[colLuarKota] = luarKotaBersih;
      barisBaru[colDiperbarui] = waktuUpdate;
      barisBaru[colOleh] = aktorBersih;
      sheet.appendRow(barisBaru);
    } else {
      jenisPerubahan = 'UPDATE';
      nilaiLama.fee = parseFloat(sheet.getRange(barisTarget, colFee + 1).getValue()) || 0;
      nilaiLama.kasbon = parseFloat(sheet.getRange(barisTarget, colKasbon + 1).getValue()) || 0;
      nilaiLama.luarKota = String(sheet.getRange(barisTarget, colLuarKota + 1).getValue() || '');
      sheet.getRange(barisTarget, colPeriode + 1).setValue(periodeBersih);
      sheet.getRange(barisTarget, colNama + 1).setValue(namaBersih);
      sheet.getRange(barisTarget, colFee + 1).setValue(feeBersih);
      sheet.getRange(barisTarget, colKasbon + 1).setValue(kasbonBersih);
      sheet.getRange(barisTarget, colLuarKota + 1).setValue(luarKotaBersih);
      sheet.getRange(barisTarget, colDiperbarui + 1).setValue(waktuUpdate);
      sheet.getRange(barisTarget, colOleh + 1).setValue(aktorBersih);
    }

    // Log append-only untuk jejak audit setiap perubahan payroll.
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetLog = ss.getSheetByName('Log Payroll Bulanan');
    if (!sheetLog) {
      sheetLog = ss.insertSheet('Log Payroll Bulanan');
      sheetLog.appendRow(['Waktu', 'Aksi', 'Kunci Payroll', 'Periode', 'Nama Pegawai', 'Fee Lama', 'Fee Baru', 'Kasbon Lama', 'Kasbon Baru', 'Luar Kota Lama', 'Luar Kota Baru', 'Diubah Oleh']);
      sheetLog.setFrozenRows(1);
    }
    sheetLog.appendRow([waktuUpdate, jenisPerubahan, kunciPayroll, periodeBersih, namaBersih, nilaiLama.fee, feeBersih, nilaiLama.kasbon, kasbonBersih, nilaiLama.luarKota, luarKotaBersih, aktorBersih]);
    SpreadsheetApp.flush();

    return {
      kunci: kunciPayroll,
      periode: periodeBersih,
      namaPegawai: namaBersih,
      fee: feeBersih,
      kasbon: kasbonBersih,
      luarKota: luarKotaBersih,
      diperbaruiPada: waktuUpdate,
      diperbaruiOleh: aktorBersih
    };
  } finally {
    lock.releaseLock();
  }
}

var SECRET_API_KEY = "ALFACOM_SECURE_KEY_2026";
// Secret HMAC disimpan di Apps Script Script Properties agar tidak masuk repositori publik.
var SESSION_TOKEN_SECRET = PropertiesService.getScriptProperties().getProperty("SESSION_TOKEN_SECRET");
var SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
var WEBAUTHN_CREDENTIAL_ID_HEADER = "WebAuthn_CredentialID";
var WEBAUTHN_PUBLIC_KEY_HEADER = "WebAuthn_PublicKey";
var WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
var WEBAUTHN_RP_NAME = "Alfacom SLA";
// Tambahkan origin development secara eksplisit di Script Properties bila perlu,
// contoh: https://aplikasisla.vercel.app,http://127.0.0.1:8765
var WEBAUTHN_ALLOWED_ORIGINS = PropertiesService.getScriptProperties().getProperty("WEBAUTHN_ALLOWED_ORIGINS") || "https://aplikasisla.vercel.app";

function byteArrayToHex_(bytes) {
  return bytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function buatSessionToken_(username) {
  if (!SESSION_TOKEN_SECRET) throw new Error("Konfigurasi SESSION_TOKEN_SECRET belum tersedia di Script Properties.");
  var usernameBersih = String(username || '').trim().toLowerCase();
  var kedaluwarsaPada = Date.now() + SESSION_TOKEN_TTL_MS;
  var payloadToken = usernameBersih + '|' + kedaluwarsaPada;
  var signature = Utilities.computeHmacSha256Signature(
    payloadToken,
    SESSION_TOKEN_SECRET,
    Utilities.Charset.UTF_8
  );

  return Utilities.base64EncodeWebSafe(payloadToken, Utilities.Charset.UTF_8) + '.' + byteArrayToHex_(signature);
}

function bandingkanStringKonstan_(nilaiA, nilaiB) {
  var a = String(nilaiA || '');
  var b = String(nilaiB || '');
  if (a.length !== b.length) return false;
  var beda = 0;
  for (var i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

function verifikasiSessionToken_(dataUser) {
  try {
    if (!SESSION_TOKEN_SECRET || !dataUser || !dataUser.Username || !dataUser.SessionToken) return false;
    var bagianToken = String(dataUser.SessionToken).split('.');
    if (bagianToken.length !== 2 || !/^[0-9a-f]{64}$/i.test(bagianToken[1])) return false;

    var payloadToken = Utilities.newBlob(Utilities.base64DecodeWebSafe(bagianToken[0])).getDataAsString();
    var pemisahTerakhir = payloadToken.lastIndexOf('|');
    if (pemisahTerakhir <= 0) return false;

    var usernameToken = payloadToken.substring(0, pemisahTerakhir).trim().toLowerCase();
    var kedaluwarsaPada = parseInt(payloadToken.substring(pemisahTerakhir + 1), 10);
    var usernameRequest = String(dataUser.Username || '').trim().toLowerCase();
    if (!usernameToken || usernameToken !== usernameRequest || isNaN(kedaluwarsaPada) || Date.now() > kedaluwarsaPada) return false;

    var signatureSeharusnya = byteArrayToHex_(Utilities.computeHmacSha256Signature(
      payloadToken,
      SESSION_TOKEN_SECRET,
      Utilities.Charset.UTF_8
    ));
    return bandingkanStringKonstan_(signatureSeharusnya, bagianToken[1].toLowerCase());
  } catch (error) {
    return false;
  }
}

// =======================================================
// WEBAUTHN / PASSKEY (ES256 / P-256)
// Challenge ditandatangani HMAC di server; assertion diverifikasi penuh di GAS.
// =======================================================
function normalisasiBase64Url_(nilai) {
  return String(nilai || '').trim().replace(/=+$/g, '');
}

function base64UrlEncodeBytes_(bytes) {
  return normalisasiBase64Url_(Utilities.base64EncodeWebSafe(bytes));
}

function base64UrlEncodeUtf8_(teks) {
  return normalisasiBase64Url_(Utilities.base64EncodeWebSafe(String(teks || ''), Utilities.Charset.UTF_8));
}

function base64UrlDecodeBytes_(nilai, batasPanjang) {
  var bersih = normalisasiBase64Url_(nilai);
  if (!bersih || !/^[A-Za-z0-9_-]+$/.test(bersih)) throw new Error('Data Base64URL tidak valid.');
  if (batasPanjang && bersih.length > batasPanjang) throw new Error('Data WebAuthn terlalu panjang.');
  while (bersih.length % 4) bersih += '=';
  return Utilities.base64DecodeWebSafe(bersih);
}

function bytesUnsigned_(bytes) {
  return (bytes || []).map(function(b) { return b & 0xFF; });
}

function bytesAppsScript_(bytes) {
  return bytesUnsigned_(bytes).map(function(b) { return b > 127 ? b - 256 : b; });
}

function bandingkanBytesKonstan_(a, b) {
  var kiri = bytesUnsigned_(a);
  var kanan = bytesUnsigned_(b);
  if (kiri.length !== kanan.length) return false;
  var beda = 0;
  for (var i = 0; i < kiri.length; i++) beda |= kiri[i] ^ kanan[i];
  return beda === 0;
}

function pastikanKolomWebAuthnUsers_(sheetUsers) {
  if (!sheetUsers) throw new Error('Sheet Users tidak ditemukan.');
  var jumlahKolom = Math.max(sheetUsers.getLastColumn(), 1);
  var headers = sheetUsers.getRange(1, 1, 1, jumlahKolom).getValues()[0] || [];
  while (headers.length > 0 && String(headers[headers.length - 1] || '').trim() === '') headers.pop();
  if (headers.indexOf('Username') === -1) throw new Error('Header Username tidak ditemukan pada Sheet Users.');

  [WEBAUTHN_CREDENTIAL_ID_HEADER, WEBAUTHN_PUBLIC_KEY_HEADER].forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      sheetUsers.getRange(1, headers.length).setValue(header).setFontWeight('bold');
    }
  });
  return headers;
}

function cariUserWebAuthn_(sheetUsers, username) {
  var headers = pastikanKolomWebAuthnUsers_(sheetUsers);
  var dataUsers = sheetUsers.getDataRange().getValues();
  var colUsername = headers.indexOf('Username');
  var usernameBersih = String(username || '').trim().toLowerCase();
  for (var i = 1; i < dataUsers.length; i++) {
    if (String(dataUsers[i][colUsername] || '').trim().toLowerCase() === usernameBersih) {
      return {
        headers: headers,
        row: dataUsers[i],
        rowNumber: i + 1,
        credentialColumn: headers.indexOf(WEBAUTHN_CREDENTIAL_ID_HEADER),
        publicKeyColumn: headers.indexOf(WEBAUTHN_PUBLIC_KEY_HEADER)
      };
    }
  }
  return null;
}

function buatRecordUserAman_(headers, row) {
  var record = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'Password' || headers[i] === WEBAUTHN_CREDENTIAL_ID_HEADER || headers[i] === WEBAUTHN_PUBLIC_KEY_HEADER) continue;
    record[headers[i]] = row[i];
  }
  return record;
}

function normalisasiHakAksesCabang_(nilai) {
  var hakAkses = String(nilai || '').trim().toLowerCase();
  if (hakAkses === 'kendari') return 'Kendari';
  if (hakAkses === 'raha') return 'Raha';
  if (hakAkses === 'semua') return 'Semua';
  return '';
}

function sertakanHakAksesCabang_(record) {
  record.Hak_Akses_Cabang = normalisasiHakAksesCabang_(record.Hak_Akses_Cabang);
  return record;
}

function originWebAuthnDiizinkan_(origin) {
  var target = String(origin || '').trim().replace(/\/$/, '');
  var daftar = String(WEBAUTHN_ALLOWED_ORIGINS || '').split(',').map(function(item) {
    return String(item || '').trim().replace(/\/$/, '');
  }).filter(function(item) { return item !== ''; });
  return daftar.indexOf(target) !== -1;
}

function rpIdDariOrigin_(origin) {
  var target = String(origin || '').trim().replace(/\/$/, '');
  if (!originWebAuthnDiizinkan_(target)) throw new Error('Origin WebAuthn tidak diizinkan.');
  var cocok = target.match(/^https:\/\/([a-z0-9.-]+)(?::\d+)?$/i);
  if (!cocok) cocok = target.match(/^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i);
  if (!cocok) throw new Error('WebAuthn wajib berjalan pada secure origin.');
  return String(cocok[1]).toLowerCase();
}

function buatWebAuthnChallenge_(username, tujuan, origin) {
  if (!SESSION_TOKEN_SECRET) throw new Error('SESSION_TOKEN_SECRET belum tersedia.');
  var sekarang = Date.now();
  var payload = {
    v: 1,
    u: String(username || '').trim().toLowerCase(),
    p: String(tujuan || ''),
    o: String(origin || '').trim().replace(/\/$/, ''),
    r: rpIdDariOrigin_(origin),
    i: sekarang,
    e: sekarang + WEBAUTHN_CHALLENGE_TTL_MS,
    n: Utilities.getUuid() + Utilities.getUuid()
  };
  var payloadEncoded = base64UrlEncodeUtf8_(JSON.stringify(payload));
  var signature = byteArrayToHex_(Utilities.computeHmacSha256Signature(
    'webauthn-v1.' + payloadEncoded,
    SESSION_TOKEN_SECRET,
    Utilities.Charset.UTF_8
  ));
  return payloadEncoded + '.' + signature;
}

function validasiWebAuthnChallenge_(challengeToken, tujuan, username) {
  if (!SESSION_TOKEN_SECRET) throw new Error('SESSION_TOKEN_SECRET belum tersedia.');
  var bagian = String(challengeToken || '').split('.');
  if (bagian.length !== 2 || !/^[0-9a-f]{64}$/i.test(bagian[1])) throw new Error('Challenge WebAuthn tidak sah.');
  var signature = byteArrayToHex_(Utilities.computeHmacSha256Signature(
    'webauthn-v1.' + bagian[0],
    SESSION_TOKEN_SECRET,
    Utilities.Charset.UTF_8
  ));
  if (!bandingkanStringKonstan_(signature, bagian[1].toLowerCase())) throw new Error('Challenge WebAuthn tidak sah.');

  var payload = JSON.parse(Utilities.newBlob(base64UrlDecodeBytes_(bagian[0], 4096)).getDataAsString());
  var sekarang = Date.now();
  var usernameBersih = String(username || '').trim().toLowerCase();
  if (payload.v !== 1 || payload.p !== tujuan || payload.u !== usernameBersih) throw new Error('Challenge WebAuthn tidak sesuai.');
  if (!payload.i || !payload.e || payload.i > sekarang + 60000 || payload.e < sekarang || payload.e - payload.i > WEBAUTHN_CHALLENGE_TTL_MS + 1000) throw new Error('Challenge WebAuthn telah kedaluwarsa.');
  if (rpIdDariOrigin_(payload.o) !== payload.r) throw new Error('RP ID WebAuthn tidak sesuai.');
  return payload;
}

function validasiClientDataWebAuthn_(clientDataEncoded, tipe, challengeToken, originHarapan) {
  var clientDataBytes = base64UrlDecodeBytes_(clientDataEncoded, 8192);
  var clientData = JSON.parse(Utilities.newBlob(clientDataBytes).getDataAsString());
  if (clientData.type !== tipe) throw new Error('Tipe clientData WebAuthn tidak sesuai.');
  if (!bandingkanStringKonstan_(String(clientData.challenge || ''), base64UrlEncodeUtf8_(challengeToken))) throw new Error('Challenge browser tidak sesuai.');
  if (!bandingkanStringKonstan_(String(clientData.origin || '').replace(/\/$/, ''), String(originHarapan || '').replace(/\/$/, ''))) throw new Error('Origin browser tidak sesuai.');
  if (clientData.crossOrigin === true) throw new Error('WebAuthn lintas origin ditolak.');
  return { json: clientData, bytes: clientDataBytes };
}

function cariUrutanBytes_(sumber, target) {
  var data = bytesUnsigned_(sumber);
  var pola = bytesUnsigned_(target);
  for (var i = 0; i <= data.length - pola.length; i++) {
    var cocok = true;
    for (var j = 0; j < pola.length; j++) {
      if (data[i + j] !== pola[j]) { cocok = false; break; }
    }
    if (cocok) return i;
  }
  return -1;
}

function ekstrakTitikP256DariSpki_(spkiEncoded) {
  var spki = bytesUnsigned_(base64UrlDecodeBytes_(spkiEncoded, 2048));
  var oidEcPublicKey = [0x06,0x07,0x2A,0x86,0x48,0xCE,0x3D,0x02,0x01];
  var oidPrime256v1 = [0x06,0x08,0x2A,0x86,0x48,0xCE,0x3D,0x03,0x01,0x07];
  if (cariUrutanBytes_(spki, oidEcPublicKey) === -1 || cariUrutanBytes_(spki, oidPrime256v1) === -1) throw new Error('Public key bukan ES256/P-256.');
  if (spki.length < 65 || spki[spki.length - 65] !== 0x04) throw new Error('Format public key P-256 tidak valid.');
  return spki.slice(spki.length - 65);
}

function bacaPanjangCbor_(bytes, index, additional) {
  if (additional < 24) return { length: additional, next: index };
  if (additional === 24) return { length: bytes[index], next: index + 1 };
  if (additional === 25) return { length: bytes[index] * 256 + bytes[index + 1], next: index + 2 };
  if (additional === 26) return { length: bytes[index] * 16777216 + bytes[index + 1] * 65536 + bytes[index + 2] * 256 + bytes[index + 3], next: index + 4 };
  throw new Error('CBOR WebAuthn tidak didukung.');
}

function bacaNilaiCbor_(inputBytes, startIndex) {
  var bytes = bytesUnsigned_(inputBytes);
  if (startIndex >= bytes.length) throw new Error('CBOR WebAuthn terpotong.');
  var awal = bytes[startIndex++];
  var major = awal >> 5;
  var panjangInfo = bacaPanjangCbor_(bytes, startIndex, awal & 31);
  var nilaiPanjang = panjangInfo.length;
  var index = panjangInfo.next;
  if (major === 0) return { value: nilaiPanjang, next: index };
  if (major === 1) return { value: -1 - nilaiPanjang, next: index };
  if (major === 2) {
    if (index + nilaiPanjang > bytes.length) throw new Error('CBOR byte string terpotong.');
    return { value: bytes.slice(index, index + nilaiPanjang), next: index + nilaiPanjang };
  }
  if (major === 5) {
    var map = {};
    for (var i = 0; i < nilaiPanjang; i++) {
      var hasilKunci = bacaNilaiCbor_(bytes, index);
      var hasilNilai = bacaNilaiCbor_(bytes, hasilKunci.next);
      map[String(hasilKunci.value)] = hasilNilai.value;
      index = hasilNilai.next;
    }
    return { value: map, next: index };
  }
  throw new Error('Tipe CBOR WebAuthn tidak didukung.');
}

function validasiAuthenticatorDataWebAuthn_(authenticatorDataEncoded, rpId, wajibAttested) {
  var bytes = bytesUnsigned_(base64UrlDecodeBytes_(authenticatorDataEncoded, 16384));
  if (bytes.length < 37) throw new Error('Authenticator data terlalu pendek.');
  var rpIdHash = bytesUnsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(rpId), Utilities.Charset.UTF_8));
  if (!bandingkanBytesKonstan_(bytes.slice(0, 32), rpIdHash)) throw new Error('RP ID hash tidak sesuai.');

  var flags = bytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) throw new Error('Verifikasi pengguna pada authenticator tidak terpenuhi.');
  var signCount = bytes[33] * 16777216 + bytes[34] * 65536 + bytes[35] * 256 + bytes[36];
  var hasil = { bytes: bytes, flags: flags, signCount: signCount };

  if (wajibAttested) {
    if ((flags & 0x40) === 0 || bytes.length < 56) throw new Error('Attested credential data tidak tersedia.');
    var credentialLength = bytes[53] * 256 + bytes[54];
    var credentialStart = 55;
    var coseStart = credentialStart + credentialLength;
    if (!credentialLength || coseStart >= bytes.length) throw new Error('Credential ID pada authenticator tidak valid.');
    var cose = bacaNilaiCbor_(bytes, coseStart).value;
    if (cose['1'] !== 2 || cose['3'] !== -7 || cose['-1'] !== 1 || !Array.isArray(cose['-2']) || !Array.isArray(cose['-3']) || cose['-2'].length !== 32 || cose['-3'].length !== 32) {
      throw new Error('Credential WebAuthn wajib menggunakan ES256/P-256.');
    }
    hasil.credentialId = bytes.slice(credentialStart, coseStart);
    hasil.publicPoint = [0x04].concat(cose['-2'], cose['-3']);
  } else if ((flags & 0x40) !== 0) {
    throw new Error('Assertion memuat attested data yang tidak semestinya.');
  }
  return hasil;
}

function kurvaP256_() {
  if (typeof BigInt !== 'function') throw new Error('Runtime Apps Script belum mendukung BigInt/V8.');
  var p = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  return {
    p: p,
    a: p - BigInt(3),
    b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')
  };
}

function moduloBigInt_(nilai, modulus) {
  var hasil = nilai % modulus;
  return hasil >= BigInt(0) ? hasil : hasil + modulus;
}

function inverseBigInt_(nilai, modulus) {
  var t = BigInt(0), tBaru = BigInt(1);
  var r = modulus, rBaru = moduloBigInt_(nilai, modulus);
  while (rBaru !== BigInt(0)) {
    var q = r / rBaru;
    var tmpT = t - q * tBaru; t = tBaru; tBaru = tmpT;
    var tmpR = r - q * rBaru; r = rBaru; rBaru = tmpR;
  }
  if (r !== BigInt(1)) throw new Error('Nilai tidak memiliki inverse modular.');
  return moduloBigInt_(t, modulus);
}

function bytesKeBigInt_(bytes) {
  var hex = bytesUnsigned_(bytes).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  return BigInt('0x' + (hex || '0'));
}

function tambahTitikP256_(p1, p2, kurva) {
  if (!p1) return p2;
  if (!p2) return p1;
  var p = kurva.p;
  if (p1.x === p2.x && moduloBigInt_(p1.y + p2.y, p) === BigInt(0)) return null;
  var lambda;
  if (p1.x === p2.x && p1.y === p2.y) {
    if (p1.y === BigInt(0)) return null;
    lambda = moduloBigInt_((BigInt(3) * p1.x * p1.x + kurva.a) * inverseBigInt_(BigInt(2) * p1.y, p), p);
  } else {
    lambda = moduloBigInt_((p2.y - p1.y) * inverseBigInt_(p2.x - p1.x, p), p);
  }
  var x3 = moduloBigInt_(lambda * lambda - p1.x - p2.x, p);
  var y3 = moduloBigInt_(lambda * (p1.x - x3) - p1.y, p);
  return { x: x3, y: y3 };
}

function kaliTitikP256_(titik, skalar, kurva) {
  var hasil = null;
  var tambah = titik;
  var k = skalar;
  while (k > BigInt(0)) {
    if ((k & BigInt(1)) === BigInt(1)) hasil = tambahTitikP256_(hasil, tambah, kurva);
    tambah = tambahTitikP256_(tambah, tambah, kurva);
    k >>= BigInt(1);
  }
  return hasil;
}

function bacaPanjangDer_(bytes, index) {
  if (index >= bytes.length) throw new Error('Signature DER terpotong.');
  var awal = bytes[index++];
  if ((awal & 0x80) === 0) return { length: awal, next: index };
  var jumlah = awal & 0x7F;
  if (jumlah < 1 || jumlah > 2 || index + jumlah > bytes.length) throw new Error('Panjang DER tidak didukung.');
  var panjang = 0;
  for (var i = 0; i < jumlah; i++) panjang = panjang * 256 + bytes[index++];
  return { length: panjang, next: index };
}

function parseSignatureDerP256_(signatureEncoded) {
  var bytes = bytesUnsigned_(base64UrlDecodeBytes_(signatureEncoded, 512));
  var index = 0;
  if (bytes[index++] !== 0x30) throw new Error('Signature ECDSA bukan DER sequence.');
  var seq = bacaPanjangDer_(bytes, index); index = seq.next;
  var akhir = index + seq.length;
  if (akhir !== bytes.length || bytes[index++] !== 0x02) throw new Error('Signature DER tidak valid.');
  var panjangR = bacaPanjangDer_(bytes, index); index = panjangR.next;
  var rBytes = bytes.slice(index, index + panjangR.length); index += panjangR.length;
  if (bytes[index++] !== 0x02) throw new Error('Signature DER tidak valid.');
  var panjangS = bacaPanjangDer_(bytes, index); index = panjangS.next;
  var sBytes = bytes.slice(index, index + panjangS.length); index += panjangS.length;
  if (index !== akhir || !rBytes.length || !sBytes.length || (rBytes[0] & 0x80) || (sBytes[0] & 0x80)) throw new Error('Integer signature DER tidak valid.');
  while (rBytes.length > 1 && rBytes[0] === 0) rBytes.shift();
  while (sBytes.length > 1 && sBytes[0] === 0) sBytes.shift();
  return { r: bytesKeBigInt_(rBytes), s: bytesKeBigInt_(sBytes) };
}

function verifikasiSignatureEcdsaP256_(spkiEncoded, signatureEncoded, signedBytes) {
  var kurva = kurvaP256_();
  var titikBytes = ekstrakTitikP256DariSpki_(spkiEncoded);
  var q = { x: bytesKeBigInt_(titikBytes.slice(1, 33)), y: bytesKeBigInt_(titikBytes.slice(33, 65)) };
  if (q.x <= BigInt(0) || q.x >= kurva.p || q.y <= BigInt(0) || q.y >= kurva.p) return false;
  if (moduloBigInt_(q.y * q.y - (q.x * q.x * q.x + kurva.a * q.x + kurva.b), kurva.p) !== BigInt(0)) return false;

  var sig = parseSignatureDerP256_(signatureEncoded);
  if (sig.r <= BigInt(0) || sig.r >= kurva.n || sig.s <= BigInt(0) || sig.s >= kurva.n) return false;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesAppsScript_(signedBytes));
  var z = bytesKeBigInt_(digest);
  var w = inverseBigInt_(sig.s, kurva.n);
  var u1 = moduloBigInt_(z * w, kurva.n);
  var u2 = moduloBigInt_(sig.r * w, kurva.n);
  var g = { x: kurva.gx, y: kurva.gy };
  var titik = tambahTitikP256_(kaliTitikP256_(g, u1, kurva), kaliTitikP256_(q, u2, kurva), kurva);
  return !!titik && moduloBigInt_(titik.x, kurva.n) === sig.r;
}

function bacaCredentialWebAuthnTersimpan_(nilai) {
  var hasil = JSON.parse(String(nilai || '{}'));
  if (hasil.v !== 1 || hasil.alg !== -7 || !hasil.spki || !hasil.rpId) throw new Error('Data public key WebAuthn tidak valid.');
  ekstrakTitikP256DariSpki_(hasil.spki);
  hasil.signCount = Number(hasil.signCount) || 0;
  return hasil;
}

function konsumsiChallengeWebAuthn_(challengeToken) {
  var cache = CacheService.getScriptCache();
  var digest = byteArrayToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(challengeToken), Utilities.Charset.UTF_8));
  var key = 'webauthn-used-' + digest;
  if (cache.get(key)) throw new Error('Challenge WebAuthn sudah pernah digunakan.');
  cache.put(key, '1', Math.ceil(WEBAUTHN_CHALLENGE_TTL_MS / 1000));
}

function mulaiRegistrasiBiometrik_(data, ss) {
  if (!verifikasiSessionToken_(data.user)) return { status: 'gagal', pesan: 'Sesi login tidak sah atau telah kedaluwarsa.' };
  var username = String(data.user.Username || '').trim().toLowerCase();
  var sheetUsers = ss.getSheetByName('Users');
  var user = cariUserWebAuthn_(sheetUsers, username);
  if (!user) return { status: 'gagal', pesan: 'Akun tidak ditemukan.' };
  var origin = String(data.origin || '').trim().replace(/\/$/, '');
  var rpId = rpIdDariOrigin_(origin);
  return {
    status: 'sukses',
    challengeToken: buatWebAuthnChallenge_(username, 'register', origin),
    rpId: rpId,
    rpName: WEBAUTHN_RP_NAME,
    userId: base64UrlEncodeBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, username, Utilities.Charset.UTF_8))
  };
}

function registerBiometric_(data, ss) {
  if (!verifikasiSessionToken_(data.user)) return { status: 'gagal', pesan: 'Sesi login tidak sah atau telah kedaluwarsa.' };
  var username = String(data.user.Username || '').trim().toLowerCase();
  var challenge = validasiWebAuthnChallenge_(data.challengeToken, 'register', username);
  var clientData = validasiClientDataWebAuthn_(data.clientDataJSON, 'webauthn.create', data.challengeToken, challenge.o);
  var authData = validasiAuthenticatorDataWebAuthn_(data.authenticatorData, challenge.r, true);
  var credentialId = normalisasiBase64Url_(data.credentialId);
  var credentialBytes = bytesUnsigned_(base64UrlDecodeBytes_(credentialId, 2048));
  if (!bandingkanBytesKonstan_(credentialBytes, authData.credentialId)) throw new Error('Credential ID tidak sesuai dengan authenticator data.');
  if (Number(data.publicKeyAlgorithm) !== -7) throw new Error('Hanya credential ES256 yang didukung.');
  var titikSpki = ekstrakTitikP256DariSpki_(data.publicKey);
  if (!bandingkanBytesKonstan_(titikSpki, authData.publicPoint)) throw new Error('Public key tidak sesuai dengan authenticator data.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheetUsers = ss.getSheetByName('Users');
    var user = cariUserWebAuthn_(sheetUsers, username);
    if (!user) throw new Error('Akun tidak ditemukan.');
    konsumsiChallengeWebAuthn_(data.challengeToken);
    var publicKeyRecord = JSON.stringify({
      v: 1,
      alg: -7,
      spki: normalisasiBase64Url_(data.publicKey),
      rpId: challenge.r,
      signCount: authData.signCount,
      createdAt: new Date().toISOString()
    });
    sheetUsers.getRange(user.rowNumber, user.credentialColumn + 1).setValue(credentialId);
    sheetUsers.getRange(user.rowNumber, user.publicKeyColumn + 1).setValue(publicKeyRecord);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { status: 'sukses', pesan: 'Passkey berhasil didaftarkan.' };
}

function mulaiLoginBiometrik_(data, ss) {
  var username = String(data.username || '').trim().toLowerCase();
  if (!username) return { status: 'gagal', pesan: 'Masukkan username terlebih dahulu.' };
  var origin = String(data.origin || '').trim().replace(/\/$/, '');
  var rpId = rpIdDariOrigin_(origin);
  var sheetUsers = ss.getSheetByName('Users');
  var user = cariUserWebAuthn_(sheetUsers, username);
  if (!user) return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' };
  var credentialId = normalisasiBase64Url_(user.row[user.credentialColumn]);
  var keyRecord;
  try { keyRecord = bacaCredentialWebAuthnTersimpan_(user.row[user.publicKeyColumn]); }
  catch (error) { return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' }; }
  if (!credentialId || keyRecord.rpId !== rpId) return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' };
  return {
    status: 'sukses',
    challengeToken: buatWebAuthnChallenge_(username, 'login', origin),
    rpId: rpId,
    credentialId: credentialId
  };
}

function verifyBiometric_(data, ss) {
  var username = String(data.username || '').trim().toLowerCase();
  var challenge = validasiWebAuthnChallenge_(data.challengeToken, 'login', username);
  var clientData = validasiClientDataWebAuthn_(data.clientDataJSON, 'webauthn.get', data.challengeToken, challenge.o);
  var authData = validasiAuthenticatorDataWebAuthn_(data.authenticatorData, challenge.r, false);
  var sheetUsers = ss.getSheetByName('Users');
  var user = cariUserWebAuthn_(sheetUsers, username);
  if (!user) throw new Error('Kredensial biometrik tidak valid.');
  var credentialId = normalisasiBase64Url_(data.credentialId);
  var credentialTersimpan = normalisasiBase64Url_(user.row[user.credentialColumn]);
  if (!bandingkanStringKonstan_(credentialId, credentialTersimpan)) throw new Error('Kredensial biometrik tidak valid.');
  var keyRecord = bacaCredentialWebAuthnTersimpan_(user.row[user.publicKeyColumn]);
  if (keyRecord.rpId !== challenge.r) throw new Error('RP ID credential tidak sesuai.');

  var clientDataHash = bytesUnsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clientData.bytes));
  var signedBytes = authData.bytes.concat(clientDataHash);
  if (!verifikasiSignatureEcdsaP256_(keyRecord.spki, data.signature, signedBytes)) throw new Error('Signature biometrik tidak valid.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var userTerbaru = cariUserWebAuthn_(sheetUsers, username);
    if (!userTerbaru || !bandingkanStringKonstan_(normalisasiBase64Url_(userTerbaru.row[userTerbaru.credentialColumn]), credentialTersimpan)) throw new Error('Credential telah berubah.');
    var keyTerbaru = bacaCredentialWebAuthnTersimpan_(userTerbaru.row[userTerbaru.publicKeyColumn]);
    if (keyTerbaru.signCount > 0 && authData.signCount > 0 && authData.signCount <= keyTerbaru.signCount) throw new Error('Counter authenticator tidak meningkat.');
    konsumsiChallengeWebAuthn_(data.challengeToken);
    if (authData.signCount > keyTerbaru.signCount) {
      keyTerbaru.signCount = authData.signCount;
      keyTerbaru.lastUsedAt = new Date().toISOString();
      sheetUsers.getRange(userTerbaru.rowNumber, userTerbaru.publicKeyColumn + 1).setValue(JSON.stringify(keyTerbaru));
      SpreadsheetApp.flush();
    }
    user = userTerbaru;
  } finally {
    lock.releaseLock();
  }

  var record = sertakanHakAksesCabang_(buatRecordUserAman_(user.headers, user.row));
  record.SessionToken = buatSessionToken_(record.Username);
  return { status: 'sukses', user: record, Hak_Akses_Cabang: record.Hak_Akses_Cabang };
}

function otorisasiAdminBroadcastCRM_(dataUser, usersData) {
  if (!verifikasiSessionToken_(dataUser) || !usersData || usersData.length < 2) return false;
  var headerUsers = usersData[0] || [];
  var colUsername = headerUsers.indexOf('Username');
  var colRole = headerUsers.indexOf('Role');
  if (colUsername === -1 || colRole === -1) return false;

  var usernameRequest = String(dataUser.Username || '').trim().toLowerCase();
  for (var i = 1; i < usersData.length; i++) {
    var usernameDB = String(usersData[i][colUsername] || '').trim().toLowerCase();
    if (usernameDB === usernameRequest) {
      return String(usersData[i][colRole] || '').trim().toLowerCase() === 'admin';
    }
  }
  return false;
}

function prosesBroadcastCRM_(data, usersData, ss) {
  if (!otorisasiAdminBroadcastCRM_(data && data.user, usersData)) {
    return { status: 'gagal', pesan: 'Afwan: Akses Broadcast ditolak. Sesi Admin tidak sah atau telah kedaluwarsa.' };
  }

  var pesanTemplate = String((data && data.pesan) || '').trim();
  var daftarKlien = data && Array.isArray(data.klien) ? data.klien : [];
  if (!pesanTemplate) return { status: 'gagal', pesan: 'Isi pesan Broadcast tidak boleh kosong.' };
  if (pesanTemplate.length > 2000) return { status: 'gagal', pesan: 'Isi pesan Broadcast maksimal 2.000 karakter.' };
  if (daftarKlien.length === 0) return { status: 'gagal', pesan: 'Daftar pelanggan Broadcast kosong.' };
  if (daftarKlien.length > 50) return { status: 'gagal', pesan: 'Maksimal 50 pelanggan dalam satu batch Broadcast.' };

  var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheetDatabaseKlien = spreadsheet.getSheetByName('Database Klien');
  if (!sheetDatabaseKlien || sheetDatabaseKlien.getLastRow() < 2) {
    return { status: 'gagal', pesan: 'Database Klien belum tersedia atau masih kosong.' };
  }
  var dataDatabaseKlien = sheetDatabaseKlien.getDataRange().getValues();
  var headerDatabaseKlien = dataDatabaseKlien[0] || [];
  var colNamaKlien = headerDatabaseKlien.indexOf('Nama Klien');
  var colNoWAKlien = headerDatabaseKlien.indexOf('No WA');
  if (colNamaKlien === -1 || colNoWAKlien === -1) {
    return { status: 'gagal', pesan: 'Header Database Klien tidak lengkap.' };
  }
  var klienTerdaftar = {};
  for (var db = 1; db < dataDatabaseKlien.length; db++) {
    var noWADatabase = normalisasiNoWA_(dataDatabaseKlien[db][colNoWAKlien]);
    if (!/^628\d{7,12}$/.test(noWADatabase)) continue;
    klienTerdaftar[noWADatabase] = String(dataDatabaseKlien[db][colNamaKlien] || '').replace(/[\r\n\t]+/g, ' ').trim().substring(0, 120) || 'Pelanggan';
  }

  var requestId = String((data && data.requestId) || '').trim();
  var cache = CacheService.getScriptCache();
  if (/^[A-Za-z0-9_-]{10,120}$/.test(requestId)) {
    if (cache.get(requestId)) return { status: 'gagal', pesan: 'Permintaan Broadcast yang sama sudah pernah diproses.' };
    cache.put(requestId, 'diproses', 600);
  }

  var targetUnik = [];
  var nomorSudahAda = {};
  var daftarGagal = [];
  for (var i = 0; i < daftarKlien.length; i++) {
    var item = daftarKlien[i] || {};
    var namaKlienRequest = String(item.nama || '').replace(/[\r\n\t]+/g, ' ').trim().substring(0, 120) || 'Pelanggan';
    var noWANormal = normalisasiNoWA_(item.noWa);
    if (!/^628\d{7,12}$/.test(noWANormal) || !klienTerdaftar[noWANormal]) {
      daftarGagal.push({ nama: namaKlienRequest, noWa: noWANormal || String(item.noWa || '') });
      continue;
    }
    if (nomorSudahAda[noWANormal]) continue;
    nomorSudahAda[noWANormal] = true;
    targetUnik.push({ nama: klienTerdaftar[noWANormal], noWa: noWANormal });
  }

  if (targetUnik.length === 0) {
    return { status: 'gagal', pesan: 'Tidak ada nomor WhatsApp pelanggan yang valid.', terkirim: 0, gagal: daftarGagal.length, daftarGagal: daftarGagal };
  }

  var jumlahTerkirim = 0;
  for (var t = 0; t < targetUnik.length; t++) {
    var target = targetUnik[t];
    var pesanPersonal = pesanTemplate.replace(/\[Nama\]/g, target.nama);
    if (kirimNotifWA(target.noWa, pesanPersonal)) jumlahTerkirim++;
    else daftarGagal.push({ nama: target.nama, noWa: target.noWa });
    if (t < targetUnik.length - 1) Utilities.sleep(2000);
  }

  var jumlahTarget = targetUnik.length;
  var statusHasil = jumlahTerkirim === jumlahTarget ? 'sukses' : (jumlahTerkirim > 0 ? 'sebagian' : 'gagal');
  var pesanHasil = statusHasil === 'sukses'
    ? 'Alhamdulillah! Broadcast berhasil dikirim ke ' + jumlahTerkirim + ' pelanggan.'
    : 'Broadcast selesai. Berhasil: ' + jumlahTerkirim + ', gagal: ' + daftarGagal.length + '.';
  console.log('Broadcast CRM oleh ' + String(data.user.Username || '') + ': ' + jumlahTerkirim + '/' + jumlahTarget + ' terkirim.');

  return {
    status: statusHasil,
    pesan: pesanHasil,
    total: jumlahTarget,
    terkirim: jumlahTerkirim,
    gagal: daftarGagal.length,
    daftarGagal: daftarGagal
  };
}

function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.apiKey !== SECRET_API_KEY) {
      return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Akses Ditolak: Kunci API tidak valid!"})).setMimeType(ContentService.MimeType.JSON);
    }

    var reqTrackId = e.parameter.trackId ? String(e.parameter.trackId).trim().toLowerCase() : null;
    var cabangRequest = cabangOperasional_(e.parameter.cabang);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var perluFlush = false;

    var sheetTiket = ss.getSheetByName("Tiket") || ss.getSheets()[0];
    var dataTiket = sheetTiket.getDataRange().getValues();
    var headersTiket = dataTiket[0]; var resultTiket = [];
    var colCabangTiket = pastikanKolomAkhir_(sheetTiket, headersTiket, 'Cabang');
    var colAdminSLATiket = pastikanKolomAkhir_(sheetTiket, headersTiket, 'Admin SLA');
    var cabangByIdTiket = {};

    for (var i = 1; i < dataTiket.length; i++) {
      var row = dataTiket[i]; var record = {}; var idTiket = row[0];
      if (!idTiket) continue;
      // Jika mode tracking publik, tolak semua tiket selain yang dicari
      if (reqTrackId && String(idTiket).toLowerCase() !== reqTrackId) continue;

      var cabangTiket = cabangDariBaris_(row, headersTiket, cabangRequest);
      var roleAdminTiket = roleAdminUntukCabang_(cabangTiket);
      cabangByIdTiket[String(idTiket).trim()] = cabangTiket;
      if (normalisasiCabangOperasional_(row[colCabangTiket]) !== cabangTiket) {
        row[colCabangTiket] = cabangTiket;
        sheetTiket.getRange(i + 1, colCabangTiket + 1).setValue(cabangTiket);
        perluFlush = true;
      }
      if (String(row[colAdminSLATiket] || '').trim().toLowerCase() !== roleAdminTiket) {
        row[colAdminSLATiket] = roleAdminTiket;
        sheetTiket.getRange(i + 1, colAdminSLATiket + 1).setValue(roleAdminTiket);
        perluFlush = true;
      }

      var waktuLaporVal = row[2]; var targetSLA = parseFloat(row[3]) || 24; var targetRespon = parseFloat(row[14]) || 1;
      var dtLapor = null;
      if (waktuLaporVal instanceof Date) { dtLapor = waktuLaporVal; } else if (waktuLaporVal && String(waktuLaporVal) !== "#VALUE!") { dtLapor = new Date(String(waktuLaporVal).replace(/-/g, "/")); }
      if (!dtLapor || isNaN(dtLapor.getTime())) dtLapor = new Date();

      // ---------------- MULAI PERBAIKAN doGet ----------------
      if (!row[4] || String(row[4]).indexOf("#VALUE") > -1) { var fixedE = hitungTenggatJamKerja(dtLapor, targetSLA, cabangTiket); row[4] = fixedE; sheetTiket.getRange(i + 1, 5).setValue(fixedE); perluFlush = true; }
      
      var teknisiCek = String(row[7]).trim();
      var statusTiketCek = String(row[8]).trim();

      // [FIX BUG 1] Cegah sistem mengisi target respon diam-diam jika teknisi belum ada!
      if (teknisiCek !== "Belum Ditugaskan" && teknisiCek !== "") {
          if (!row[15] || String(row[15]).indexOf("#VALUE") > -1) { var fixedP = hitungTenggatJamKerja(dtLapor, targetRespon, cabangTiket); row[15] = fixedP; sheetTiket.getRange(i + 1, 16).setValue(fixedP); perluFlush = true; }
      } else {
          row[15] = ""; // Paksa kosong agar aman
      }

      // [FIX BUG 2] Bekukan vonis "TERLAMBAT" dari database jika tiket sedang Dipending / Diopor / Cancel
      if (statusTiketCek === "Pending" || statusTiketCek === "Outsource" || statusTiketCek === "Cancel") {
          row[10] = statusTiketCek === "Cancel" ? "BATAL" : (statusTiketCek === "Outsource" ? "DIOPOR" : "DIPENDING");
      } else if (String(row[10]).indexOf("#VALUE") > -1 || String(row[10]) === "") {
          row[10] = (new Date() > new Date(row[4])) ? "TERLAMBAT" : "AMAN"; 
      }
      
      if (String(row[17]).indexOf("#VALUE") > -1 || String(row[17]) === "") {
          if (teknisiCek === "Belum Ditugaskan" || teknisiCek === "") { row[17] = "AMAN"; } 
          else { row[17] = row[16] ? "TERPENUHI" : ((new Date() > new Date(row[15])) ? "GAGAL" : "AMAN"); }
      }
      // ---------------- SELESAI PERBAIKAN doGet ----------------
      

      for (var j = 0; j < headersTiket.length; j++) { var val = row[j]; if (val === "#VALUE!") val = ""; record[headersTiket[j]] = val; }
      resultTiket.push(record);
    }

    var sheetUsers = ss.getSheetByName("Users"); var resultUsers = [];
    if (!reqTrackId && sheetUsers) {
      var dataUsers = sheetUsers.getDataRange().getValues();
      var headersUsers = dataUsers[0];
      var kolomRahasiaUsers = {"Password": true};
      kolomRahasiaUsers[WEBAUTHN_CREDENTIAL_ID_HEADER] = true;
      kolomRahasiaUsers[WEBAUTHN_PUBLIC_KEY_HEADER] = true;
      for (var i = 1; i < dataUsers.length; i++) {
        var row = dataUsers[i]; var record = {};
        for (var j = 0; j < headersUsers.length; j++) {
          if (!kolomRahasiaUsers[headersUsers[j]]) record[headersUsers[j]] = row[j];
        }
        resultUsers.push(record);
      }
    }

    var sheetPenjualan = ss.getSheetByName("Penjualan"); var resultPenjualan = [];
    if (!reqTrackId && sheetPenjualan) { var dataPenjualan = sheetPenjualan.getDataRange().getValues(); var headersPenjualan = dataPenjualan[0]; for (var i = 1; i < dataPenjualan.length; i++) { var row = dataPenjualan[i]; var record = {}; for (var j = 0; j < headersPenjualan.length; j++) { record[headersPenjualan[j]] = row[j]; } resultPenjualan.push(record); } }

    var sheetProspek = ss.getSheetByName("Prospek"); var resultProspek = [];
    if (!reqTrackId && sheetProspek) { var dataProspek = sheetProspek.getDataRange().getValues(); var headersProspek = dataProspek[0]; for (var i = 1; i < dataProspek.length; i++) { var row = dataProspek[i]; var record = {}; for (var j = 0; j < headersProspek.length; j++) { record[headersProspek[j]] = row[j]; } resultProspek.push(record); } }

    // CRM FASE 1: Database Klien hanya dimuat untuk aplikasi internal, bukan tracking publik.
    var sheetKlien = ss.getSheetByName("Database Klien"); var resultKlien = [];
    if (!reqTrackId && sheetKlien && sheetKlien.getLastRow() > 1) {
      var dataKlien = sheetKlien.getDataRange().getValues();
      var headersKlien = dataKlien[0] || [];
      for (var i = 1; i < dataKlien.length; i++) {
        var row = dataKlien[i];
        if (!row[0]) continue;
        var record = {};
        for (var j = 0; j < headersKlien.length; j++) { record[headersKlien[j]] = row[j]; }
        resultKlien.push(record);
      }
    }

    var sheetGaransi = ss.getSheetByName("Garansi"); var resultGaransi = [];
    if (sheetGaransi) {
      var dataGaransi = sheetGaransi.getDataRange().getValues();
      var headersGaransi = dataGaransi[0];
      if (headersGaransi && headersGaransi.length > 0) {
        var colCabangGaransi = pastikanKolomAkhir_(sheetGaransi, headersGaransi, 'Cabang');
        var colAdminSLAGaransi = pastikanKolomAkhir_(sheetGaransi, headersGaransi, 'Admin SLA');
        for (var i = 1; i < dataGaransi.length; i++) {
            var row = dataGaransi[i]; var record = {};
            if (!row[0]) continue;
            // Jika mode tracking publik, hanya muat garansi milik tiket tersebut
            if (reqTrackId && String(row[1]).toLowerCase() !== reqTrackId) continue;
            var cabangGaransi = cabangDariBaris_(row, headersGaransi, cabangByIdTiket[String(row[1] || '').trim()] || cabangRequest);
            var roleAdminGaransi = roleAdminUntukCabang_(cabangGaransi);
            if (normalisasiCabangOperasional_(row[colCabangGaransi]) !== cabangGaransi) {
                row[colCabangGaransi] = cabangGaransi;
                sheetGaransi.getRange(i + 1, colCabangGaransi + 1).setValue(cabangGaransi);
                perluFlush = true;
            }
            if (String(row[colAdminSLAGaransi] || '').trim().toLowerCase() !== roleAdminGaransi) {
                row[colAdminSLAGaransi] = roleAdminGaransi;
                sheetGaransi.getRange(i + 1, colAdminSLAGaransi + 1).setValue(roleAdminGaransi);
                perluFlush = true;
            }
            if (String(row[5]).trim() === 'Aktif' && row[7]) {
                var tglHabis = row[7] instanceof Date ? row[7] : new Date(row[7]);
                if (!isNaN(tglHabis.getTime()) && new Date() > tglHabis) {
                    row[5] = 'Habis (Expired)'; sheetGaransi.getRange(i + 1, 6).setValue('Habis (Expired)'); perluFlush = true;
                }
            }
            for (var j = 0; j < headersGaransi.length; j++) { record[headersGaransi[j]] = row[j]; }
            resultGaransi.push(record);
        }
      }
    }
    
    if (perluFlush) SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ tickets: resultTiket, users: resultUsers, penjualan: resultPenjualan, prospek: resultProspek, dataKlien: resultKlien, garansi: resultGaransi })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Error Internal doGet: " + err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.apiKey !== SECRET_API_KEY) {
      return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Akses Ditolak!"})).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.action === 'beginBiometricRegistration') {
      try {
        return ContentService.createTextOutput(JSON.stringify(mulaiRegistrasiBiometrik_(data, ss))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('beginBiometricRegistration: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Pendaftaran Passkey tidak dapat dimulai."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'registerBiometric') {
      try {
        return ContentService.createTextOutput(JSON.stringify(registerBiometric_(data, ss))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('registerBiometric: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Pendaftaran Passkey ditolak oleh verifikasi keamanan."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'beginBiometricLogin') {
      try {
        return ContentService.createTextOutput(JSON.stringify(mulaiLoginBiometrik_(data, ss))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('beginBiometricLogin: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Passkey belum tersedia atau permintaan tidak sah."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'verifyBiometric') {
      try {
        return ContentService.createTextOutput(JSON.stringify(verifyBiometric_(data, ss))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('verifyBiometric: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Verifikasi Passkey gagal. Gunakan password sebagai fallback."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'login') {
      var sheetUsers = ss.getSheetByName("Users");
      var dataUsersLogin = sheetUsers ? sheetUsers.getDataRange().getValues() : [];

      if (dataUsersLogin.length > 0) {
        var headerUsersLogin = dataUsersLogin[0];
        var colUsernameLogin = headerUsersLogin.indexOf("Username");
        var colPasswordLogin = headerUsersLogin.indexOf("Password");

        if (colUsernameLogin !== -1 && colPasswordLogin !== -1) {
          for (var i = 1; i < dataUsersLogin.length; i++) {
            if (String(dataUsersLogin[i][colUsernameLogin] || '').trim().toLowerCase() === String(data.username || '').trim().toLowerCase()) {
              var passwordDB = dataUsersLogin[i][colPasswordLogin];
              if (passwordDB === data.passwordHash || passwordDB == data.passwordRaw) {
                var record = sertakanHakAksesCabang_(buatRecordUserAman_(headerUsersLogin, dataUsersLogin[i]));
                // --- GENERATOR SESSION TOKEN (KEAMANAN QA POIN 10) ---
                // Token berlaku 24 jam, ditandatangani HMAC SHA-256, dan tidak memuat password.
                record["SessionToken"] = buatSessionToken_(record["Username"]);
                // ------------------------------------------------------
                return ContentService.createTextOutput(JSON.stringify({"status": "sukses", "user": record, "Hak_Akses_Cabang": record.Hak_Akses_Cabang})).setMimeType(ContentService.MimeType.JSON);
              }
              break;
            }
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Username atau Password tidak valid!"})).setMimeType(ContentService.MimeType.JSON);
    }

    sheetUsers = ss.getSheetByName("Users");
    var sheetTiket = ss.getSheetByName("Tiket") || ss.getSheets()[0];
    var usersData = sheetUsers ? sheetUsers.getDataRange().getValues() : [];

    if (data.action === 'broadcastCRM') {
      var hasilBroadcastCRM = prosesBroadcastCRM_(data, usersData, ss);
      return ContentService.createTextOutput(JSON.stringify(hasilBroadcastCRM)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ===============================================
    // FITUR GARANSI
    // ===============================================
    if (data.action === 'addGaransi') {
      var sheetGaransi = ss.getSheetByName("Garansi");
      if (!sheetGaransi) { 
        sheetGaransi = ss.insertSheet("Garansi"); 
        sheetGaransi.appendRow(["ID Garansi", "Referensi (Tiket/Nota)", "Nama Pelanggan", "Barang / Jasa", "Durasi (Hari)", "Status", "Tanggal Mulai", "Tanggal Habis", "No Transaksi", "Sales", "Omzet", "Keterangan"]); 
        sheetGaransi.getRange("A1:L1").setBackground("#3b82f6").setFontColor("white").setFontWeight("bold"); 
      } else { 
        var cekHeader = sheetGaransi.getRange("A1").getValue(); 
        if (String(cekHeader).trim() !== "ID Garansi") { 
            sheetGaransi.insertRowBefore(1); 
            sheetGaransi.getRange("A1:L1").setValues([["ID Garansi", "Referensi (Tiket/Nota)", "Nama Pelanggan", "Barang / Jasa", "Durasi (Hari)", "Status", "Tanggal Mulai", "Tanggal Habis", "No Transaksi", "Sales", "Omzet", "Keterangan"]]); 
            sheetGaransi.getRange("A1:L1").setBackground("#3b82f6").setFontColor("white").setFontWeight("bold"); 
        } else {
            var seluruhHeader = sheetGaransi.getRange(1, 1, 1, sheetGaransi.getLastColumn()).getValues()[0];
            if (seluruhHeader.indexOf("No Transaksi") === -1) sheetGaransi.getRange(1, 9).setValue("No Transaksi");
            if (seluruhHeader.indexOf("Sales") === -1) sheetGaransi.getRange(1, 10).setValue("Sales");
            if (seluruhHeader.indexOf("Omzet") === -1) sheetGaransi.getRange(1, 11).setValue("Omzet");
            if (seluruhHeader.indexOf("Keterangan") === -1) sheetGaransi.getRange(1, 12).setValue("Keterangan");
        }
      }

      var headerGaransiAdd = sheetGaransi.getRange(1, 1, 1, sheetGaransi.getLastColumn()).getValues()[0];
      var colCabangGaransiAdd = pastikanKolomAkhir_(sheetGaransi, headerGaransiAdd, 'Cabang');
      var colAdminSLAGaransiAdd = pastikanKolomAkhir_(sheetGaransi, headerGaransiAdd, 'Admin SLA');
      
      // Jaring pengaman: semua properti Garansi wajib memiliki nilai aman.
      var idGaransi = data.idGaransi || "";
      var referensiGaransi = data.referensi || "";
      var namaPelanggan = data.pelanggan || "-";
      var barangGaransi = data.barang || "-";
      var statusGaransi = data.status || "-";
      var noTransaksiGaransi = data.noTransaksi || "";
      var salesGaransi = data.sales || "";
      var omzetGaransi = data.omzet || "";
      var keteranganGaransi = data.keteranganGaransi || "";
      var cabangGaransiAdd = String(referensiGaransi).indexOf('TKT-') === 0
        ? cariCabangTiketById_(sheetTiket, referensiGaransi, data.cabang)
        : cabangOperasional_(data.cabang);
      var roleAdminGaransiAdd = roleAdminUntukCabang_(cabangGaransiAdd);
      var tglMulai = ""; var tglHabis = ""; var durasiInt = parseInt(data.durasi, 10);
      if (isNaN(durasiInt)) durasiInt = 0;
      if (statusGaransi === "Aktif" && durasiInt > 0) { 
          var now = new Date(); tglMulai = Utilities.formatDate(now, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss"); 
          var habis = new Date(now.getTime() + (durasiInt * 24 * 3600 * 1000)); tglHabis = Utilities.formatDate(habis, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss"); 
      } else if (durasiInt === 0) { statusGaransi = "Habis (Tanpa Garansi)"; }
      
      var barisGaransiBaru = [idGaransi, referensiGaransi, namaPelanggan, barangGaransi, durasiInt, statusGaransi, tglMulai, tglHabis, noTransaksiGaransi, salesGaransi, omzetGaransi, keteranganGaransi];
      var maxIndexGaransi = Math.max(colCabangGaransiAdd, colAdminSLAGaransiAdd);
      while (barisGaransiBaru.length <= maxIndexGaransi) barisGaransiBaru.push('');
      barisGaransiBaru[colCabangGaransiAdd] = cabangGaransiAdd;
      barisGaransiBaru[colAdminSLAGaransiAdd] = roleAdminGaransiAdd;
      sheetGaransi.appendRow(barisGaransiBaru);
      
      if (String(referensiGaransi).trim() !== "") {
         if (String(referensiGaransi).indexOf("TKT-") === 0) {
            var tiketDataArr = sheetTiket.getDataRange().getValues();
            var colNoTrans = tiketDataArr[0].indexOf("No Transaksi"); if (colNoTrans === -1) colNoTrans = 1;
            for (var t = 1; t < tiketDataArr.length; t++) {
               if (String(tiketDataArr[t][0]).trim() === String(referensiGaransi).trim()) {
                  if (String(noTransaksiGaransi).trim() !== "") sheetTiket.getRange(t + 1, colNoTrans + 1).setValue(noTransaksiGaransi); 
                  
                  // Menerima Poin dari Form Garansi
                  if (data.bobotPoin !== undefined) {
                      var colBobot = tiketDataArr[0].indexOf("Bobot Poin");
                      var colVeto = tiketDataArr[0].indexOf("Veto Admin");
                      if (colBobot !== -1) sheetTiket.getRange(t + 1, colBobot + 1).setValue(data.bobotPoin);
                      if (colVeto !== -1) sheetTiket.getRange(t + 1, colVeto + 1).setValue(data.vetoPoin);
                  }
                  break;
               }
            }
            if (String(salesGaransi).trim() !== "") sinkronisasiSalesDariGaransiKeTiket(sheetTiket, referensiGaransi, salesGaransi, omzetGaransi);
         } else if (String(referensiGaransi).indexOf("SLS-") === 0) {
            var sheetPenjualan = ss.getSheetByName("Penjualan");
            if (sheetPenjualan) {
                var penjData = sheetPenjualan.getDataRange().getValues();
                var colNoTransSls = penjData[0].indexOf("No Transaksi"); if (colNoTransSls === -1) colNoTransSls = 1;
                var colSalesSls = penjData[0].indexOf("Sales");
                var colOmzetSls = penjData[0].indexOf("Nominal (Rp)"); if(colOmzetSls === -1) colOmzetSls = penjData[0].indexOf("Nominal");
                for (var p = 1; p < penjData.length; p++) {
                   if (String(penjData[p][0]).trim() === String(referensiGaransi).trim()) {
                      if (String(noTransaksiGaransi).trim() !== "") sheetPenjualan.getRange(p + 1, colNoTransSls + 1).setValue(noTransaksiGaransi); 
                      if (String(salesGaransi).trim() !== "" && colSalesSls !== -1) sheetPenjualan.getRange(p + 1, colSalesSls + 1).setValue(salesGaransi); 
                      if (String(omzetGaransi).trim() !== "" && colOmzetSls !== -1) sheetPenjualan.getRange(p + 1, colOmzetSls + 1).setValue(omzetGaransi); 
                      break;
                   }
                }
            }
         }
      }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    } else if (data.action === 'aktifkanGaransi') {
      var sheetGaransi = ss.getSheetByName("Garansi");
      if (sheetGaransi) {
        var dataG = sheetGaransi.getDataRange().getValues(); var idTarget = String(data.idGaransi).trim();
        for (var i = 1; i < dataG.length; i++) {
          if (String(dataG[i][0]).trim() === idTarget) {
            var durasiInt = parseInt(dataG[i][4]) || 0; var now = new Date();
            var tglMulai = Utilities.formatDate(now, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss");
            var habis = new Date(now.getTime() + (durasiInt * 24 * 3600 * 1000));
            var tglHabis = Utilities.formatDate(habis, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss");
            sheetGaransi.getRange(i + 1, 6).setValue("Aktif"); sheetGaransi.getRange(i + 1, 7).setValue(tglMulai); sheetGaransi.getRange(i + 1, 8).setValue(tglHabis); break;
          }
        }
      }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    } else if (data.action === 'klaimGaransi') {
      var sheetGaransi = ss.getSheetByName("Garansi");
      if (sheetGaransi) {
        var dataG = sheetGaransi.getDataRange().getValues(); var idTarget = String(data.idGaransi).trim();
        for (var i = 1; i < dataG.length; i++) {
          if (String(dataG[i][0]).trim() === idTarget) {
            sheetGaransi.getRange(i + 1, 6).setValue("Diklaim (Hangus)"); sheetGaransi.getRange(i + 1, 8).setValue(Utilities.formatDate(new Date(), "Asia/Makassar", "yyyy-MM-dd HH:mm:ss")); break;
          }
        }
      }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    } else if (data.action === 'deleteGaransi') {
      var sheetGaransi = ss.getSheetByName("Garansi");
      if (sheetGaransi) { var dataG = sheetGaransi.getDataRange().getValues(); var idTarget = String(data.idGaransi).trim(); for (var i = dataG.length - 1; i >= 1; i--) { if (String(dataG[i][0]).trim() === idTarget) sheetGaransi.deleteRow(i + 1); } }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    // ===============================================
    // FITUR TIKET SLA
    // ===============================================
    } else if (data.action === 'addTicket') {
      var nextRow = sheetTiket.getLastRow() + 1; var sekarang = new Date(); var targetSLA = parseFloat(data.targetSLA) || 24; var targetRespon = parseFloat(data.targetRespon) || 1;
      var cabangTiketBaru = cabangOperasional_(data.cabang);
      var roleAdminTiketBaru = roleAdminUntukCabang_(cabangTiketBaru);
      var tenggatPengerjaan = hitungTenggatJamKerja(sekarang, targetSLA, cabangTiketBaru);
      var teknisiFinal = (!data.teknisi || data.teknisi === "") ? "Belum Ditugaskan" : data.teknisi;
      var tenggatRespon = (teknisiFinal !== "Belum Ditugaskan") ? hitungTenggatJamKerja(sekarang, targetRespon, cabangTiketBaru) : "";

      // [FIX BUG 3] Rumus Database yang kebal terhadap status Pending, Outsource, dan Teknisi Kosong
      var rumusSLA = '=IF(I' + nextRow + '="Pending"; "DIPENDING"; IF(I' + nextRow + '="Outsource"; "DIOPOR"; IF(J' + nextRow + '=""; IF(NOW()>E' + nextRow + '; "TERLAMBAT"; "AMAN"); IF(J' + nextRow + '<=E' + nextRow + '; "TERPENUHI"; "TERLAMBAT"))))';
      var rumusPoin = '=IF(K' + nextRow + '="TERPENUHI"; 10; IF(K' + nextRow + '="TERLAMBAT"; -5; 0))';
      var rumusSLARespon = '=IF(P' + nextRow + '=""; "AMAN"; IF(Q' + nextRow + '=""; IF(NOW()>P' + nextRow + '; "GAGAL"; "AMAN"); IF(Q' + nextRow + '<=P' + nextRow + '; "TERPENUHI"; "GAGAL")))';
      
      // Auto Deteksi Kolom Dinamis (WA Klien, Bobot Poin, Veto Admin)
      var seluruhHeader = sheetTiket.getRange(1, 1, 1, sheetTiket.getLastColumn()).getValues()[0];
      
      var colWA = seluruhHeader.indexOf("No WA Klien");
      if(colWA === -1) { colWA = seluruhHeader.length; sheetTiket.getRange(1, colWA + 1).setValue("No WA Klien"); seluruhHeader.push("No WA Klien"); }
      
      var colBobot = seluruhHeader.indexOf("Bobot Poin");
      if(colBobot === -1) { colBobot = seluruhHeader.length; sheetTiket.getRange(1, colBobot + 1).setValue("Bobot Poin"); seluruhHeader.push("Bobot Poin"); }
      
      var colVeto = seluruhHeader.indexOf("Veto Admin");
      if(colVeto === -1) { colVeto = seluruhHeader.length; sheetTiket.getRange(1, colVeto + 1).setValue("Veto Admin"); seluruhHeader.push("Veto Admin"); }

      var colCabangTiketBaru = pastikanKolomAkhir_(sheetTiket, seluruhHeader, 'Cabang');
      var colAdminSLATiketBaru = pastikanKolomAkhir_(sheetTiket, seluruhHeader, 'Admin SLA');

      var barisBaru = [ data.idTiket, data.noTransaksi || "", sekarang, targetSLA, tenggatPengerjaan, data.klien, data.pekerjaan, teknisiFinal, "Menunggu", "", rumusSLA, rumusPoin, data.sales, "", targetRespon, tenggatRespon, "", rumusSLARespon, "", "", "", "", data.ttdKlienAwal || "", "", "", "", "", "", "", data.nilaiPenjualan, "", "" ];
      
      // Push ke index yang paling ujung
      var maxIndex = Math.max(colWA, colBobot, colVeto, colCabangTiketBaru, colAdminSLATiketBaru);
      while(barisBaru.length <= maxIndex) barisBaru.push("");
      
      barisBaru[colWA] = data.waKlien || "";
      barisBaru[colBobot] = data.bobotPoin || "";
      barisBaru[colVeto] = data.vetoPoin || "Tidak";
      barisBaru[colCabangTiketBaru] = cabangTiketBaru;
      barisBaru[colAdminSLATiketBaru] = roleAdminTiketBaru;
      
      sheetTiket.appendRow(barisBaru);

      // Tiket sudah berhasil dibuat: hentikan reminder follow-up Prospek selama pekerjaan berlangsung.
      var kriteriaProspekTiketBaru = String(data.waKlien || '').trim() || String(data.klien || '').trim();
      updateStatusProspekOtomatis_(kriteriaProspekTiketBaru, 'Proses Servis');

      if(teknisiFinal !== "Belum Ditugaskan") {
        var teknisiArray = teknisiFinal.split(','); var namaSalesTeks = data.sales ? data.sales : "Tidak Ada";
        var teksWA = "⚠️ *TUGAS SLA BARU ALFACOM* ⚠️\n\nAssalamu'alaikum, Anda ditugaskan pada tiket baru:\n\n🎫 *ID Tiket:* " + data.idTiket + "\n🏢 *Klien:* " + data.klien + "\n🛠️ *Pekerjaan:* " + data.pekerjaan + "\n💼 *Sales:* " + namaSalesTeks + "\n⏳ *Batas Respon:* " + targetRespon + " Jam\n⌛ *Batas Selesai:* " + targetSLA + " Jam\n\nMohon segera *Login* ke aplikasi untuk merespon.\n🌐 https://aplikasisla.vercel.app/";
        for (var t = 0; t < teknisiArray.length; t++) { var namaTeknisi = String(teknisiArray[t]).trim().toLowerCase(); for (var idx = 1; idx < usersData.length; idx++) { var namaDiDB = String(usersData[idx][3] || '').trim().toLowerCase(); var noWA = String(usersData[idx][6] || '').trim(); if (namaDiDB === namaTeknisi) { if (noWA !== "") kirimNotifWA(noWA, teksWA); break; } } }
      } else {
        var labelAdminTiketBaru = cabangTiketBaru === 'Raha' ? 'Admin Raha' : 'Admin Kendari';
        var teksAdminTiketBaru = "⚠️ *TIKET BARU MENUNGGU PENUGASAN* ⚠️\n\nAssalamu'alaikum " + labelAdminTiketBaru + ",\nTiket baru Cabang " + cabangTiketBaru + " belum memiliki teknisi:\n\n🎫 *ID Tiket:* " + data.idTiket + "\n🏢 *Klien:* " + data.klien + "\n🛠️ *Pekerjaan:* " + data.pekerjaan + "\n\nSLA distribusi Admin mulai berjalan. Mohon segera tugaskan teknisi.\n🌐 https://aplikasisla.vercel.app/";
        kirimNotifKeAdminCabang_(usersData, cabangTiketBaru, teksAdminTiketBaru);
      }

      // Notif WA Klien (Tiket Baru) atau Fallback ke Sales
      var linkTracking = "https://aplikasisla.vercel.app/?track=" + data.idTiket;
      var pesanKlien = "Assalamu'alaikum, kami dari *Alfacom Multi Solution*.\n\nTiket perbaikan Anda telah terdaftar di sistem kami dengan rincian:\n\n🎫 *ID Tiket:* " + data.idTiket + "\n🏢 *Instansi/Nama:* " + data.klien + "\n🛠️ *Pekerjaan:* " + data.pekerjaan + "\n\nAnda dapat memantau progres pengerjaan & garansi secara live melalui tautan berikut:\n🌐 " + linkTracking + "\n\nTerima kasih atas kepercayaannya.";
      
      if (data.waKlien && String(data.waKlien).trim() !== "") {
          kirimNotifWA(String(data.waKlien).trim(), pesanKlien);
      } else if (data.sales && data.sales !== "" && data.sales !== "-") {
          var pesanSalesPengganti = "⚠️ *(Pesan Otomatis: WA Klien Kosong)* ⚠️\n\n" + pesanKlien + "\n\n_Mohon teruskan pesan di atas ke Klien Anda._";
          var salesArrayTkt = data.sales.split(',');
          for (var s = 0; s < salesArrayTkt.length; s++) {
              var namaSls = String(salesArrayTkt[s]).trim().toLowerCase();
              for (var idx = 1; idx < usersData.length; idx++) {
                  var namaDiDB = String(usersData[idx][3] || '').trim().toLowerCase();
                  var noWA = String(usersData[idx][6] || '').trim();
                  if (namaDiDB === namaSls && noWA !== "") { kirimNotifWA(noWA, pesanSalesPengganti); break; }
              }
          }
      }

      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'editTicket') {
      var tiketData = sheetTiket.getDataRange().getValues();
      var headerTiket = tiketData[0];
      
      var colWA = headerTiket.indexOf("No WA Klien");
      if (colWA === -1) { colWA = headerTiket.length; sheetTiket.getRange(1, colWA + 1).setValue("No WA Klien"); headerTiket.push("No WA Klien"); }
      
      var colBobot = headerTiket.indexOf("Bobot Poin");
      if (colBobot === -1) { colBobot = headerTiket.length; sheetTiket.getRange(1, colBobot + 1).setValue("Bobot Poin"); headerTiket.push("Bobot Poin"); }
      
      var colVeto = headerTiket.indexOf("Veto Admin");
      if (colVeto === -1) { colVeto = headerTiket.length; sheetTiket.getRange(1, colVeto + 1).setValue("Veto Admin"); headerTiket.push("Veto Admin"); }

      var colTeknisiSebelumnya = headerTiket.indexOf("Teknisi Sebelumnya");
      if (colTeknisiSebelumnya === -1) { colTeknisiSebelumnya = headerTiket.length; sheetTiket.getRange(1, colTeknisiSebelumnya + 1).setValue("Teknisi Sebelumnya"); headerTiket.push("Teknisi Sebelumnya"); }

      var colPenaltiTeknisiLama = headerTiket.indexOf("Penalti Teknisi Lama");
      if (colPenaltiTeknisiLama === -1) { colPenaltiTeknisiLama = headerTiket.length; sheetTiket.getRange(1, colPenaltiTeknisiLama + 1).setValue("Penalti Teknisi Lama"); headerTiket.push("Penalti Teknisi Lama"); }

      var colTenggatPengganti = headerTiket.indexOf("Tenggat Pengganti");
      if (colTenggatPengganti === -1) { colTenggatPengganti = headerTiket.length; sheetTiket.getRange(1, colTenggatPengganti + 1).setValue("Tenggat Pengganti"); headerTiket.push("Tenggat Pengganti"); }

      var colCabangTiketEdit = pastikanKolomAkhir_(sheetTiket, headerTiket, 'Cabang');
      var colAdminSLATiketEdit = pastikanKolomAkhir_(sheetTiket, headerTiket, 'Admin SLA');

      for (var i = 1; i < tiketData.length; i++) {
        if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
          var colKeterangan = headerTiket.indexOf("Keterangan");
          var teknisiLama = tiketData[i][7]; var teknisiBaru = (!data.teknisi || data.teknisi === "") ? "Belum Ditugaskan" : data.teknisi;
          var targetSLA = parseFloat(data.targetSLA) || 24; var targetRespon = parseFloat(data.targetRespon) || 1;
          var dtLapor = tiketData[i][2] instanceof Date ? tiketData[i][2] : new Date();
          // Cabang yang sudah tersimpan adalah sumber kebenaran; request hanya fallback untuk data lama.
          var cabangTiketEdit = cabangDariBaris_(tiketData[i], headerTiket, data.cabang);
          var roleAdminTiketEdit = roleAdminUntukCabang_(cabangTiketEdit);
          
          var tenggatPengerjaan = hitungTenggatJamKerja(dtLapor, targetSLA, cabangTiketEdit);
          var sekarang = new Date();
          
          if ((!teknisiLama || teknisiLama === "Belum Ditugaskan" || teknisiLama === "") && teknisiBaru !== "Belum Ditugaskan") { 
            var tenggatResponBaru = hitungTenggatJamKerja(sekarang, targetRespon, cabangTiketEdit);
            sheetTiket.getRange(i + 1, 16).setValue(tenggatResponBaru); 
            
            // CEK KETERLAMBATAN ADMIN SECARA PERMANEN
            var jamKerjaNganggur = hitungDurasiJamKerjaMs(dtLapor, sekarang, cabangTiketEdit) / (1000 * 60 * 60);
            if (jamKerjaNganggur >= 27) {
                var statusPeringatan = String(tiketData[i][18] || "");
                if (statusPeringatan.indexOf("ADMIN_SLA_FAILED") === -1) {
                    sheetTiket.getRange(i + 1, 19).setValue(statusPeringatan + " [ADMIN_SLA_FAILED]");
                }
            }
          }

          if (data.isGantiTeknisi === true && String(teknisiLama || "").trim() !== "" && String(teknisiLama).trim() !== "Belum Ditugaskan") {
            var colStatusSLARespon = headerTiket.indexOf("Status SLA Respon");
            var colStatusSLA = headerTiket.indexOf("Status SLA");
            var colWaktuRespon = headerTiket.indexOf("Waktu Respon");
            var colTenggatRespon = headerTiket.indexOf("Tenggat Respon");
            var statusResponSaatIni = colStatusSLARespon !== -1 ? tiketData[i][colStatusSLARespon] : "";
            var statusPengerjaanSaatIni = colStatusSLA !== -1 ? tiketData[i][colStatusSLA] : "";

            sheetTiket.getRange(i + 1, colTeknisiSebelumnya + 1).setValue(teknisiLama);
            sheetTiket.getRange(i + 1, colPenaltiTeknisiLama + 1).setValue(teknisiLama + " | Respon: " + (statusResponSaatIni || "AMAN") + " | Kerja: " + (statusPengerjaanSaatIni || "AMAN"));

            var tenggatPenggantiBaru = hitungTenggatJamKerja(sekarang, targetSLA, cabangTiketEdit);
            sheetTiket.getRange(i + 1, colTenggatPengganti + 1).setValue(tenggatPenggantiBaru);

            if (colWaktuRespon !== -1) sheetTiket.getRange(i + 1, colWaktuRespon + 1).setValue("");
            var tenggatResponBaru = hitungTenggatJamKerja(sekarang, targetRespon, cabangTiketEdit);
            sheetTiket.getRange(i + 1, colTenggatRespon !== -1 ? colTenggatRespon + 1 : 16).setValue(tenggatResponBaru);

            if (colKeterangan !== -1) {
              var keteranganLama = String(tiketData[i][colKeterangan] || "");
              var auditPergantian = "\n\n[" + Utilities.formatDate(sekarang, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss") + "] 🔄 PERGANTIAN TEKNISI\nDari: " + teknisiLama + "\nKe: " + teknisiBaru;
              sheetTiket.getRange(i + 1, colKeterangan + 1).setValue(keteranganLama + auditPergantian);
            }
          }

          sheetTiket.getRange(i + 1, 2).setValue(data.noTransaksi || ""); 
          sheetTiket.getRange(i + 1, 4).setValue(targetSLA); 
          sheetTiket.getRange(i + 1, 5).setValue(tenggatPengerjaan); 
          sheetTiket.getRange(i + 1, 6).setValue(data.klien); 
          sheetTiket.getRange(i + 1, 7).setValue(data.pekerjaan); 
          sheetTiket.getRange(i + 1, 8).setValue(teknisiBaru); 
          sheetTiket.getRange(i + 1, 13).setValue(data.sales); 
          sheetTiket.getRange(i + 1, 15).setValue(targetRespon); 
          sheetTiket.getRange(i + 1, 30).setValue(data.nilaiPenjualan); 
          
          if(data.waKlien !== undefined) sheetTiket.getRange(i + 1, colWA + 1).setValue(data.waKlien);
          if(data.bobotPoin !== undefined) sheetTiket.getRange(i + 1, colBobot + 1).setValue(data.bobotPoin);
          if(data.vetoPoin !== undefined) sheetTiket.getRange(i + 1, colVeto + 1).setValue(data.vetoPoin);
          if(data.ttdKlienAwal && data.ttdKlienAwal !== "") sheetTiket.getRange(i + 1, 23).setValue(data.ttdKlienAwal);
          sheetTiket.getRange(i + 1, colCabangTiketEdit + 1).setValue(cabangTiketEdit);
          sheetTiket.getRange(i + 1, colAdminSLATiketEdit + 1).setValue(roleAdminTiketEdit);
          
          var arrLama = (teknisiLama && teknisiLama !== "Belum Ditugaskan") ? String(teknisiLama).split(',').map(function(s){return s.trim().toLowerCase();}) : []; 
          var arrBaru = (teknisiBaru && teknisiBaru !== "Belum Ditugaskan") ? String(teknisiBaru).split(',').map(function(s){return s.trim().toLowerCase();}) : []; 
          var teknisiDitambahkan = []; for (var b = 0; b < arrBaru.length; b++) { if (arrLama.indexOf(arrBaru[b]) === -1) { teknisiDitambahkan.push(arrBaru[b]); } }
          
          if (teknisiDitambahkan.length > 0) {
              var namaSalesTeks = data.sales ? data.sales : "Tidak Ada";
              var isGantiTeknisi = data.isGantiTeknisi === true;
              var headerPesan = isGantiTeknisi ? "🔄 *PEMBERITAHUAN: TUGAS PENGGANTI*" : "🆕 *TUGAS BARU (UPDATE)*";
              var pesanTeknisi = headerPesan + "\n\nBismillah, antum mendapat penugasan untuk tiket *" + data.idTiket + "*.\n\n🏢 *Klien:* " + data.klien + "\n🛠️ *Pekerjaan:* " + data.pekerjaan + "\n💼 *Sales:* " + namaSalesTeks + "\n⏳ *Batas Respon:* " + targetRespon + " Jam\n⌛ *Batas Selesai:* " + targetSLA + " Jam\n\nMohon segera *Login* ke aplikasi untuk merespon tiket ini.\n🌐 https://aplikasisla.vercel.app/";
              for (var t = 0; t < teknisiDitambahkan.length; t++) { var namaTeknisi = teknisiDitambahkan[t]; for (var idx = 1; idx < usersData.length; idx++) { var namaDiDB = String(usersData[idx][3] || '').toLowerCase().trim(); var noWA = String(usersData[idx][6] || '').trim(); if (namaDiDB === namaTeknisi) { if(noWA !== "") kirimNotifWA(noWA, pesanTeknisi); break; } } }
          }
          SpreadsheetApp.flush(); break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'updateTicket') {
      var tiketData = sheetTiket.getDataRange().getValues(); 
      var waktuSekarang = new Date(); var waktuSekarangStr = Utilities.formatDate(waktuSekarang, "Asia/Makassar", "yyyy-MM-dd HH:mm:ss");
      var headerTiket = tiketData[0];
      var colWA_Upd = headerTiket.indexOf("No WA Klien");
      var colCabangTiketUpdate = pastikanKolomAkhir_(sheetTiket, headerTiket, 'Cabang');
      var colAdminSLATiketUpdate = pastikanKolomAkhir_(sheetTiket, headerTiket, 'Admin SLA');
      
      for (var i = 1; i < tiketData.length; i++) {
        if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
          var statusLama = String(tiketData[i][8] || "").trim(); var waktuResponLama = tiketData[i][16]; 
          var namaKlienInfo = tiketData[i][5] || "-"; var pekerjaanAwal = tiketData[i][6] || "-"; var namaTeknisiInfo = tiketData[i][7] || "-"; var statusBaru = String(data.status || "-").trim();
          // Cegah update status memindahkan beban SLA tiket ke cabang lain.
          var cabangTiketUpdate = cabangDariBaris_(tiketData[i], headerTiket, data.cabang);
          var roleAdminTiketUpdate = roleAdminUntukCabang_(cabangTiketUpdate);
          var waKlienDB = (colWA_Upd !== -1 && tiketData[i].length > colWA_Upd) ? tiketData[i][colWA_Upd] : "";
          var kriteriaProspekTiket = String(waKlienDB || '').trim() || String(namaKlienInfo || '').trim();
          var catatanBaru = data.keterangan ? String(data.keterangan).trim() : "";
          
          if (((statusBaru === 'Pending' || statusBaru === 'Outsource') && (statusLama !== 'Pending' && statusLama !== 'Outsource')) || (statusBaru === 'Outsource' && statusLama === 'Outsource' && catatanBaru !== "")) { 
              sheetTiket.getRange(i + 1, 32).setValue(waktuSekarangStr); 
          }
          if ((statusLama === 'Pending' || statusLama === 'Outsource') && statusBaru === 'On Progress') {
            var waktuMulaiPending = tiketData[i].length > 31 ? tiketData[i][31] : null; var tenggatLama = tiketData[i][4]; 
            if (waktuMulaiPending && tenggatLama) {
                var dtMulaiPending = (waktuMulaiPending instanceof Date) ? waktuMulaiPending : new Date(String(waktuMulaiPending).replace(/-/g, "/"));
                var dtTenggatLama = (tenggatLama instanceof Date) ? tenggatLama : new Date(tenggatLama);
                if (!isNaN(dtMulaiPending.getTime()) && !isNaN(dtTenggatLama.getTime())) {
                    var durasiHilangMs = hitungDurasiJamKerjaMs(dtMulaiPending, waktuSekarang, cabangTiketUpdate);
                    if (durasiHilangMs > 0) { var tenggatBaru = hitungTenggatJamKerja(dtTenggatLama, durasiHilangMs / (3600 * 1000), cabangTiketUpdate); sheetTiket.getRange(i + 1, 5).setValue(tenggatBaru); }
                }
            }
            sheetTiket.getRange(i + 1, 32).setValue(""); 
          }

          sheetTiket.getRange(i + 1, 9).setValue(statusBaru); sheetTiket.getRange(i + 1, 14).setValue(catatanBaru || "-"); 
          sheetTiket.getRange(i + 1, colCabangTiketUpdate + 1).setValue(cabangTiketUpdate);
          sheetTiket.getRange(i + 1, colAdminSLATiketUpdate + 1).setValue(roleAdminTiketUpdate);
          if (statusLama === 'Menunggu' && statusBaru !== 'Menunggu' && !waktuResponLama) { sheetTiket.getRange(i + 1, 17).setValue(waktuSekarangStr); }
          if (statusBaru === 'Selesai') { if (statusLama !== 'Selesai') { sheetTiket.getRange(i + 1, 10).setValue(waktuSekarangStr); } } else { sheetTiket.getRange(i + 1, 10).setValue(""); }
          if (data.baDeskripsi !== undefined) { sheetTiket.getRange(i + 1, 20).setValue(data.baDeskripsi); sheetTiket.getRange(i + 1, 21).setValue(data.baNamaCustomer); sheetTiket.getRange(i + 1, 22).setValue(data.baKritik); if (data.baTTD && data.baTTD !== "") { sheetTiket.getRange(i + 1, 23).setValue(data.baTTD); } }

          // AUTOMASI CLOSING LEVEL 2: Prospek berubah hanya saat tiket mencapai status final.
          var statusTiketFinal = statusBaru.toLowerCase();
          if (statusTiketFinal === 'selesai') {
              updateStatusProspekOtomatis_(kriteriaProspekTiket, 'Closing');
          } else if (statusTiketFinal === 'batal' || statusTiketFinal === 'cancel') {
              updateStatusProspekOtomatis_(kriteriaProspekTiket, 'Batal');
          }

          if (statusBaru === 'Selesai' && statusLama !== 'Selesai') {
              var produkTiketCRM = tiketData[i][6] || data.baDeskripsi || data.keterangan || '';
              sinkronkanDatabaseKlien_(namaKlienInfo, waKlienDB, 'Tiket Selesai', produkTiketCRM);

              // Notif Ke Admin
              var labelAdminTiketUpdate = cabangTiketUpdate === 'Raha' ? 'Admin Raha' : 'Admin Kendari';
              var teksAdminNotaWA = "✅ *PEKERJAAN SELESAI (MENUNGGU NOTA)* ✅\n\nAssalamu'alaikum " + labelAdminTiketUpdate + ",\nTeknisi telah menyelesaikan pekerjaan Cabang " + cabangTiketUpdate + ":\n\n🎫 *ID Tiket:* " + data.idTiket + "\n🏢 *Klien:* " + namaKlienInfo + "\n\nSLA Admin (9 Jam Kerja) untuk membuat Nota & mendaftarkan Garansi mulai berjalan. Mohon segera diproses!\n🌐 https://aplikasisla.vercel.app/";
              kirimNotifKeAdminCabang_(usersData, cabangTiketUpdate, teksAdminNotaWA);

              // FITUR BARU: Notif WA Klien (Tiket Selesai) atau Fallback ke Sales
              var linkT = "https://aplikasisla.vercel.app/?track=" + data.idTiket;
              var pesanK = "✅ *PEKERJAAN SELESAI*\n\nBismillah. Pelanggan Yth. (Bpk/Ibu " + namaKlienInfo + "),\n\nKami informasikan bahwa pekerjaan untuk tiket *" + data.idTiket + "* dengan rincian:\n*\"" + pekerjaanAwal + "\"*\n\nTelah SELESAI dikerjakan oleh tim kami. Terima kasih atas kepercayaannya kepada Alfacom!\n\nSilakan cek Berita Acara dan Status Garansi Anda pada tautan berikut:\n🌐 " + linkT;

              if (waKlienDB && String(waKlienDB).trim() !== "") {
                  kirimNotifWA(String(waKlienDB).trim(), pesanK);
              } else {
                  var namaSalesInfo = tiketData[i][12]; // Membaca kolom Sales
                  if (namaSalesInfo && namaSalesInfo !== "" && namaSalesInfo !== "-") {
                      var pesanSalesSelesai = "⚠️ *(Pesan Otomatis: WA Klien Kosong)* ⚠️\n\n" + pesanK + "\n\n_Mohon teruskan link di atas ke Klien Anda._";
                      var salesArr = String(namaSalesInfo).split(',');
                      for (var s = 0; s < salesArr.length; s++) {
                          var nSls = String(salesArr[s]).trim().toLowerCase();
                          for (var u = 1; u < usersData.length; u++) {
                              var nDB = String(usersData[u][3] || '').trim().toLowerCase();
                              var waSls = String(usersData[u][6] || '').trim();
                              if (nDB === nSls && waSls !== "") { kirimNotifWA(waSls, pesanSalesSelesai); break; }
                          }
                      }
                  }
              }

              // Pembuatan PDF
              try {
                  var ttdImg = (data.baTTD && data.baTTD !== "") ? data.baTTD : (tiketData[i][22] || ""); 
                  // Ubah karakter Enter menjadi tag baris baru agar terbaca oleh konverter HTML ke PDF.
                  var deskripsiRaw = data.baDeskripsi || tiketData[i][19] || "-";
                  var deskripsi = String(deskripsiRaw).replace(/\r?\n/g, '<br>');

                  var customer = data.baNamaCustomer || tiketData[i][20] || "-"; 

                  var kritikRaw = data.baKritik || tiketData[i][21] || "-";
                  var kritik = String(kritikRaw).replace(/\r?\n/g, '<br>');
                  var logoUrl = "https://aplikasisla.vercel.app/depan_001.png";
                  
                  // FITUR MULTI-TEKNISI UNTUK PDF
                  var teknisiArr = String(namaTeknisiInfo).split(',').map(function(s){return s.trim();}).filter(function(s){return s!=="" && s!=="-" && s!=="Belum Ditugaskan";});
                  var teknisiNamesHtml = "";
                  if(teknisiArr.length > 0) {
                      for(var x=0; x<teknisiArr.length; x++) {
                          // Menambahkan stempel digital otomatis untuk setiap teknisi
                          teknisiNamesHtml += "<div style='margin-bottom: 25px;'><div style='color:#10b981; font-size:12px; font-weight:bold; font-style:italic; margin-bottom:5px;'>&#10004; Disahkan via Sistem SLA</div><b>(" + teknisiArr[x] + ")</b></div>";
                      }
                  } else {
                      teknisiNamesHtml = "<br><br><br><b>(...........................)</b>";
                  }

                  var htmlTemplate = "<div style='font-family: Arial, sans-serif; padding: 40px; color: #333;'><div style='text-align: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 20px; margin-bottom: 30px;'><img src='" + logoUrl + "' style='height: 65px; margin-bottom: 12px;' /><h2 style='color: #1e3a8a; margin: 0; font-size:24px;'>BERITA ACARA PENYELESAIAN PEKERJAAN</h2><h3 style='margin: 8px 0 0 0; color: #555; font-size:16px;'>CV. ALFACOM MULTI SOLUTION</h3></div><table style='width: 100%; margin-bottom: 30px; font-size: 15px; line-height: 1.8;'><tr><td width='30%'><b>ID Tiket SLA</b></td><td>: <b>" + data.idTiket + "</b></td></tr><tr><td><b>Tanggal Penyelesaian</b></td><td>: " + waktuSekarangStr + "</td></tr><tr><td><b>Nama Klien / Lokasi</b></td><td>: " + namaKlienInfo + "</td></tr><tr><td><b>Teknisi Pelaksana</b></td><td>: " + namaTeknisiInfo + "</td></tr></table><h4 style='background: #f8fafc; padding: 12px; margin-bottom: 10px; border-left: 4px solid #1e3a8a;'>Rincian Instalasi / Pekerjaan:</h4><p style='font-size: 15px; margin-top: 0; min-height: 80px; line-height: 1.6;'>" + deskripsi + "</p><h4 style='background: #fefce8; padding: 12px; margin-bottom: 10px; border-left: 4px solid #f59e0b;'>Catatan / Kepuasan Pelanggan:</h4><p style='font-size: 15px; margin-top: 0; min-height: 40px; line-height: 1.6;'>" + kritik + "</p><table style='width: 100%; margin-top: 50px; text-align: center; font-size: 15px;'><tr><td width='50%' style='vertical-align: top;'><b>Klien / PIC</b><br><div style='min-height: 100px; margin-top: 15px;'>" + (ttdImg.length > 50 ? "<img src='" + ttdImg + "' style='max-width: 200px; max-height: 120px;'>" : "<br><br><br>") + "</div><b>(" + customer + ")</b></td><td width='50%' style='vertical-align: top;'><b>Teknisi Alfacom</b><br><div style='margin-top: 15px;'>" + teknisiNamesHtml + "</div></td></tr></table></div>";
                  
                  var blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).setName("BA_" + data.idTiket + ".pdf"); var pdfFile = blob.getAs(MimeType.PDF); var folderIterator = DriveApp.getFoldersByName("Berita Acara Alfacom"); var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Berita Acara Alfacom"); var savedFile = folder.createFile(pdfFile); savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); sheetTiket.getRange(i + 1, 31).setValue(savedFile.getUrl());
              } catch(e) {}
          }

          SpreadsheetApp.flush(); break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'deleteTicket') {
      var tiketData = sheetTiket.getDataRange().getValues(); var idTarget = String(data.idTiket).trim();
      for (var i = tiketData.length - 1; i >= 1; i--) { if (String(tiketData[i][0]).trim() === idTarget) sheetTiket.deleteRow(i + 1); }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'tandaiLunas') {
      var tiketData = sheetTiket.getDataRange().getValues();
      var headerTiket = tiketData[0];
      
      // Auto-buat kolom Status Pembayaran & Tanggal Lunas jika belum ada
      var colStatusBayar = headerTiket.indexOf("Status Pembayaran");
      if (colStatusBayar === -1) { colStatusBayar = headerTiket.length; sheetTiket.getRange(1, colStatusBayar + 1).setValue("Status Pembayaran"); headerTiket.push("Status Pembayaran"); }
      var colTglLunas = headerTiket.indexOf("Tanggal Lunas");
      if (colTglLunas === -1) { colTglLunas = headerTiket.length; sheetTiket.getRange(1, colTglLunas + 1).setValue("Tanggal Lunas"); headerTiket.push("Tanggal Lunas"); }

      var waktuSekarangStr = Utilities.formatDate(new Date(), "Asia/Makassar", "yyyy-MM-dd HH:mm:ss");

      for (var i = 1; i < tiketData.length; i++) {
        if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
          sheetTiket.getRange(i + 1, colStatusBayar + 1).setValue("Lunas");
          sheetTiket.getRange(i + 1, colTglLunas + 1).setValue(waktuSekarangStr);
          SpreadsheetApp.flush(); break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
      

    // ===============================================
    // FITUR USER, PENJUALAN & PROSPEK
    // ===============================================
    } else if (data.action === 'addUser' || data.action === 'editUser') {
      if(sheetUsers) {
          var dataU = sheetUsers.getDataRange().getValues();
          var headers = dataU[0];
          var colUsername = headers.indexOf("Username"); var colPassword = headers.indexOf("Password"); var colRole = headers.indexOf("Role");
          var colNama = headers.indexOf("Nama Asli"); var colEmail = headers.indexOf("Email");
          var colTarget = headers.indexOf("Target Sales"); if(colTarget === -1) colTarget = headers.indexOf("Target Sales (Rp)"); if(colTarget === -1) colTarget = headers.indexOf("Target");
          var colWA = headers.indexOf("No WA");
          
          // PENAMBAHAN DETEKSI KOLOM GAJI & BONUS
          var colGapok = headers.indexOf("Gaji Pokok"); if(colGapok === -1) colGapok = headers.indexOf("Gaji Pokok (Rp)");
          var colBonus = headers.indexOf("Bonus Tambahan"); if(colBonus === -1) colBonus = headers.indexOf("Bonus");
          
          if(data.action === 'addUser') {
              var newRow = new Array(headers.length).fill("");
              if(colUsername !== -1) newRow[colUsername] = data.username;
              if(colPassword !== -1) newRow[colPassword] = data.password;
              if(colRole !== -1) newRow[colRole] = data.role;
              if(colNama !== -1) newRow[colNama] = data.namaAsli;
              if(colEmail !== -1) newRow[colEmail] = data.email;
              if(colTarget !== -1) newRow[colTarget] = data.targetSales;
              if(colWA !== -1) newRow[colWA] = data.noWA;
              
              // SIMPAN GAJI & BONUS
              if(colGapok !== -1) newRow[colGapok] = data.gajiPokok || "";
              if(colBonus !== -1) newRow[colBonus] = data.bonusTambahan || "";
              
              sheetUsers.appendRow(newRow);
          } else {
              var found = false;
              for(var i=1; i<dataU.length; i++){
                  if(String(dataU[i][colUsername]).trim() === String(data.username).trim()){
                      if(data.password && data.password !== "" && colPassword !== -1) sheetUsers.getRange(i+1, colPassword+1).setValue(data.password);
                      if(colRole !== -1) sheetUsers.getRange(i+1, colRole+1).setValue(data.role);
                      if(colNama !== -1) sheetUsers.getRange(i+1, colNama+1).setValue(data.namaAsli);
                      if(colEmail !== -1) sheetUsers.getRange(i+1, colEmail+1).setValue(data.email);
                      if(colTarget !== -1) sheetUsers.getRange(i+1, colTarget+1).setValue(data.targetSales);
                      if(colWA !== -1) sheetUsers.getRange(i+1, colWA+1).setValue(data.noWA);
                      
                      // UPDATE GAJI KE DATABASE (Tunjangan Permanen sekarang diatur via Slip Gaji)
                      if(colGapok !== -1) sheetUsers.getRange(i+1, colGapok+1).setValue(data.gajiPokok || "");
                      
                      found = true; break;
                  }
              }
              if(!found) return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "User tidak ditemukan di database!"})).setMimeType(ContentService.MimeType.JSON);
          }
      } else { return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sheet Users tidak ada!"})).setMimeType(ContentService.MimeType.JSON); }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'getVariabelPayroll') {
      try {
        var dataPayrollBulanan = ambilVariabelPayrollBackend(data.periode, data.namaPegawai);
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses", "data": dataPayrollBulanan})).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": err.toString()})).setMimeType(ContentService.MimeType.JSON);
      }

    } else if (data.action === 'simpanVariabelPayroll') {
      try {
        var payrollTersimpan = simpanVariabelPayrollBackend(data.periode, data.namaPegawai, data.fee, data.kasbon, data.luarKota, data.diubahOleh);
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses", "data": payrollTersimpan})).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": err.toString()})).setMimeType(ContentService.MimeType.JSON);
      }

    } else if (data.action === 'updateTunjangan') {
      if (sheetUsers) { 
        var dataU = sheetUsers.getDataRange().getValues(); 
        var idTarget = String(data.namaAsli).trim(); 
        var colNama = dataU[0].indexOf("Nama Asli");
        var colBonus = dataU[0].indexOf("Bonus Tambahan"); 
        if(colBonus === -1) colBonus = dataU[0].indexOf("Bonus");
        
        if(colNama !== -1 && colBonus !== -1) {
            for (var i = 1; i < dataU.length; i++) { 
                if (String(dataU[i][colNama]).trim() === idTarget) {
                    sheetUsers.getRange(i + 1, colBonus + 1).setValue(data.tunjanganData);
                    break;
                } 
            } 
        }
      }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
      
    } else if (data.action === 'deleteUser')  {
      if (sheetUsers) { 
        var dataU = sheetUsers.getDataRange().getValues(); var idTarget = String(data.username).trim(); var colUsername = dataU[0].indexOf("Username");
        if(colUsername !== -1 && idTarget.toLowerCase() !== 'admin') {
            for (var i = dataU.length - 1; i >= 1; i--) { if (String(dataU[i][colUsername]).trim() === idTarget) sheetUsers.deleteRow(i + 1); } 
        }
      }
      SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'addPenjualan') {
        var sheetPenjualan = ss.getSheetByName("Penjualan");

        // === ANTI-DOUBLE INPUT PENJUALAN ===
        var noTransBaru = String(data.noTransaksi || "").trim().toLowerCase();
        if (noTransBaru !== "") {
            var dataPj = sheetPenjualan.getDataRange().getValues();
            var colNoTrans = dataPj[0].indexOf("No Transaksi");
            if (colNoTrans === -1) colNoTrans = 1; // Fallback jika header tidak ketemu

            for (var p = dataPj.length - 1; p > 0; p--) {
                if (String(dataPj[p][colNoTrans]).trim().toLowerCase() === noTransBaru) {
                    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "No Transaksi / SO '" + data.noTransaksi + "' sudah pernah diinput ke sistem! Duplikasi omzet dicegah."})).setMimeType(ContentService.MimeType.JSON);
                }
            }
        }
        // ===================================

        if(sheetPenjualan) {
            sheetPenjualan.appendRow([data.idPenjualan, data.noTransaksi, new Date(), data.pembeli, data.barang, data.sales, data.nilaiPenjualan]);
            // Penjualan belum memiliki kolom No WA, sehingga Nama Pembeli menjadi kriteria pencarian Prospek.
            updateStatusProspekOtomatis_(data.pembeli, 'Closing');
            var noWaPenjualanCRM = data.noWaKlien || data.noWa || data.waKlien || cariNoWAProspekBerdasarkanNama_(data.pembeli);
            sinkronkanDatabaseKlien_(data.pembeli, noWaPenjualanCRM, 'Penjualan', data.barang || '');
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'deletePenjualan') {
        var sheetPenjualan = ss.getSheetByName("Penjualan");
        if (sheetPenjualan) {
            var dataP = sheetPenjualan.getDataRange().getValues();
            for (var i = dataP.length - 1; i >= 1; i--) { if (String(dataP[i][0]).trim() === String(data.idPenjualan).trim()) sheetPenjualan.deleteRow(i + 1); }
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'addProspek') {
        var sheetProspek = ss.getSheetByName("Prospek");
        if(sheetProspek) {
            var header = sheetProspek.getRange(1, 1, 1, sheetProspek.getLastColumn()).getValues()[0];
            
            // Auto-buat kolom "No WA" jika belum ada di database Prospek
            var colWA = header.indexOf("No WA");
            if (colWA === -1) { 
                colWA = header.length; 
                sheetProspek.getRange(1, colWA + 1).setValue("No WA"); 
                header.push("No WA"); 
            }

            var newRow = new Array(header.length).fill("");
            if (colWA !== -1) newRow[colWA] = data.waCustomer || "";
            if (header.indexOf("ID Prospek") !== -1) newRow[header.indexOf("ID Prospek")] = data.idProspek;
            if (header.indexOf("Tanggal Input") !== -1) newRow[header.indexOf("Tanggal Input")] = new Date();
            if (header.indexOf("Nama Calon Customer") !== -1) newRow[header.indexOf("Nama Calon Customer")] = data.customer;
            if (header.indexOf("Kebutuhan") !== -1) newRow[header.indexOf("Kebutuhan")] = data.kebutuhan;
            if (header.indexOf("Sales Penanggung Jawab") !== -1) newRow[header.indexOf("Sales Penanggung Jawab")] = data.sales;
            if (header.indexOf("Status Prospek") !== -1) newRow[header.indexOf("Status Prospek")] = data.statusProspek;
            if (header.indexOf("Estimasi (Rp)") !== -1) newRow[header.indexOf("Estimasi (Rp)")] = data.estimasi;
            if(data.buktiChat && data.buktiChat !== "") {
                try {
                    var blob = Utilities.newBlob(Utilities.base64Decode(data.buktiChat.split(',')[1]), 'image/jpeg', data.idProspek + '_Chat.jpg');
                    var folderIterator = DriveApp.getFoldersByName("Bukti Prospek Alfacom"); var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Bukti Prospek Alfacom"); 
                    var savedFile = folder.createFile(blob); savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                    if (header.indexOf("Bukti Chat") !== -1) newRow[header.indexOf("Bukti Chat")] = savedFile.getUrl();
                } catch(e) {}
            }
            sheetProspek.appendRow(newRow);
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'updateProspekStatus') {
        var sheetProspek = ss.getSheetByName("Prospek");
        if(sheetProspek) {
            var dataP = sheetProspek.getDataRange().getValues(); var header = dataP[0];
            var colId = header.indexOf("ID Prospek"); var colStatus = header.indexOf("Status Prospek"); var colEstimasi = header.indexOf("Estimasi (Rp)"); var colPenawaran = header.indexOf("Surat Penawaran");
            var colSalesProspekSP = header.indexOf("Sales Penanggung Jawab");
            if (data.suratPenawaran && data.suratPenawaran !== "" && colPenawaran === -1) {
                colPenawaran = header.length;
                sheetProspek.getRange(1, colPenawaran + 1).setValue("Surat Penawaran");
                header.push("Surat Penawaran");
            }
            var colWaktuSelesaiPenawaran = header.indexOf("Waktu Selesai Penawaran");
            if (data.suratPenawaran && data.suratPenawaran !== "" && colWaktuSelesaiPenawaran === -1) {
                colWaktuSelesaiPenawaran = header.length;
                sheetProspek.getRange(1, colWaktuSelesaiPenawaran + 1).setValue("Waktu Selesai Penawaran");
                header.push("Waktu Selesai Penawaran");
            }
            for(var i=1; i<dataP.length; i++) {
                if(String(dataP[i][colId]).trim() === String(data.idProspek).trim()) {
                    if (data.statusBaru && colStatus !== -1) sheetProspek.getRange(i+1, colStatus+1).setValue(data.statusBaru);
                    if (data.estimasi !== undefined && colEstimasi !== -1) sheetProspek.getRange(i+1, colEstimasi+1).setValue(data.estimasi);
                    if (data.suratPenawaran && data.suratPenawaran !== "") {
                        try {
                            var isPDF = data.suratPenawaran.indexOf('application/pdf') !== -1; var mime = isPDF ? 'application/pdf' : 'image/jpeg'; var ext = isPDF ? '.pdf' : '.jpg';
                            var blob = Utilities.newBlob(Utilities.base64Decode(data.suratPenawaran.split(',')[1]), mime, "Penawaran_" + data.idProspek + ext);
                            var folderIterator = DriveApp.getFoldersByName("Surat Penawaran Alfacom"); var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Surat Penawaran Alfacom"); 
                            var savedFile = folder.createFile(blob); savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                            if (colPenawaran !== -1) sheetProspek.getRange(i+1, colPenawaran+1).setValue(savedFile.getUrl());
                            // Mengisi waktu selesai menghentikan argo SLA SP/Revisi di frontend.
                            sheetProspek.getRange(i+1, colWaktuSelesaiPenawaran+1).setValue(new Date());

                            // Notifikasi Fonnte dikirim ke semua Sales yang menangani Prospek ini.
                            var daftarNamaSalesSP = colSalesProspekSP !== -1 ? String(dataP[i][colSalesProspekSP] || '').split(',') : [];
                            var pesanSPSelesai = "✅ *SURAT PENAWARAN SELESAI*\n\nBismillah. Surat Penawaran untuk prospek " + data.idProspek + " telah diunggah oleh Admin. Silakan cek aplikasi untuk mengunduh dan mengirimkannya ke klien.";
                            var headerUsersSPSelesai = usersData[0] || [];
                            var colNamaUsersSPSelesai = headerUsersSPSelesai.indexOf("Nama Asli");
                            var colRoleUsersSPSelesai = headerUsersSPSelesai.indexOf("Role");
                            var colWaUsersSPSelesai = headerUsersSPSelesai.indexOf("No WA");

                            if (colNamaUsersSPSelesai !== -1 && colWaUsersSPSelesai !== -1) {
                                for (var u = 1; u < usersData.length; u++) {
                                    var namaUserSP = String(usersData[u][colNamaUsersSPSelesai] || '').trim().toLowerCase();
                                    var roleUserSP = colRoleUsersSPSelesai !== -1 ? String(usersData[u][colRoleUsersSPSelesai] || '').trim().toLowerCase() : 'sales';
                                    var salesCocok = daftarNamaSalesSP.some(function(namaSales) {
                                        return String(namaSales || '').trim().toLowerCase() === namaUserSP;
                                    });
                                    if (salesCocok && roleUserSP === 'sales') {
                                        var noWaSales = String(usersData[u][colWaUsersSPSelesai] || '').trim();
                                        if (noWaSales !== '') kirimNotifWA(noWaSales, pesanSPSelesai);
                                    }
                                }
                            }
                        } catch(e) {
                            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Gagal menyimpan Surat Penawaran: " + e.toString()})).setMimeType(ContentService.MimeType.JSON);
                        }
                    }
                    break;
                }
            }
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'addFollowUpProspek') {
        var sheetProspek = ss.getSheetByName("Prospek");
        if (!sheetProspek) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sheet Prospek tidak ada!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var dataP = sheetProspek.getDataRange().getValues();
        var header = dataP[0];
        var colId = header.indexOf("ID Prospek");
        if (colId === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Kolom ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var colWaktuFollowUp = header.indexOf("Waktu Follow Up Terakhir");
        if (colWaktuFollowUp === -1) {
            colWaktuFollowUp = header.length;
            sheetProspek.getRange(1, colWaktuFollowUp + 1).setValue("Waktu Follow Up Terakhir");
            header.push("Waktu Follow Up Terakhir");
        }

        var colRiwayatFollowUp = header.indexOf("Riwayat Follow Up");
        if (colRiwayatFollowUp === -1) {
            colRiwayatFollowUp = header.length;
            sheetProspek.getRange(1, colRiwayatFollowUp + 1).setValue("Riwayat Follow Up");
            header.push("Riwayat Follow Up");
        }

        var barisProspek = -1;
        for (var i = 1; i < dataP.length; i++) {
            if (String(dataP[i][colId]).trim() === String(data.idProspek).trim()) {
                barisProspek = i + 1;
                break;
            }
        }
        if (barisProspek === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }
        if (!data.buktiFollowUp || String(data.buktiFollowUp).indexOf(',') === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Bukti chat Follow Up tidak valid!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var waktuFollowUp = new Date();
        var folderIterator = DriveApp.getFoldersByName("Bukti Prospek Alfacom");
        var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Bukti Prospek Alfacom");
        var blob = Utilities.newBlob(Utilities.base64Decode(data.buktiFollowUp.split(',')[1]), 'image/jpeg', "FollowUp_" + data.idProspek + "_" + waktuFollowUp.getTime() + ".jpg");
        var savedFile = folder.createFile(blob);
        savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        var waktuTeks = Utilities.formatDate(waktuFollowUp, "Asia/Makassar", "dd/MM/yyyy HH:mm");
        var riwayatBaru = "[" + waktuTeks + "] " + (data.namaSales || "-") + "\nKeterangan: " + (data.keterangan || "-") + "\nBukti: " + savedFile.getUrl();
        var riwayatLama = String(sheetProspek.getRange(barisProspek, colRiwayatFollowUp + 1).getValue() || "").trim();
        var riwayatGabungan = riwayatLama ? riwayatLama + "\n\n" + riwayatBaru : riwayatBaru;

        sheetProspek.getRange(barisProspek, colWaktuFollowUp + 1).setValue(waktuFollowUp);
        sheetProspek.getRange(barisProspek, colRiwayatFollowUp + 1).setValue(riwayatGabungan).setWrap(true);
        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'prosesRevisiSP') {
        try {
            prosesRevisiSPBackend(data.idProspek, data.catatan, data.namaSales);
            return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
        } catch (err) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": err.toString()})).setMimeType(ContentService.MimeType.JSON);
        }

    } else if (data.action === 'mintaPenawaran') {
        var sheetProspekPenawaran = ss.getSheetByName("Prospek");
        if (!sheetProspekPenawaran) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sheet Prospek tidak ada!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var dataProspekPenawaran = sheetProspekPenawaran.getDataRange().getValues();
        var headerProspekPenawaran = dataProspekPenawaran[0] || [];
        var colIdPenawaran = headerProspekPenawaran.indexOf("ID Prospek");
        var colSalesPenawaran = headerProspekPenawaran.indexOf("Sales Penanggung Jawab");
        var colKlienPenawaran = headerProspekPenawaran.indexOf("Nama Calon Customer");
        if (colIdPenawaran === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Kolom ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var colWaktuMinta = headerProspekPenawaran.indexOf("Waktu Minta Penawaran");
        if (colWaktuMinta === -1) {
            colWaktuMinta = headerProspekPenawaran.length;
            sheetProspekPenawaran.getRange(1, colWaktuMinta + 1).setValue("Waktu Minta Penawaran");
            headerProspekPenawaran.push("Waktu Minta Penawaran");
        }

        var colWaktuSelesai = headerProspekPenawaran.indexOf("Waktu Selesai Penawaran");
        if (colWaktuSelesai === -1) {
            colWaktuSelesai = headerProspekPenawaran.length;
            sheetProspekPenawaran.getRange(1, colWaktuSelesai + 1).setValue("Waktu Selesai Penawaran");
            headerProspekPenawaran.push("Waktu Selesai Penawaran");
        }

        var colTargetSlaPenawaran = headerProspekPenawaran.indexOf("Target SLA Penawaran (Jam)");
        if (colTargetSlaPenawaran === -1) {
            colTargetSlaPenawaran = headerProspekPenawaran.length;
            sheetProspekPenawaran.getRange(1, colTargetSlaPenawaran + 1).setValue("Target SLA Penawaran (Jam)");
            headerProspekPenawaran.push("Target SLA Penawaran (Jam)");
        }

        var prospekPenawaranDitemukan = false;
        var namaSalesPenawaran = "-";
        var namaKlienPenawaran = "-";
        for (var i = 1; i < dataProspekPenawaran.length; i++) {
            if (String(dataProspekPenawaran[i][colIdPenawaran] || '').trim() === String(data.idProspek || '').trim()) {
                sheetProspekPenawaran.getRange(i + 1, colWaktuMinta + 1).setValue(new Date());
                sheetProspekPenawaran.getRange(i + 1, colWaktuSelesai + 1).setValue("");
                sheetProspekPenawaran.getRange(i + 1, colTargetSlaPenawaran + 1).setValue(9);
                namaSalesPenawaran = colSalesPenawaran !== -1 ? String(dataProspekPenawaran[i][colSalesPenawaran] || '-').trim() : "-";
                namaKlienPenawaran = colKlienPenawaran !== -1 ? String(dataProspekPenawaran[i][colKlienPenawaran] || '-').trim() : "-";
                prospekPenawaranDitemukan = true;
                break;
            }
        }

        if (!prospekPenawaranDitemukan) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var pesanMintaPenawaran = "⚠️ *PERMINTAAN SURAT PENAWARAN* ⚠️\n\nAssalamu'alaikum Admin,\nSales *" + namaSalesPenawaran + "* meminta pembuatan Surat Penawaran untuk Prospek:\n\n👤 *Klien:* " + namaKlienPenawaran + "\n🎫 *ID:* " + data.idProspek + "\n\nSLA Admin (9 Jam Kerja) dimulai dari sekarang. Mohon segera diupload ke sistem!";
        var headerUsersPenawaran = usersData[0] || [];
        var colRoleUsersPenawaran = headerUsersPenawaran.indexOf("Role");
        var colWaUsersPenawaran = headerUsersPenawaran.indexOf("No WA");
        if (colRoleUsersPenawaran !== -1 && colWaUsersPenawaran !== -1) {
            for (var u = 1; u < usersData.length; u++) {
                if (String(usersData[u][colRoleUsersPenawaran] || '').trim().toLowerCase() === 'admin') {
                    var noWaAdminPenawaran = String(usersData[u][colWaUsersPenawaran] || '').trim();
                    if (noWaAdminPenawaran !== "") kirimNotifWA(noWaAdminPenawaran, pesanMintaPenawaran);
                }
            }
        }

        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'ajukanPemulihanProspek') {
        var sheetProspekPemulihan = ss.getSheetByName("Prospek");
        if (!sheetProspekPemulihan) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sheet Prospek tidak ada!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var dataProspekPemulihan = sheetProspekPemulihan.getDataRange().getValues();
        var headerProspekPemulihan = dataProspekPemulihan[0] || [];
        var colIdPemulihan = headerProspekPemulihan.indexOf("ID Prospek");
        var colStatusPemulihan = headerProspekPemulihan.indexOf("Status Prospek");
        if (colIdPemulihan === -1 || colStatusPemulihan === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Kolom Prospek tidak lengkap!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var colRiwayatPemulihan = headerProspekPemulihan.indexOf("Riwayat Follow Up");
        if (colRiwayatPemulihan === -1) {
            colRiwayatPemulihan = headerProspekPemulihan.length;
            sheetProspekPemulihan.getRange(1, colRiwayatPemulihan + 1).setValue("Riwayat Follow Up");
            headerProspekPemulihan.push("Riwayat Follow Up");
        }

        var barisPemulihan = -1;
        for (var i = 1; i < dataProspekPemulihan.length; i++) {
            if (String(dataProspekPemulihan[i][colIdPemulihan]).trim() === String(data.idProspek || '').trim()) {
                barisPemulihan = i + 1;
                break;
            }
        }
        if (barisPemulihan === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var waktuPengajuanPemulihan = Utilities.formatDate(new Date(), "Asia/Makassar", "dd/MM/yyyy HH:mm");
        var alasanPemulihan = String(data.alasan || '-').trim();
        var namaSalesPemulihan = String(data.namaSales || '-').trim();
        var riwayatPengajuanPemulihan = "[" + waktuPengajuanPemulihan + "] ♻️ PENGAJUAN PEMULIHAN oleh " + namaSalesPemulihan + "\nAlasan: " + alasanPemulihan;
        var riwayatLamaPemulihan = String(sheetProspekPemulihan.getRange(barisPemulihan, colRiwayatPemulihan + 1).getValue() || "").trim();
        var riwayatGabunganPemulihan = riwayatLamaPemulihan ? riwayatLamaPemulihan + "\n\n" + riwayatPengajuanPemulihan : riwayatPengajuanPemulihan;

        sheetProspekPemulihan.getRange(barisPemulihan, colStatusPemulihan + 1).setValue("Menunggu Pemulihan");
        sheetProspekPemulihan.getRange(barisPemulihan, colRiwayatPemulihan + 1).setValue(riwayatGabunganPemulihan).setWrap(true);

        var pesanAdminPemulihan = "♻️ *PENGAJUAN PEMULIHAN PROSPEK* ♻️\n\nAssalamu'alaikum Admin, ada pengajuan pemulihan prospek.\n\n🆔 *ID Prospek:* " + data.idProspek + "\n💼 *Sales:* " + namaSalesPemulihan + "\n📝 *Alasan:* " + alasanPemulihan + "\n\nMohon segera ditinjau di aplikasi.";
        var headerUsersPemulihan = usersData[0] || [];
        var colRoleUsersPemulihan = headerUsersPemulihan.indexOf("Role");
        var colWaUsersPemulihan = headerUsersPemulihan.indexOf("No WA");
        if (colRoleUsersPemulihan !== -1 && colWaUsersPemulihan !== -1) {
            for (var u = 1; u < usersData.length; u++) {
                if (String(usersData[u][colRoleUsersPemulihan] || '').trim().toLowerCase() === 'admin') {
                    var noWaAdminPemulihan = String(usersData[u][colWaUsersPemulihan] || '').trim();
                    if (noWaAdminPemulihan !== "") kirimNotifWA(noWaAdminPemulihan, pesanAdminPemulihan);
                }
            }
        }

        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'responPemulihanProspek') {
        var keputusanPemulihan = String(data.keputusan || '').trim();
        if (keputusanPemulihan !== "Tahap Penawaran" && keputusanPemulihan !== "Batal") {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Keputusan pemulihan tidak valid!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var sheetProspekRespon = ss.getSheetByName("Prospek");
        if (!sheetProspekRespon) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sheet Prospek tidak ada!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var dataProspekRespon = sheetProspekRespon.getDataRange().getValues();
        var headerProspekRespon = dataProspekRespon[0] || [];
        var colIdRespon = headerProspekRespon.indexOf("ID Prospek");
        var colStatusRespon = headerProspekRespon.indexOf("Status Prospek");
        if (colIdRespon === -1 || colStatusRespon === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Kolom Prospek tidak lengkap!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var colRiwayatRespon = headerProspekRespon.indexOf("Riwayat Follow Up");
        if (colRiwayatRespon === -1) {
            colRiwayatRespon = headerProspekRespon.length;
            sheetProspekRespon.getRange(1, colRiwayatRespon + 1).setValue("Riwayat Follow Up");
            headerProspekRespon.push("Riwayat Follow Up");
        }

        var barisResponPemulihan = -1;
        for (var i = 1; i < dataProspekRespon.length; i++) {
            if (String(dataProspekRespon[i][colIdRespon]).trim() === String(data.idProspek || '').trim()) {
                barisResponPemulihan = i + 1;
                break;
            }
        }
        if (barisResponPemulihan === -1) {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "ID Prospek tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var waktuResponPemulihan = Utilities.formatDate(new Date(), "Asia/Makassar", "dd/MM/yyyy HH:mm");
        var riwayatResponPemulihan = "[" + waktuResponPemulihan + "] 👨‍💼 RESPON ADMIN: Pemulihan " + keputusanPemulihan;
        var riwayatLamaRespon = String(sheetProspekRespon.getRange(barisResponPemulihan, colRiwayatRespon + 1).getValue() || "").trim();
        var riwayatGabunganRespon = riwayatLamaRespon ? riwayatLamaRespon + "\n\n" + riwayatResponPemulihan : riwayatResponPemulihan;

        sheetProspekRespon.getRange(barisResponPemulihan, colStatusRespon + 1).setValue(keputusanPemulihan);
        sheetProspekRespon.getRange(barisResponPemulihan, colRiwayatRespon + 1).setValue(riwayatGabunganRespon).setWrap(true);
        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'deleteProspek') {
        var sheetProspek = ss.getSheetByName("Prospek");
        if (sheetProspek) {
            var dataP = sheetProspek.getDataRange().getValues(); var colId = dataP[0].indexOf("ID Prospek");
            if (colId !== -1) { for (var i = dataP.length - 1; i >= 1; i--) { if (String(dataP[i][colId]).trim() === String(data.idProspek).trim()) sheetProspek.deleteRow(i + 1); } }
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    // ===============================================
    // FITUR: BANDING SALES & LAPOR BUG
    // ===============================================
    } else if (data.action === 'ajukanBanding') {
        var tiketData = sheetTiket.getDataRange().getValues();
        for (var i = 1; i < tiketData.length; i++) {
            if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
                sheetTiket.getRange(i+1, 24).setValue("Diajukan"); 
                sheetTiket.getRange(i+1, 25).setValue(data.namaSales); 
                sheetTiket.getRange(i+1, 26).setValue(data.keteranganSales); 
                if (data.buktiBanding && data.buktiBanding !== "") {
                    try {
                        var folderIterator = DriveApp.getFoldersByName("Bukti Banding Alfacom"); var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Bukti Banding Alfacom");
                        var arrayBase64 = data.buktiBanding.split('|#|'); var arrayUrl = [];
                        for(var b=0; b<arrayBase64.length; b++) {
                            if(arrayBase64[b].length > 50) {
                                var blob = Utilities.newBlob(Utilities.base64Decode(arrayBase64[b].split(',')[1]), 'image/jpeg', "Banding_" + data.idTiket + "_" + b + ".jpg");
                                var savedFile = folder.createFile(blob); savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                                arrayUrl.push(savedFile.getUrl());
                            }
                        }
                        sheetTiket.getRange(i+1, 27).setValue(arrayUrl.join('|#|'));
                    } catch(e) {}
                }
                break;
            }
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'responBanding') {
        var tiketData = sheetTiket.getDataRange().getValues();
        for (var i = 1; i < tiketData.length; i++) {
            if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
                sheetTiket.getRange(i+1, 24).setValue(data.statusBanding); 
                if (data.statusBanding === 'Diterima') {
                    sheetTiket.getRange(i+1, 13).setValue(data.namaSales); sheetTiket.getRange(i+1, 28).setValue(""); 
                } else { sheetTiket.getRange(i+1, 28).setValue(data.alasanAdmin); }
                break;
            }
        }
        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'laporBug') {
        var sheetBug = ss.getSheetByName("Laporan Bug");
        if (!sheetBug) { sheetBug = ss.insertSheet("Laporan Bug"); sheetBug.appendRow(["Tanggal", "Pelapor", "Deskripsi", "Bukti"]); }
        var urlBukti = "";
        if (data.buktiBug && data.buktiBug !== "") {
            try {
                var blob = Utilities.newBlob(Utilities.base64Decode(data.buktiBug.split(',')[1]), 'image/jpeg', "Bug_" + new Date().getTime() + ".jpg");
                var folderIterator = DriveApp.getFoldersByName("Bug Laporan Alfacom"); var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Bug Laporan Alfacom"); 
                var savedFile = folder.createFile(blob); savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                urlBukti = savedFile.getUrl();
            } catch(e) {}
        }
        sheetBug.appendRow([new Date(), data.pelapor, data.deskripsi, urlBukti]);

        var pesanWA = "🐞 *LAPORAN BUG APLIKASI* 🐞\n\nAssalamu'alaikum Admin,\nAda laporan kendala/bug baru dari user:\n\n👤 *Pelapor:* " + data.pelapor + "\n📝 *Deskripsi:* " + data.deskripsi + "\n\nMohon segera dicek di sistem.";
        if(urlBukti !== "") { pesanWA += "\n\n🖼️ *Link Bukti:* " + urlBukti; }

        var headerUsersLapor = usersData[0] || [];
        var colRoleLapor = headerUsersLapor.indexOf("Role");
        var colWALapor = headerUsersLapor.indexOf("No WA");
        if (colRoleLapor !== -1 && colWALapor !== -1) {
            for (var u = 1; u < usersData.length; u++) {
                if (String(usersData[u][colRoleLapor] || '').trim().toLowerCase() === 'admin') {
                    var noWAAdmin = String(usersData[u][colWALapor] || '').trim();
                    if (noWAAdmin !== "") kirimNotifWA(noWAAdmin, pesanWA);
                }
            }
        }

        SpreadsheetApp.flush(); return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    } else if (data.action === 'catatFollowUp') {
        // ===================================================
        // REKAM JEJAK DIGITAL ADMIN FOLLOW UP
        // ===================================================
        var sheetGaransi = ss.getSheetByName("Garansi");
        if (sheetGaransi) {
            var dataG = sheetGaransi.getDataRange().getValues();
            var waktuSekarang = Utilities.formatDate(new Date(), "Asia/Makassar", "dd/MM/yyyy HH:mm");
            var teksJejak = "✅ Terakhir WA: " + waktuSekarang + " (" + data.admin + ")";
            
            // Cari Baris Garansi yang Sesuai dengan Referensi Tiket
            for (var g = 1; g < dataG.length; g++) {
                if (String(dataG[g][1]).trim() === String(data.ref).trim()) { 
                    sheetGaransi.getRange(g + 1, 13).setValue(teksJejak); // Simpan ke Kolom M (13)
                    break;
                }
            }
        }
        return ContentService.createTextOutput(JSON.stringify({status: 'sukses'})).setMimeType(ContentService.MimeType.JSON);

     } else if (data.action === 'updatePoinTiket') {
        var tiketData = sheetTiket.getDataRange().getValues();
        var headerTiket = tiketData[0];
        
        // Buat kolom otomatis jika belum ada di database
        var colBobot = headerTiket.indexOf("Bobot Poin");
        if (colBobot === -1) { colBobot = headerTiket.length; sheetTiket.getRange(1, colBobot + 1).setValue("Bobot Poin"); headerTiket.push("Bobot Poin"); }
        
        var colVeto = headerTiket.indexOf("Veto Admin");
        if (colVeto === -1) { colVeto = headerTiket.length; sheetTiket.getRange(1, colVeto + 1).setValue("Veto Admin"); headerTiket.push("Veto Admin"); }

        for (var i = 1; i < tiketData.length; i++) {
            if (String(tiketData[i][0]).trim() === String(data.idTiket).trim()) {
                sheetTiket.getRange(i + 1, colBobot + 1).setValue(data.bobotPoin);
                sheetTiket.getRange(i + 1, colVeto + 1).setValue(data.vetoPoin);
                SpreadsheetApp.flush(); break;
            }
        }
        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'getTinjauanAbsen') {
        var sheetAbsen = ss.getSheetByName("Absen") || ss.getSheetByName("Absensi");
        if (!sheetAbsen) return ContentService.createTextOutput(JSON.stringify({status: "gagal", pesan: "Sheet tidak ada"})).setMimeType(ContentService.MimeType.JSON);
        var dataA = sheetAbsen.getDataRange().getValues(); var headA = dataA[0]; var result = [];
        var cTgl = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("tanggal") > -1; });
        var cNama = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("nama") > -1; });
        var cMsk = headA.findIndex(function(h){ return String(h).toLowerCase() === "masuk" || String(h).toLowerCase().indexOf("jam masuk") > -1; });
        var cIst = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("istirahat") > -1; });
        var cKlr = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("keluar") > -1; });
        var cSts = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("status") > -1 || String(h).toLowerCase().indexOf("tipe") > -1; });
        var cKet = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("keterangan") > -1; });
        var cGPS = headA.findIndex(function(h){ return String(h).toLowerCase().indexOf("lokasi") > -1 || String(h).toLowerCase().indexOf("gps") > -1 || String(h).toLowerCase().indexOf("maps") > -1; });

        for (var i = dataA.length - 1; i >= 1; i--) {
            if (cNama !== -1 && String(dataA[i][cNama]).trim().toLowerCase() === String(data.nama).trim().toLowerCase()) {
                var tglVal = cTgl !== -1 ? dataA[i][cTgl] : "-";
                if (tglVal instanceof Date) { tglVal = Utilities.formatDate(tglVal, "Asia/Makassar", "dd MMM yyyy"); }
                result.push({
                    tanggal: tglVal, nama: cNama !== -1 ? dataA[i][cNama] : "-", status: cSts !== -1 ? dataA[i][cSts] : "-",
                    masuk: cMsk !== -1 ? formatWaktu(dataA[i][cMsk]) : "-", istirahat: cIst !== -1 ? formatWaktu(dataA[i][cIst]) : "-",
                    keluar: cKlr !== -1 ? formatWaktu(dataA[i][cKlr]) : "-", keterangan: cKet !== -1 ? dataA[i][cKet] : "-", gps: cGPS !== -1 ? dataA[i][cGPS] : ""
                });
                if (result.length >= 7) break;
            }
        }
        
        function formatWaktu(val) { if(!val || String(val).trim()==="") return "-"; if(val instanceof Date) return Utilities.formatDate(val, "Asia/Makassar", "HH:mm"); return String(val).substring(0,5); }
        
        return ContentService.createTextOutput(JSON.stringify({status: "sukses", data: result})).setMimeType(ContentService.MimeType.JSON);

    } else if (data.action === 'lupaSandi') {
        var headerUsersReset = usersData[0] || [];
        var colUsernameReset = headerUsersReset.indexOf("Username");
        var colNamaReset = headerUsersReset.indexOf("Nama Asli");
        var colRoleReset = headerUsersReset.indexOf("Role");
        var colWaReset = headerUsersReset.indexOf("No WA");
        var namaAsliReset = "";

        if (colUsernameReset !== -1) {
            for (var i = 1; i < usersData.length; i++) {
                if (String(usersData[i][colUsernameReset] || '').trim().toLowerCase() === String(data.username || '').trim().toLowerCase()) {
                    namaAsliReset = colNamaReset !== -1 ? String(usersData[i][colNamaReset] || data.username).trim() : String(data.username || '').trim();
                    break;
                }
            }
        }

        if (namaAsliReset === "") {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Username tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var pesanResetSandi = "⚠️ *PERMINTAAN RESET SANDI* ⚠️\n\nAssalamu'alaikum Admin, user *" + namaAsliReset + "* (Username: " + data.username + ") meminta reset password. Segera hubungi yang bersangkutan.";
        if (colRoleReset !== -1 && colWaReset !== -1) {
            for (var u = 1; u < usersData.length; u++) {
                if (String(usersData[u][colRoleReset] || '').trim().toLowerCase() === 'admin') {
                    var noWaAdminReset = String(usersData[u][colWaReset] || '').trim();
                    if (noWaAdminReset !== "") kirimNotifWA(noWaAdminReset, pesanResetSandi);
                }
            }
        }

        return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // PENUTUP FALLBACK
    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Aksi tidak valid!"})).setMimeType(ContentService.MimeType.JSON);

  } catch (error) { 
    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Error Internal doPost: " + error.toString()})).setMimeType(ContentService.MimeType.JSON); 
  }
  
  
}

function cekPeringatanSLA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetTiket = ss.getSheetByName("Tiket") || ss.getSheets()[0];
  var sheetUsers = ss.getSheetByName("Users");
  var sheetGaransi = ss.getSheetByName("Garansi");
  if (!sheetTiket || !sheetUsers) return;

  var tiketData = sheetTiket.getDataRange().getValues();
  var usersData = sheetUsers.getDataRange().getValues();
  var headersTiketScanner = tiketData[0] || [];
  var colCabangTiketScanner = pastikanKolomAkhir_(sheetTiket, headersTiketScanner, 'Cabang');
  var colAdminSLATiketScanner = pastikanKolomAkhir_(sheetTiket, headersTiketScanner, 'Admin SLA');
  var now = new Date();

  var hariIni = now.getDay();
  var jamIni = now.getHours();
  if (hariIni === 0 || jamIni < 8 || jamIni >= 20) return;

  var waMap = {}; 
  for (var u = 1; u < usersData.length; u++) {
    var namaAsli = String(usersData[u][3] || '').trim().toLowerCase();
    var noWA = String(usersData[u][6] || '').trim();
    if (namaAsli && noWA !== "") { waMap[namaAsli] = noWA; }
  }

  var cabangTiketByIdScanner = {};
  for (var tkt = 1; tkt < tiketData.length; tkt++) {
    if (!tiketData[tkt][0]) continue;
    cabangTiketByIdScanner[String(tiketData[tkt][0]).trim()] = cabangDariBaris_(tiketData[tkt], headersTiketScanner, null);
  }

  var listRefGaransi = {};
  if (sheetGaransi) {
    var dataG = sheetGaransi.getDataRange().getValues();
    var headersGaransiScanner = dataG[0] || [];
    var colCabangGaransiScanner = pastikanKolomAkhir_(sheetGaransi, headersGaransiScanner, 'Cabang');
    for (var g = 1; g < dataG.length; g++) {
      if (!dataG[g][1]) continue;
      var refGaransiScanner = String(dataG[g][1]).trim();
      var cabangGaransiScanner = cabangDariBaris_(dataG[g], headersGaransiScanner, cabangTiketByIdScanner[refGaransiScanner]);
      listRefGaransi[cabangGaransiScanner + '|' + refGaransiScanner] = true;
    }
  }

  for (var i = 1; i < tiketData.length; i++) {
    var row = tiketData[i]; var idTiket = row[0]; var statusTiket = String(row[8] || '').trim();
    if (statusTiket === "Cancel" || !idTiket) continue;

    var cabangTiketScanner = cabangDariBaris_(row, headersTiketScanner, null);
    var roleAdminTiketScanner = roleAdminUntukCabang_(cabangTiketScanner);
    var jamOperasionalTiketScanner = jamOperasionalCabang_(cabangTiketScanner);
    if (jamIni >= jamOperasionalTiketScanner.selesai) continue;
    if (normalisasiCabangOperasional_(row[colCabangTiketScanner]) !== cabangTiketScanner) {
      sheetTiket.getRange(i + 1, colCabangTiketScanner + 1).setValue(cabangTiketScanner);
    }
    if (String(row[colAdminSLATiketScanner] || '').trim().toLowerCase() !== roleAdminTiketScanner) {
      sheetTiket.getRange(i + 1, colAdminSLATiketScanner + 1).setValue(roleAdminTiketScanner);
    }

    var klien = row[5] || "-"; var pekerjaan = row[6] || "-"; var teknisiStr = String(row[7] || '').trim();
    var labelAdminTiketScanner = cabangTiketScanner === 'Raha' ? 'Admin Raha' : 'Admin Kendari';
    var statusPeringatanLama = String(row[18] || '');
    var statusPeringatanBaru = statusPeringatanLama;

    if (statusTiket === "Selesai") {
        if (!listRefGaransi[cabangTiketScanner + '|' + idTiket]) {
            var waktuSelesaiTiket = row[9] instanceof Date ? row[9] : new Date(String(row[9]).replace(/-/g, "/"));
            if (!isNaN(waktuSelesaiTiket.getTime())) {
                var jamKerjaNganggurNota = hitungDurasiJamKerjaMs(waktuSelesaiTiket, now, cabangTiketScanner) / (1000 * 60 * 60);
                if (jamKerjaNganggurNota >= 9 && statusPeringatanLama.indexOf("ADMIN_NOTA_FAILED") === -1) {
                    var teksAdminNota_Admin = "🚨 *SLA ADMIN GAGAL (BUAT NOTA)* 🚨\n\nAssalamu'alaikum " + labelAdminTiketScanner + ",\nTiket Selesai Cabang " + cabangTiketScanner + " berikut sudah lebih dari 9 Jam Kerja belum dibuatkan Nota & Garansi!\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nSegera buatkan Nota agar SLA Anda tidak semakin merah!\n🌐 https://aplikasisla.vercel.app/";
                    var teksAdminNota_Manager = "⚠️ *LAPORAN KELALAIAN ADMIN (SLA NOTA)* ⚠️\n\nAssalamu'alaikum Manager,\nSistem mencatat " + labelAdminTiketScanner + " belum membuat Nota/Garansi melebihi batas 9 Jam Kerja untuk tiket selesai berikut:\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon untuk menegur dan mengingatkan Admin terkait kelalaian ini agar dokumen Klien segera diproses.\n🌐 https://aplikasisla.vercel.app/";
                    
                    kirimNotifKeAdminCabang_(usersData, cabangTiketScanner, teksAdminNota_Admin);
                    for (var u = 1; u < usersData.length; u++) {
                        var roleUser = String(usersData[u][2]).toLowerCase().trim();
                        var noWABos = String(usersData[u][6] || '').trim();
                        if (noWABos !== "" && (roleUser === 'manager' || roleUser === 'direktur')) kirimNotifWA(noWABos, teksAdminNota_Manager);
                    }
                    statusPeringatanBaru += " [ADMIN_NOTA_FAILED]";
                }
            }
        }
        if (statusPeringatanBaru !== statusPeringatanLama) { sheetTiket.getRange(i + 1, 19).setValue(statusPeringatanBaru.trim()); }
        continue; 
    }

    // ==========================================
    // PERBAIKAN BUG: MENCEGAH ROBOT MENGIRIM PERINGATAN JIKA PENDING/OUTSOURCE
    // ==========================================
    if (statusTiket === "Pending" || statusTiket === "Outsource") {
        continue; 
    }
    if (teknisiStr === "Belum Ditugaskan" || !teknisiStr || teknisiStr === "-") {
      var waktuLaporTiket = row[2] instanceof Date ? row[2] : new Date(String(row[2]).replace(/-/g, "/"));
      if (!isNaN(waktuLaporTiket.getTime())) {
        var jamKerjaNganggur = hitungDurasiJamKerjaMs(waktuLaporTiket, now, cabangTiketScanner) / (1000 * 60 * 60);
        if (jamKerjaNganggur >= 27 && statusPeringatanLama.indexOf("ADMIN_SLA_FAILED") === -1) {
          var teksAdminTech_Admin = "⚠️ *SLA ADMIN GAGAL (BUTUH TEKNISI)* ⚠️\n\nAssalamu'alaikum " + labelAdminTiketScanner + ",\nTiket Cabang " + cabangTiketScanner + " berikut sudah melewati batas 3 Hari Kerja tanpa ditugaskan kepada teknisi manapun!\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon segera tugaskan teknisi!\n🌐 https://aplikasisla.vercel.app/";
          var teksAdminTech_Manager = "⚠️ *LAPORAN KELALAIAN ADMIN (PENUGASAN TEKNISI)* ⚠️\n\nAssalamu'alaikum Manager,\nSistem mencatat " + labelAdminTiketScanner + " belum menugaskan Teknisi melebihi batas 3 Hari Kerja untuk tiket berikut:\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon tegur dan ingatkan Admin atas kelalaian distribusi tugas ini, atau evaluasi penambahan SDM Teknisi jika beban kerja saat ini terlalu tinggi.\n🌐 https://aplikasisla.vercel.app/";
          
          kirimNotifKeAdminCabang_(usersData, cabangTiketScanner, teksAdminTech_Admin);
          for (var u = 1; u < usersData.length; u++) {
            var roleUser = String(usersData[u][2]).toLowerCase().trim();
            var noWABos = String(usersData[u][6] || '').trim();
            if (noWABos !== "" && (roleUser === 'manager' || roleUser === 'direktur')) kirimNotifWA(noWABos, teksAdminTech_Manager);
          }
          statusPeringatanBaru += " [ADMIN_SLA_FAILED]";
        }
      }
      if (statusPeringatanBaru !== statusPeringatanLama) { sheetTiket.getRange(i + 1, 19).setValue(statusPeringatanBaru.trim()); }
      continue; 
    }

    var targetResponJam = parseFloat(row[14]) || 1; var tenggatRespon = row[15] ? new Date(row[15]) : null; var waktuRespon = row[16];
    var targetSLAJam = parseFloat(row[3]) || 24; var tenggatPengerjaan = row[4] ? new Date(row[4]) : null;

    var listTeknisi = teknisiStr.split(','); var listWaAkanDikirim = [];
    for (var t = 0; t < listTeknisi.length; t++) { var nTek = listTeknisi[t].trim().toLowerCase(); if (waMap[nTek]) listWaAkanDikirim.push(waMap[nTek]); }
    if (listWaAkanDikirim.length === 0) continue;

    if (!waktuRespon && tenggatRespon && !isNaN(tenggatRespon.getTime())) {
      var sisaJamRespon = hitungDurasiJamKerjaMs(now, tenggatRespon, cabangTiketScanner) / (1000 * 60 * 60);
      if (sisaJamRespon <= 0.25 && statusPeringatanLama.indexOf("RESPON_WARNED") === -1) {
        var teksRespon = "🚨 *DARURAT: SLA RESPON TIKET " + idTiket + "* 🚨\n\nAssalamu'alaikum, waktu untuk *Respon Pertama* tiket ini hampir habis!\n\n🏢 *Klien:* " + klien + "\n⏳ *Batas:* " + Utilities.formatDate(tenggatRespon, "Asia/Makassar", "dd/MM/yyyy HH:mm") + "\n\nSegera tekan tombol *On Progress* di Aplikasi agar tidak dihitung Gagal!\n🌐 https://aplikasisla.vercel.app/";
        for (var m = 0; m < listWaAkanDikirim.length; m++) { kirimNotifWA(listWaAkanDikirim[m], teksRespon); }
        statusPeringatanBaru += " [RESPON_WARNED]";
      }
    }

    if (tenggatPengerjaan && !isNaN(tenggatPengerjaan.getTime())) {
      var sisaJamPengerjaan = hitungDurasiJamKerjaMs(now, tenggatPengerjaan, cabangTiketScanner) / (1000 * 60 * 60);
      if (sisaJamPengerjaan <= 2.0 && statusPeringatanLama.indexOf("PENGERJAAN_WARNED") === -1) {
        var teksPengerjaan = "⏰ *PERINGATAN: SLA PENGERJAAN TIKET " + idTiket + "* ⏰\n\nAssalamu'alaikum, waktu pengerjaan tiket ini tersisa kurang dari 2 jam / telah melewati batas!\n\n🏢 *Klien:* " + klien + "\n⌛ *Batas Selesai:* " + Utilities.formatDate(tenggatPengerjaan, "Asia/Makassar", "dd/MM/yyyy HH:mm") + "\n\nSegera selesaikan (Closed) atau ajukan *Pending* jika ada kendala di lapangan.\n🌐 https://aplikasisla.vercel.app/";
        for (var m = 0; m < listWaAkanDikirim.length; m++) { kirimNotifWA(listWaAkanDikirim[m], teksPengerjaan); }
        statusPeringatanBaru += " [PENGERJAAN_WARNED]";
      }
    }

    if (statusPeringatanBaru !== statusPeringatanLama) { sheetTiket.getRange(i + 1, 19).setValue(statusPeringatanBaru.trim()); }
  }

  // Jalur cadangan: scanner khusus tetap dipanggil saat cek SLA berjalan.
  // Penanda per hari mencegah WA terkirim dua kali jika trigger 07:00 sudah sukses.
  jalankanScannerProspek_(ss, usersData, now);
}

// ==========================================
// FUNGSI HELPER: SINKRONISASI SALES DARI GARANSI KE TIKET
// ==========================================
function sinkronisasiSalesDariGaransiKeTiket(sheetTiket, idReferensiGaransi, namaSales, nilaiOmzet) {
  if (idReferensiGaransi == null || idReferensiGaransi === "") return false;
  var idRefTeks = idReferensiGaransi.toString();
  if (idRefTeks.substring(0, 4) !== "TKT-") return false;
  if (namaSales == null || namaSales === "") return false;

  var seluruhDataTiket = sheetTiket.getDataRange().getValues();
  var headerKolom = seluruhDataTiket[0];
  
  var indeksKolomId = headerKolom.indexOf("ID Tiket");
  var indeksKolomSales = headerKolom.indexOf("Sales");
  var indeksKolomOmzet = headerKolom.indexOf("Nilai Penjualan (Rp)");
  if (indeksKolomOmzet === -1) indeksKolomOmzet = headerKolom.indexOf("Nilai Penjualan");

  if (indeksKolomId !== -1 && indeksKolomSales !== -1 && indeksKolomOmzet !== -1) {
    for (var baris = 1; baris < seluruhDataTiket.length; baris++) {
      if (String(seluruhDataTiket[baris][indeksKolomId]).trim() === String(idRefTeks).trim()) {
        sheetTiket.getRange(baris + 1, indeksKolomSales + 1).setValue(namaSales);
        sheetTiket.getRange(baris + 1, indeksKolomOmzet + 1).setValue(nilaiOmzet);
        return true;
      }
    }
  }
  return false;
}

// =======================================================
// ROBOT PENGECEK GARANSI HARIAN (AFTER-SALES FOLLOW UP)
// =======================================================
function robotPengecekGaransiHarian() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "dilewati", pesan: "Robot lain masih berjalan." };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetTiket = ss.getSheetByName("Tiket") || ss.getSheets()[0];
    var sheetGaransi = ss.getSheetByName("Garansi");
    if (!sheetTiket || !sheetGaransi) {
      return { status: "dilewati", pesan: "Sheet Tiket atau Garansi tidak ditemukan." };
    }

    var dataTiket = sheetTiket.getDataRange().getValues();
    var dataGaransi = sheetGaransi.getDataRange().getValues();
    if (dataTiket.length < 2 || dataGaransi.length < 2) {
      return { status: "sukses", diperiksa: 0, terkirim: 0 };
    }

    var headerTiket = dataTiket[0] || [];
    var headerGaransi = dataGaransi[0] || [];

    function cariKolom_(header, daftarNama) {
      for (var c = 0; c < daftarNama.length; c++) {
        var indexKolom = header.indexOf(daftarNama[c]);
        if (indexKolom !== -1) return indexKolom;
      }
      return -1;
    }

    // Header aktual aplikasi pada sheet Tiket.
    var colIdTiket = cariKolom_(headerTiket, ["ID Tiket"]);
    var colStatusTiket = cariKolom_(headerTiket, ["Status"]);
    var colWaktuSelesai = cariKolom_(headerTiket, ["Waktu Selesai"]);
    var colWaKlien = cariKolom_(headerTiket, ["No WA Klien", "No WA", "WA Klien"]);
    var colNamaKlien = cariKolom_(headerTiket, ["Klien & Lokasi", "Nama Klien", "Nama Customer"]);
    var colLayananTiket = cariKolom_(headerTiket, ["Jenis Pekerjaan", "Layanan", "Barang / Jasa"]);

    // Durasi garansi tersimpan pada sheet Garansi dan dihubungkan melalui Referensi Tiket.
    var colReferensi = cariKolom_(headerGaransi, ["Referensi (Tiket/Nota)"]);
    var colDurasiGaransi = cariKolom_(headerGaransi, ["Durasi (Hari)", "Garansi (Hari)"]);
    var colStatusGaransi = cariKolom_(headerGaransi, ["Status"]);
    var colNamaGaransi = cariKolom_(headerGaransi, ["Nama Pelanggan", "Nama Klien"]);
    var colLayananGaransi = cariKolom_(headerGaransi, ["Barang / Jasa", "Layanan"]);

    if (colIdTiket === -1 || colStatusTiket === -1 || colWaktuSelesai === -1 ||
        colWaKlien === -1 || colReferensi === -1 || colDurasiGaransi === -1) {
      return { status: "gagal", pesan: "Header wajib Tiket/Garansi tidak lengkap." };
    }

    // Audit sekaligus pelindung dari WA ganda ketika trigger dijalankan ulang.
    var namaKolomFollowUp = "Follow Up After-Sales Terkirim";
    var colFollowUp = headerGaransi.indexOf(namaKolomFollowUp);
    if (colFollowUp === -1) {
      colFollowUp = headerGaransi.length;
      sheetGaransi.getRange(1, colFollowUp + 1).setValue(namaKolomFollowUp);
      headerGaransi.push(namaKolomFollowUp);
    }

    var tiketById = {};
    for (var t = 1; t < dataTiket.length; t++) {
      var idTiket = String(dataTiket[t][colIdTiket] || "").trim();
      if (idTiket !== "") tiketById[idTiket] = dataTiket[t];
    }

    function tentukanHariFollowUp_(durasiHari) {
      if (durasiHari === 7) return 5;
      if (durasiHari === 30) return 7;
      if (durasiHari >= 90 && durasiHari <= 365) return 30;
      return 0;
    }

    var followUpSudahTerkirim = {};
    for (var g = 1; g < dataGaransi.length; g++) {
      var refAwal = String(dataGaransi[g][colReferensi] || "").trim();
      var durasiAwal = parseInt(dataGaransi[g][colDurasiGaransi], 10) || 0;
      var hariAwal = tentukanHariFollowUp_(durasiAwal);
      if (refAwal && hariAwal && String(dataGaransi[g][colFollowUp] || "").trim() !== "") {
        followUpSudahTerkirim[refAwal + "|" + hariAwal] = true;
      }
    }

    var sekarang = new Date();
    var hariIni = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate());
    var satuHariMs = 24 * 60 * 60 * 1000;
    var jumlahDiperiksa = 0;
    var jumlahTerkirim = 0;

    for (var i = 1; i < dataGaransi.length; i++) {
      var referensiTiket = String(dataGaransi[i][colReferensi] || "").trim();
      if (!referensiTiket || !tiketById[referensiTiket]) continue;

      var tiket = tiketById[referensiTiket];
      var statusTiket = String(tiket[colStatusTiket] || "").toUpperCase();
      if (statusTiket.indexOf("SELESAI") === -1) continue;

      var statusGaransi = colStatusGaransi !== -1 ? String(dataGaransi[i][colStatusGaransi] || "").toUpperCase() : "";
      if (statusGaransi.indexOf("HABIS") !== -1 || statusGaransi.indexOf("HANGUS") !== -1 || statusGaransi.indexOf("DIKLAIM") !== -1) continue;

      var garansiHari = parseInt(dataGaransi[i][colDurasiGaransi], 10) || 0;
      var hariFollowUp = tentukanHariFollowUp_(garansiHari);
      if (hariFollowUp === 0) continue;
      jumlahDiperiksa++;

      var tglSelesai = tiket[colWaktuSelesai] instanceof Date ? tiket[colWaktuSelesai] : new Date(tiket[colWaktuSelesai]);
      if (isNaN(tglSelesai.getTime())) continue;
      var tanggalSelesai = new Date(tglSelesai.getFullYear(), tglSelesai.getMonth(), tglSelesai.getDate());
      var daysPassed = Math.floor((hariIni.getTime() - tanggalSelesai.getTime()) / satuHariMs);
      if (daysPassed !== hariFollowUp || daysPassed < 0) continue;

      var kunciFollowUp = referensiTiket + "|" + hariFollowUp;
      if (followUpSudahTerkirim[kunciFollowUp]) continue;

      var waKlien = String(tiket[colWaKlien] || "").replace(/\D/g, "");
      if (waKlien.indexOf("0") === 0) waKlien = "62" + waKlien.substring(1);
      if (waKlien === "") continue;

      var namaKlien = colNamaKlien !== -1 ? String(tiket[colNamaKlien] || "").trim() : "";
      if (!namaKlien && colNamaGaransi !== -1) namaKlien = String(dataGaransi[i][colNamaGaransi] || "").trim();
      if (!namaKlien) namaKlien = "Bapak/Ibu";

      var layanan = colLayananGaransi !== -1 ? String(dataGaransi[i][colLayananGaransi] || "").trim() : "";
      if (!layanan && colLayananTiket !== -1) layanan = String(tiket[colLayananTiket] || "").trim();
      if (!layanan) layanan = "pekerjaan";

      var linkKlaim = "https://aplikasisla.vercel.app/?track=" + encodeURIComponent(referensiTiket);
      var pesan = "Assalamu'alaikum " + namaKlien + ",\n\n" +
                  "Bismillah. Kami dari *Alfacom Multi Solution* ingin menyapa Bapak/Ibu sekaligus memastikan kualitas layanan kami. 😊\n\n" +
                  "Beberapa waktu lalu kami telah menyelesaikan instalasi/perbaikan *" + layanan + "*. Bagaimana kondisinya saat ini? Apakah berfungsi dengan lancar?\n\n" +
                  "Garansi " + garansiHari + " hari Anda masih dalam periode layanan. Jika terdapat kendala sekecil apa pun, silakan cek status dan ajukan klaim melalui link berikut:\n" +
                  "👉 " + linkKlaim + "\n\n" +
                  "Terima kasih atas kepercayaannya. Kami siap membantu!";

      if (kirimNotifWA(waKlien, pesan)) {
        var waktuKirim = Utilities.formatDate(sekarang, "Asia/Makassar", "dd/MM/yyyy HH:mm:ss");
        sheetGaransi.getRange(i + 1, colFollowUp + 1).setValue("HARI_" + hariFollowUp + " | " + waktuKirim);
        followUpSudahTerkirim[kunciFollowUp] = true;
        jumlahTerkirim++;
      }
    }

    SpreadsheetApp.flush();
    return { status: "sukses", diperiksa: jumlahDiperiksa, terkirim: jumlahTerkirim };
  } finally {
    lock.releaseLock();
  }
}

// =======================================================
// AUTOMASI CLOSING LEVEL 2: SINKRONISASI STATUS PROSPEK
// =======================================================
function normalisasiNoWA_(nilai) {
  var digit = String(nilai || '').replace(/\D/g, '');
  if (digit.indexOf('0062') === 0) digit = digit.substring(2);
  if (digit.indexOf('620') === 0) digit = '62' + digit.substring(3);
  if (digit.indexOf('0') === 0) digit = '62' + digit.substring(1);
  else if (digit.indexOf('8') === 0) digit = '62' + digit;
  return digit;
}

function cariNoWAProspekBerdasarkanNama_(namaKlien) {
  try {
    var namaBersih = String(namaKlien || '').trim().toLowerCase();
    if (namaBersih === '') return '';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetProspek = ss.getSheetByName('Prospek');
    if (!sheetProspek || sheetProspek.getLastRow() < 2) return '';

    var dataProspek = sheetProspek.getDataRange().getValues();
    var headerProspek = dataProspek[0] || [];

    function cariKolom_(daftarNama) {
      for (var h = 0; h < headerProspek.length; h++) {
        var headerBersih = String(headerProspek[h] || '').trim().toLowerCase();
        for (var n = 0; n < daftarNama.length; n++) {
          if (headerBersih === String(daftarNama[n] || '').trim().toLowerCase()) return h;
        }
      }
      return -1;
    }

    var colNama = cariKolom_(['Nama Calon Customer', 'Calon Customer', 'Nama Klien', 'Nama Customer']);
    var colNoWA = cariKolom_(['No WA', 'No WhatsApp', 'WA', 'Telepon']);
    if (colNama === -1 || colNoWA === -1) return '';

    for (var i = dataProspek.length - 1; i >= 1; i--) {
      var namaProspek = String(dataProspek[i][colNama] || '').trim().toLowerCase();
      if (namaProspek === namaBersih) {
        var noWANormal = normalisasiNoWA_(dataProspek[i][colNoWA]);
        if (/^628\d{7,12}$/.test(noWANormal)) return noWANormal;
      }
    }
    return '';
  } catch (error) {
    return '';
  }
}

function ekstrakTagProduk_(deskripsiProduk) {
  var teksAsli = String(deskripsiProduk || '').replace(/[\r\t]+/g, ' ').trim();
  if (!teksAsli) return [];

  var aturanTag = [
    { tag: 'CCTV', pola: /\b(cctv|dvr|nvr|ip camera|kamera pengawas)\b/i },
    { tag: 'Printer', pola: /\b(printer|printhead|inkjet|laserjet|dot matrix|plotter)\b/i },
    { tag: 'Laptop', pola: /\b(laptop|notebook|macbook|chromebook)\b/i },
    { tag: 'Komputer', pola: /\b(komputer|desktop|pc rakitan|all[ -]?in[ -]?one)\b/i },
    { tag: 'Jaringan', pola: /\b(jaringan|network|lan|kabel utp|switch hub)\b/i },
    { tag: 'WiFi', pola: /\b(wi[ -]?fi|wireless|access point|router)\b/i },
    { tag: 'Mikrotik', pola: /\b(mikrotik|routerboard)\b/i },
    { tag: 'Server', pola: /\b(server|nas|data center)\b/i },
    { tag: 'Scanner', pola: /\b(scanner|scanjet)\b/i },
    { tag: 'Proyektor', pola: /\b(proyektor|projector)\b/i },
    { tag: 'Monitor', pola: /\b(monitor|lcd|led display)\b/i },
    { tag: 'UPS', pola: /\b(ups|stabilizer)\b/i },
    { tag: 'POS/Kasir', pola: /\b(pos|mesin kasir|barcode|thermal printer)\b/i },
    { tag: 'Fingerprint', pola: /\b(fingerprint|mesin absensi|attendance)\b/i },
    { tag: 'Access Control', pola: /\b(access control|akses kontrol|door lock)\b/i },
    { tag: 'PABX', pola: /\b(pabx|telepon kantor)\b/i },
    { tag: 'Smartphone', pola: /\b(smartphone|handphone|ponsel|android|iphone)\b/i },
    { tag: 'Tablet', pola: /\b(tablet|ipad)\b/i },
    { tag: 'Storage', pola: /\b(hard ?disk|ssd|flashdisk|storage)\b/i },
    { tag: 'Software', pola: /\b(software|aplikasi|windows|office|antivirus)\b/i }
  ];

  var hasil = [];
  for (var i = 0; i < aturanTag.length; i++) {
    if (aturanTag[i].pola.test(teksAsli)) hasil.push(aturanTag[i].tag);
  }
  if (hasil.length > 0) return hasil;

  // Fallback untuk produk yang belum ada di kamus: simpan nama pendek yang tetap berguna untuk pencarian.
  var stopword = {
    servis: true, service: true, perbaikan: true, repair: true, pasang: true,
    pemasangan: true, instalasi: true, install: true, maintenance: true,
    pengecekan: true, cek: true, ganti: true, penggantian: true, dan: true,
    untuk: true, dengan: true, baru: true, unit: true, buah: true
  };
  var bagian = teksAsli.split(/\n|,|;|\|/);
  for (var b = 0; b < bagian.length && hasil.length < 6; b++) {
    var bersih = String(bagian[b] || '')
      .replace(/^\s*\d+[.)-]?\s*/, '')
      .replace(/\([^)]*(?:rp|\d)[^)]*\)/ig, ' ')
      .replace(/[^A-Za-z0-9-]+/g, ' ')
      .trim();
    if (!bersih) continue;

    var token = bersih.split(/\s+/).filter(function(kata) {
      return kata && !stopword[String(kata).toLowerCase()];
    }).slice(0, 3);
    if (token.length === 0) continue;

    var tagFallback = token.map(function(kata) {
      return /^[A-Z0-9-]{2,}$/.test(kata) ? kata : kata.charAt(0).toUpperCase() + kata.slice(1).toLowerCase();
    }).join(' ').substring(0, 40);
    if (tagFallback) hasil.push(tagFallback);
  }

  return hasil;
}

function gabungkanTagProduk_(tagLama, tagBaru) {
  var hasil = [];
  var kunciTerpakai = {};

  function tambahTag_(nilai) {
    var tag = String(nilai || '').trim();
    var kunci = tag.toLowerCase();
    if (!tag || kunciTerpakai[kunci]) return;
    kunciTerpakai[kunci] = true;
    hasil.push(tag.substring(0, 40));
  }

  String(tagLama || '').split(/[,\n|;]+/).forEach(tambahTag_);
  (Array.isArray(tagBaru) ? tagBaru : [tagBaru]).forEach(tambahTag_);
  return hasil.slice(0, 24).join(', ');
}

function sinkronkanDatabaseKlien_(namaKlien, noWaKlien, sumberTransaksi, deskripsiProduk) {
  var lock = null;
  var lockDidapat = false;

  try {
    var noWANormal = normalisasiNoWA_(noWaKlien);
    if (!/^628\d{7,12}$/.test(noWANormal)) return false;

    var namaBaru = String(namaKlien || '').trim();
    var sumberBaru = String(sumberTransaksi || '').trim() || '-';
    var tagProdukBaru = ekstrakTagProduk_(deskripsiProduk);
    var waktuSekarang = new Date();
    var headerWajib = ['ID Klien', 'Nama Klien', 'No WA', 'Kategori', 'Total Transaksi', 'Transaksi Terakhir', 'Sumber', 'Tag Produk'];

    lock = LockService.getScriptLock();
    lockDidapat = lock.tryLock(10000);
    if (!lockDidapat) return false;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetKlien = ss.getSheetByName('Database Klien');
    if (!sheetKlien) {
      sheetKlien = ss.insertSheet('Database Klien');
      sheetKlien.getRange(1, 1, 1, headerWajib.length).setValues([headerWajib]);
      sheetKlien.setFrozenRows(1);
    } else if (sheetKlien.getLastRow() === 0) {
      sheetKlien.getRange(1, 1, 1, headerWajib.length).setValues([headerWajib]);
      sheetKlien.setFrozenRows(1);
    }

    var jumlahKolom = Math.max(sheetKlien.getLastColumn(), 1);
    var headerAktual = sheetKlien.getRange(1, 1, 1, jumlahKolom).getValues()[0];
    while (headerAktual.length > 0 && String(headerAktual[headerAktual.length - 1] || '').trim() === '') {
      headerAktual.pop();
    }
    for (var h = 0; h < headerWajib.length; h++) {
      if (headerAktual.indexOf(headerWajib[h]) === -1) {
        headerAktual.push(headerWajib[h]);
        sheetKlien.getRange(1, headerAktual.length).setValue(headerWajib[h]);
      }
    }

    var colId = headerAktual.indexOf('ID Klien');
    var colNama = headerAktual.indexOf('Nama Klien');
    var colNoWA = headerAktual.indexOf('No WA');
    var colKategori = headerAktual.indexOf('Kategori');
    var colTotal = headerAktual.indexOf('Total Transaksi');
    var colTerakhir = headerAktual.indexOf('Transaksi Terakhir');
    var colSumber = headerAktual.indexOf('Sumber');
    var colTagProduk = headerAktual.indexOf('Tag Produk');
    var dataKlien = sheetKlien.getDataRange().getValues();
    var barisCocok = -1;

    for (var i = dataKlien.length - 1; i >= 1; i--) {
      if (normalisasiNoWA_(dataKlien[i][colNoWA]) === noWANormal) {
        barisCocok = i;
        break;
      }
    }

    function amankanTeksSheet_(nilai) {
      var teks = String(nilai || '').trim();
      return /^[=+\-@]/.test(teks) ? "'" + teks : teks;
    }

    if (barisCocok === -1) {
      var nomorTerbesar = 0;
      for (var r = 1; r < dataKlien.length; r++) {
        var idMatch = /^KLIEN-(\d+)$/i.exec(String(dataKlien[r][colId] || '').trim());
        if (idMatch) nomorTerbesar = Math.max(nomorTerbesar, parseInt(idMatch[1], 10) || 0);
      }

      var nomorBaru = String(nomorTerbesar + 1);
      while (nomorBaru.length < 3) nomorBaru = '0' + nomorBaru;
      var barisBaru = [];
      while (barisBaru.length < headerAktual.length) barisBaru.push('');
      barisBaru[colId] = 'KLIEN-' + nomorBaru;
      barisBaru[colNama] = amankanTeksSheet_(namaBaru || 'Tanpa Nama');
      barisBaru[colNoWA] = noWANormal;
      barisBaru[colKategori] = 'Perorangan';
      barisBaru[colTotal] = 1;
      barisBaru[colTerakhir] = waktuSekarang;
      barisBaru[colSumber] = amankanTeksSheet_(sumberBaru);
      barisBaru[colTagProduk] = amankanTeksSheet_(gabungkanTagProduk_('', tagProdukBaru));
      sheetKlien.appendRow(barisBaru);
      return true;
    }

    var nomorBarisSheet = barisCocok + 1;
    var totalLama = parseInt(dataKlien[barisCocok][colTotal], 10) || 0;
    var namaLama = String(dataKlien[barisCocok][colNama] || '').replace(/^'/, '').trim();
    if (namaBaru !== '' && (namaLama === '' || namaLama === '-' || namaBaru.length > namaLama.length)) {
      sheetKlien.getRange(nomorBarisSheet, colNama + 1).setValue(amankanTeksSheet_(namaBaru));
    }
    sheetKlien.getRange(nomorBarisSheet, colNoWA + 1).setValue(noWANormal);
    sheetKlien.getRange(nomorBarisSheet, colTotal + 1).setValue(totalLama + 1);
    sheetKlien.getRange(nomorBarisSheet, colTerakhir + 1).setValue(waktuSekarang);
    sheetKlien.getRange(nomorBarisSheet, colSumber + 1).setValue(amankanTeksSheet_(sumberBaru));
    var tagGabungan = gabungkanTagProduk_(dataKlien[barisCocok][colTagProduk], tagProdukBaru);
    sheetKlien.getRange(nomorBarisSheet, colTagProduk + 1).setValue(amankanTeksSheet_(tagGabungan));
    return true;
  } catch (error) {
    // Best-effort: kegagalan CRM tidak boleh membatalkan penyelesaian tiket/penjualan utama.
    return false;
  } finally {
    if (lockDidapat && lock) lock.releaseLock();
  }
}

function updateStatusProspekOtomatis_(kriteriaKlien, statusBaru) {
  try {
    var kriteriaBersih = String(kriteriaKlien || '').trim().toLowerCase();
    var statusBersih = String(statusBaru || '').trim();
    if (kriteriaBersih === '' || statusBersih === '') return false;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetProspek = ss.getSheetByName('Prospek');
    if (!sheetProspek) return false;

    var dataProspek = sheetProspek.getDataRange().getValues();
    if (dataProspek.length < 2) return false;

    var headerProspek = dataProspek[0] || [];

    function cariKolomProspek_(namaHeader) {
      var targetHeader = String(namaHeader || '').trim().toLowerCase();
      for (var h = 0; h < headerProspek.length; h++) {
        if (String(headerProspek[h] || '').trim().toLowerCase() === targetHeader) return h;
      }
      return -1;
    }

    var colNamaCustomer = cariKolomProspek_('Nama Calon Customer');
    var colNoWA = cariKolomProspek_('No WA');
    var colStatusProspek = cariKolomProspek_('Status Prospek');
    if (colStatusProspek === -1 || (colNamaCustomer === -1 && colNoWA === -1)) return false;

    var kriteriaNoWA = normalisasiNoWA_(kriteriaBersih);
    var kriteriaAdalahNoWA = kriteriaNoWA.length >= 8;

    // Data baru selalu di-append; cari dari bawah agar prospek terbaru yang diperbarui.
    for (var i = dataProspek.length - 1; i >= 1; i--) {
      var namaCustomer = colNamaCustomer !== -1
        ? String(dataProspek[i][colNamaCustomer] || '').trim().toLowerCase()
        : '';
      var noWARaw = colNoWA !== -1
        ? String(dataProspek[i][colNoWA] || '').trim().toLowerCase()
        : '';
      var noWANormal = normalisasiNoWA_(noWARaw);

      var cocokNama = namaCustomer !== '' && namaCustomer === kriteriaBersih;
      var cocokNoWARaw = noWARaw !== '' && noWARaw === kriteriaBersih;
      var cocokNoWANormal = kriteriaAdalahNoWA && noWANormal !== '' && noWANormal === kriteriaNoWA;

      if (cocokNama || cocokNoWARaw || cocokNoWANormal) {
        sheetProspek.getRange(i + 1, colStatusProspek + 1).setValue(statusBersih);
        return true;
      }
    }

    return false;
  } catch (error) {
    // Best-effort: kegagalan sinkronisasi Prospek tidak boleh membatalkan transaksi utama.
    return false;
  }
}
