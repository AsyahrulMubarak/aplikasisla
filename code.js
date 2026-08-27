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
// =========================================================================
// 🚀 KONEKSI DATABASE SUPABASE (MESIN BARU ALFACOM)
// =========================================================================
const SUPABASE_URL = "https://oozkqjgllubhjctnkxwl.supabase.co/rest/v1/";
const SUPABASE_KEY = "sb_publishable_Wa3EUtroPjqwfCkJOyRSSw_MWnMXH6E";

// Fungsi pembantu ini akan menggantikan lambatnya Google Sheets (SpreadsheetApp)
function callSupabase(endpoint, method = "GET", payload = null) {
  var options = {
    "method": method,
    "headers": {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation" // Agar merespon dengan data terbaru
    },
    "muteHttpExceptions": true
  };
  
  if (payload) {
    options.payload = JSON.stringify(payload);
  }
  
  var response = UrlFetchApp.fetch(SUPABASE_URL + endpoint, options);
  var statusCode = response.getResponseCode();
  var isiRespons = response.getContentText() || '';
  var hasil;
  try {
    hasil = isiRespons ? JSON.parse(isiRespons) : [];
  } catch (error) {
    throw new Error('Supabase mengembalikan respons non-JSON (HTTP ' + statusCode + ').');
  }
  if (statusCode < 200 || statusCode >= 300) {
    var pesan = hasil && (hasil.message || hasil.hint || hasil.details || hasil.code);
    throw new Error('Supabase HTTP ' + statusCode + ': ' + String(pesan || 'Permintaan ditolak.'));
  }
  return hasil;
}
// =========================================================================

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

function jalankanScannerProspek_(usersData, now) {
  var dataProspek = callSupabase("prospek?select=*");
  if (!Array.isArray(usersData) || !Array.isArray(dataProspek)) {
    return { status: "gagal", pesan: "Respons Supabase Users/Prospek tidak valid." };
  }
  if (dataProspek.length === 0) return { status: "sukses", diperiksa: 0, terkirim: 0, hangus: 0 };

  var waMap = {};
  for (var u = 0; u < usersData.length; u++) {
    var namaUser = String(usersData[u].nama_asli || '').trim().toLowerCase();
    var noWaUser = String(usersData[u].no_wa || '').trim();
    if (namaUser && noWaUser) waMap[namaUser] = noWaUser;
  }

  var satuHariMs = 24 * 60 * 60 * 1000;
  var hariIni = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var jumlahDiperiksa = 0;
  var jumlahTerkirim = 0;
  var jumlahHangus = 0;

  for (var p = 0; p < dataProspek.length; p++) {
    var rowProspek = dataProspek[p];
    var statusProspek = String(rowProspek.status_prospek || '').trim();
    var statusProspekLower = statusProspek.toLowerCase();
    if (statusProspekLower.indexOf('closing') !== -1 ||
        statusProspekLower.indexOf('batal') !== -1 ||
        statusProspekLower.indexOf('proses servis') !== -1 ||
        statusProspekLower.indexOf('tanpa keterangan') !== -1) continue;

    jumlahDiperiksa++;
    var nilaiTanggalInput = rowProspek.tanggal_input;
    var riwayatFollowUp = rowProspek.riwayat_follow_up || '';
    var nilaiWaktuAcuan = rowProspek.waktu_follow_up_terakhir
      ? rowProspek.waktu_follow_up_terakhir
      : nilaiTanggalInput;

    // Regex riwayat selalu menjadi sumber terbaru jika di dalamnya ada tanggal valid.
    var waktuAcuan = getTglFollowUpTerakhir(nilaiWaktuAcuan, riwayatFollowUp);
    if (!(waktuAcuan instanceof Date) || isNaN(waktuAcuan.getTime())) continue;

    var tanggalAcuan = new Date(waktuAcuan.getFullYear(), waktuAcuan.getMonth(), waktuAcuan.getDate());
    var bedaHari = Math.floor((hariIni.getTime() - tanggalAcuan.getTime()) / satuHariMs);
    if (bedaHari < 0) continue;

    var namaCustomerProspek = String(rowProspek.nama_calon_customer || '-');
    var kebutuhanProspek = String(rowProspek.kebutuhan || '-');
    var salesProspekStr = String(rowProspek.sales_penanggung_jawab || '');
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
      callSupabase('prospek?id_prospek=eq.' + encodeURIComponent(rowProspek.id_prospek), 'PATCH', { status_prospek: "Tanpa Keterangan" });
      jumlahHangus++;

      var pesanProspekHangus = "⚠️ PROSPEK HANGUS (30 HARI) ⚠️\n\nAssalamu'alaikum,\nProspek atas nama " + namaCustomerProspek + " dibatalkan otomatis oleh sistem karena sudah 30 hari tidak ada follow-up/kejelasan.";
      for (var h = 0; h < daftarWaProspek.length; h++) {
        if (kirimNotifWAProspekDenganJeda_(daftarWaProspek[h], pesanProspekHangus)) jumlahTerkirim++;
      }
      continue;
    }

    if (bedaHari > 0 && bedaHari % 3 === 0 && daftarWaProspek.length > 0) {
      var nilaiPeringatanTerakhir = rowProspek.waktu_peringatan_crm_terakhir;
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
          callSupabase('prospek?id_prospek=eq.' + encodeURIComponent(rowProspek.id_prospek), 'PATCH', { waktu_peringatan_crm_terakhir: now.toISOString() });
        }
      }
    }
  }

  return { status: "sukses", diperiksa: jumlahDiperiksa, terkirim: jumlahTerkirim, hangus: jumlahHangus };
}

// Fungsi publik untuk Time-driven Trigger harian khusus reminder Prospek.
function cekReminderProspek() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "dilewati", pesan: "Scanner lain masih berjalan." };

  try {
    var usersData = callSupabase("users?select=*");
    return jalankanScannerProspek_(usersData, new Date());
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
    // ... sisa kode lama biarkan saja di bawahnya ...
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

function cariUserWebAuthn_(usersData, username) {
  if (!Array.isArray(usersData)) return null;
  var usernameBersih = String(username || '').trim().toLowerCase();
  if (!usernameBersih) return null;

  for (var i = 0; i < usersData.length; i++) {
    var userDB = usersData[i] || {};
    if (String(userDB.username || '').trim().toLowerCase() !== usernameBersih) continue;
    return {
      record: userDB,
      credentialId: userDB.webauthn_credential_id || userDB[WEBAUTHN_CREDENTIAL_ID_HEADER] || '',
      publicKey: userDB.webauthn_public_key || userDB[WEBAUTHN_PUBLIC_KEY_HEADER] || ''
    };
  }
  return null;
}

function buatRecordUserAman_(userDB) {
  userDB = userDB || {};
  return {
    "Username": userDB.username,
    "Role": userDB.role,
    "Nama Asli": userDB.nama_asli,
    "Email": userDB.email,
    "Target Sales (Rp)": userDB.target_sales_rp,
    "No WA": userDB.no_wa,
    "Gaji Pokok": userDB.gaji_pokok,
    "Bonus Tambahan": userDB.bonus_tambahan,
    "Hak_Akses_Cabang": userDB.hak_akses_cabang || userDB.cabang
  };
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

function cabangDeployment_() {
  var properties = PropertiesService.getScriptProperties();
  var cabang = normalisasiCabangOperasional_(properties.getProperty('CABANG_AKTIF') || properties.getProperty('CABANG_DEFAULT'));
  if (cabang) return cabang;
  try {
    var namaSpreadsheet = String(SpreadsheetApp.getActiveSpreadsheet().getName() || '').toLowerCase();
    if (namaSpreadsheet.indexOf('raha') !== -1) return 'Raha';
    if (namaSpreadsheet.indexOf('kendari') !== -1) return 'Kendari';
  } catch (error) { /* Fallback aman untuk deployment utama lama. */ }
  return 'Kendari';
}

function identitasDariSession_(usersData, dataUser) {
  if (!verifikasiSessionToken_(dataUser)) return null;
  if (!Array.isArray(usersData)) return null;

  var usernameRequest = String(dataUser.Username || '').trim().toLowerCase();
  for (var i = 0; i < usersData.length; i++) {
    var userDB = usersData[i] || {};
    if (String(userDB.username || '').trim().toLowerCase() !== usernameRequest) continue;

    var role = String(userDB.role || '').trim().toLowerCase();
    var hakAkses = normalisasiHakAksesCabang_(userDB.hak_akses_cabang || userDB.cabang);
    if (!role || !hakAkses) return null;
    return {
      role: role,
      hakAkses: hakAkses,
      username: String(userDB.username || '').trim().toLowerCase(),
      nama: String(userDB.nama_asli || userDB.username || '').trim(),
      record: userDB
    };
  }
  return null;
}

function cariResourceServer_(sheet, idHeaders, idValue) {
  if (!sheet || idValue === undefined || idValue === null || String(idValue).trim() === '') return null;
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return null;
  var headers = data[0] || [];
  var daftarHeader = Array.isArray(idHeaders) ? idHeaders : [idHeaders];
  var colId = -1;
  for (var h = 0; h < daftarHeader.length; h++) {
    colId = headers.indexOf(daftarHeader[h]);
    if (colId !== -1) break;
  }
  if (colId === -1) colId = 0;
  var target = String(idValue).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId] || '').trim().toLowerCase() === target) {
      return { headers: headers, row: data[i], rowNumber: i + 1 };
    }
  }
  return null;
}

function cabangResourceServer_(resource, fallbackCabang) {
  if (!resource) return '';
  var colCabang = resource.headers.indexOf('Cabang');
  var cabang = colCabang !== -1 ? normalisasiCabangOperasional_(resource.row[colCabang]) : '';
  return cabang || cabangOperasional_(fallbackCabang);
}

function rolesUntukAction_(action) {
  var semuaUser = ['admin', 'admin_raha', 'manager', 'direktur', 'sales', 'teknisi', 'freelance'];
  var adminDanManager = ['admin', 'admin_raha', 'manager'];
  var manajemenUtama = ['admin', 'manager', 'direktur'];
  var matriks = {
    validateSession: semuaUser,
    supabaseProxy: semuaUser,
    syncCRM: ['admin', 'admin_raha', 'manager', 'sales'],
    relayWA: semuaUser,
    buatPDF: semuaUser,
    broadcastCRM: ['admin'],
    getVariabelPayroll: manajemenUtama,
    simpanVariabelPayroll: manajemenUtama,
    updateTunjangan: manajemenUtama,
    laporBug: semuaUser,
    getTinjauanAbsen: manajemenUtama
  };
  return matriks[action] || null;
}

function validasiTargetAction_(data, ss, cabangDeployment) {
  var action = String(data.action || '');
  var target = null;
  var aksiTiket = ['tandaiLunas', 'updatePoinTiket'];

  if (aksiTiket.indexOf(action) !== -1) {
    target = cariResourceServer_(ss.getSheetByName('Tiket') || ss.getSheets()[0], 'ID Tiket', data.idTiket);
  } else if (action === 'catatFollowUp') {
    target = cariResourceServer_(ss.getSheetByName('Garansi'), 'Referensi (Tiket/Nota)', data.ref);
  }

  if (target && cabangResourceServer_(target, cabangDeployment) !== cabangDeployment) {
    return 'Data target berasal dari cabang lain.';
  }
  return '';
}

function otorisasiAction_(data, ss, usersData) {
  var action = String(data.action || '').trim();
  var cabang = cabangDeployment_();

  // --- HOTFIX: DAFTAR PUTIH JALUR PUBLIK ---
  var publikActions = ['login', 'beginBiometricLogin', 'verifyBiometric', 'lupaSandi'];
  if (publikActions.indexOf(action) !== -1) {
    return { ok: true, publik: true, cabang: cabang };
  }
  // -----------------------------------------------

  var roles = rolesUntukAction_(action);
  if (!roles) return { ok: false, pesan: 'Action API tidak dikenal atau belum diizinkan.' };

  var aktor = identitasDariSession_(usersData, data && data.user);
  if (!aktor) return { ok: false, pesan: 'Sesi tidak sah atau telah kedaluwarsa.' };

  if (roles.indexOf(aktor.role) === -1) return { ok: false, pesan: 'Role tidak memiliki izin untuk action ini.' };
  if (aktor.hakAkses !== 'Semua' && aktor.hakAkses !== cabang) return { ok: false, pesan: 'Akun tidak memiliki akses ke deployment cabang ini.' };

  data.cabang = cabang;
  data._aktor = aktor;
  if (action === 'laporBug') data.pelapor = aktor.nama;
  if (action === 'catatFollowUp') data.admin = aktor.nama;
  if (action === 'simpanVariabelPayroll') data.diubahOleh = aktor.nama;

  var errorTarget = validasiTargetAction_(data, ss, cabang);
  if (errorTarget) return { ok: false, pesan: errorTarget };
  return { ok: true, aktor: aktor, cabang: cabang };
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

function gandakanTitikJacobianP256_(titik, kurva) {
  if (!titik || titik.z === BigInt(0) || titik.y === BigInt(0)) return null;
  var p = kurva.p;
  var a = moduloBigInt_(titik.x * titik.x, p);
  var b = moduloBigInt_(titik.y * titik.y, p);
  var c = moduloBigInt_(b * b, p);
  var d = moduloBigInt_(BigInt(2) * (moduloBigInt_((titik.x + b) * (titik.x + b), p) - a - c), p);
  var z2 = moduloBigInt_(titik.z * titik.z, p);
  var e = moduloBigInt_(BigInt(3) * a + kurva.a * moduloBigInt_(z2 * z2, p), p);
  var f = moduloBigInt_(e * e, p);
  var x3 = moduloBigInt_(f - BigInt(2) * d, p);
  var y3 = moduloBigInt_(e * (d - x3) - BigInt(8) * c, p);
  var z3 = moduloBigInt_(BigInt(2) * titik.y * titik.z, p);
  return { x: x3, y: y3, z: z3 };
}

function tambahTitikJacobianP256_(p1, p2, kurva) {
  if (!p1 || p1.z === BigInt(0)) return p2;
  if (!p2 || p2.z === BigInt(0)) return p1;
  var p = kurva.p;
  var z1z1 = moduloBigInt_(p1.z * p1.z, p);
  var z2z2 = moduloBigInt_(p2.z * p2.z, p);
  var u1 = moduloBigInt_(p1.x * z2z2, p);
  var u2 = moduloBigInt_(p2.x * z1z1, p);
  var s1 = moduloBigInt_(p1.y * p2.z * z2z2, p);
  var s2 = moduloBigInt_(p2.y * p1.z * z1z1, p);
  if (u1 === u2) return s1 === s2 ? gandakanTitikJacobianP256_(p1, kurva) : null;

  var h = moduloBigInt_(u2 - u1, p);
  var i = moduloBigInt_(BigInt(4) * h * h, p);
  var j = moduloBigInt_(h * i, p);
  var r = moduloBigInt_(BigInt(2) * (s2 - s1), p);
  var v = moduloBigInt_(u1 * i, p);
  var x3 = moduloBigInt_(r * r - j - BigInt(2) * v, p);
  var y3 = moduloBigInt_(r * (v - x3) - BigInt(2) * s1 * j, p);
  var z3 = moduloBigInt_((moduloBigInt_((p1.z + p2.z) * (p1.z + p2.z), p) - z1z1 - z2z2) * h, p);
  return { x: x3, y: y3, z: z3 };
}

function kaliTitikJacobianP256_(titik, skalar, kurva) {
  var hasil = null;
  var tambah = titik ? { x: titik.x, y: titik.y, z: BigInt(1) } : null;
  var k = skalar;
  while (k > BigInt(0)) {
    if ((k & BigInt(1)) === BigInt(1)) hasil = tambahTitikJacobianP256_(hasil, tambah, kurva);
    tambah = gandakanTitikJacobianP256_(tambah, kurva);
    k >>= BigInt(1);
  }
  return hasil;
}

function jacobianKeAffineP256_(titik, kurva) {
  if (!titik || titik.z === BigInt(0)) return null;
  var zInv = inverseBigInt_(titik.z, kurva.p);
  var zInv2 = moduloBigInt_(zInv * zInv, kurva.p);
  return {
    x: moduloBigInt_(titik.x * zInv2, kurva.p),
    y: moduloBigInt_(titik.y * zInv2 * zInv, kurva.p)
  };
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
  var titikJacobian = tambahTitikJacobianP256_(
    kaliTitikJacobianP256_(g, u1, kurva),
    kaliTitikJacobianP256_(q, u2, kurva),
    kurva
  );
  var titik = jacobianKeAffineP256_(titikJacobian, kurva);
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

function mulaiRegistrasiBiometrik_(data) {
  var usersData = callSupabase("users?select=*");
  var identitas = identitasDariSession_(usersData, data.user);
  if (!identitas) return { status: 'gagal', pesan: 'Sesi login tidak sah atau telah kedaluwarsa.' };
  var username = identitas.username;
  var user = cariUserWebAuthn_(usersData, username);
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

function registerBiometric_(data) {
  var usersData = callSupabase("users?select=*");
  var identitas = identitasDariSession_(usersData, data.user);
  if (!identitas) return { status: 'gagal', pesan: 'Sesi login tidak sah atau telah kedaluwarsa.' };
  var username = identitas.username;
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
    var usersTerbaru = callSupabase("users?select=*");
    var user = cariUserWebAuthn_(usersTerbaru, username);
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
    var hasilSimpanBiometrik = callSupabase('users?username=eq.' + encodeURIComponent(username), 'PATCH', {
      webauthn_credential_id: credentialId,
      webauthn_public_key: publicKeyRecord
    });
    if (!Array.isArray(hasilSimpanBiometrik) || hasilSimpanBiometrik.length === 0) {
      throw new Error('Credential Passkey gagal disimpan ke Supabase.');
    }
  } finally {
    lock.releaseLock();
  }
  return { status: 'sukses', pesan: 'Passkey berhasil didaftarkan.' };
}

function mulaiLoginBiometrik_(data) {
  var username = String(data.username || '').trim().toLowerCase();
  if (!username) return { status: 'gagal', pesan: 'Masukkan username terlebih dahulu.' };
  var origin = String(data.origin || '').trim().replace(/\/$/, '');
  var rpId = rpIdDariOrigin_(origin);
  var usersData = callSupabase("users?select=*");
  var user = cariUserWebAuthn_(usersData, username);
  if (!user) return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' };
  var credentialId = normalisasiBase64Url_(user.credentialId);
  var keyRecord;
  try { keyRecord = bacaCredentialWebAuthnTersimpan_(user.publicKey); }
  catch (error) { return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' }; }
  if (!credentialId || keyRecord.rpId !== rpId) return { status: 'gagal', pesan: 'Passkey belum tersedia untuk akun ini.' };
  return {
    status: 'sukses',
    challengeToken: buatWebAuthnChallenge_(username, 'login', origin),
    rpId: rpId,
    credentialId: credentialId
  };
}

function verifyBiometric_(data) {
  var username = String(data.username || '').trim().toLowerCase();
  var challenge = validasiWebAuthnChallenge_(data.challengeToken, 'login', username);
  var clientData = validasiClientDataWebAuthn_(data.clientDataJSON, 'webauthn.get', data.challengeToken, challenge.o);
  var authData = validasiAuthenticatorDataWebAuthn_(data.authenticatorData, challenge.r, false);
  var usersData = callSupabase("users?select=*");
  var user = cariUserWebAuthn_(usersData, username);
  if (!user) throw new Error('Kredensial biometrik tidak valid.');
  var credentialId = normalisasiBase64Url_(data.credentialId);
  var credentialTersimpan = normalisasiBase64Url_(user.credentialId);
  if (!bandingkanStringKonstan_(credentialId, credentialTersimpan)) throw new Error('Kredensial biometrik tidak valid.');
  var keyRecord = bacaCredentialWebAuthnTersimpan_(user.publicKey);
  if (keyRecord.rpId !== challenge.r) throw new Error('RP ID credential tidak sesuai.');

  var clientDataHash = bytesUnsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clientData.bytes));
  var signedBytes = authData.bytes.concat(clientDataHash);
  if (!verifikasiSignatureEcdsaP256_(keyRecord.spki, data.signature, signedBytes)) throw new Error('Signature biometrik tidak valid.');

  if (keyRecord.signCount > 0 && authData.signCount > 0 && authData.signCount <= keyRecord.signCount) throw new Error('Counter authenticator tidak meningkat.');

  // Challenge tetap dikonsumsi secara serial, tetapi jalur login ini read-only:
  // tidak membaca ulang baris dan tidak menulis counter/last login ke Sheets.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Verifikasi biometrik sedang sibuk. Silakan ulangi.');
  try {
    konsumsiChallengeWebAuthn_(data.challengeToken);
  } finally {
    lock.releaseLock();
  }

  var record = sertakanHakAksesCabang_(buatRecordUserAman_(user.record));
  var sessionToken = buatSessionToken_(record.Username);
  return { status: 'sukses', user: record, sessionToken: sessionToken };
}

function otorisasiAdminBroadcastCRM_(dataUser, usersData) {
  if (!verifikasiSessionToken_(dataUser) || !Array.isArray(usersData)) return false;

  var usernameRequest = String(dataUser.Username || '').trim().toLowerCase();
  for (var i = 0; i < usersData.length; i++) {
    var usernameDB = String(usersData[i].username || '').trim().toLowerCase();
    if (usernameDB === usernameRequest) {
      return String(usersData[i].role || '').trim().toLowerCase() === 'admin';
    }
  }
  return false;
}

function prosesBroadcastCRM_(data, usersData) {
  if (!otorisasiAdminBroadcastCRM_(data && data.user, usersData)) {
    return { status: 'gagal', pesan: 'Afwan: Akses Broadcast ditolak. Sesi Admin tidak sah atau telah kedaluwarsa.' };
  }

  var pesanTemplate = String((data && data.pesan) || '').trim();
  var daftarKlien = data && Array.isArray(data.klien) ? data.klien : [];
  if (!pesanTemplate) return { status: 'gagal', pesan: 'Isi pesan Broadcast tidak boleh kosong.' };
  if (pesanTemplate.length > 2000) return { status: 'gagal', pesan: 'Isi pesan Broadcast maksimal 2.000 karakter.' };
  if (daftarKlien.length === 0) return { status: 'gagal', pesan: 'Daftar pelanggan Broadcast kosong.' };
  if (daftarKlien.length > 50) return { status: 'gagal', pesan: 'Maksimal 50 pelanggan dalam satu batch Broadcast.' };

  var dataDatabaseKlien = callSupabase("database_klien?select=*");
  if (!Array.isArray(dataDatabaseKlien) || dataDatabaseKlien.length === 0) {
    return { status: 'gagal', pesan: 'Database Klien belum tersedia atau masih kosong.' };
  }
  var klienTerdaftar = {};
  for (var db = 0; db < dataDatabaseKlien.length; db++) {
    var noWADatabase = normalisasiNoWA_(dataDatabaseKlien[db].no_wa);
    if (!/^628\d{7,12}$/.test(noWADatabase)) continue;
    klienTerdaftar[noWADatabase] = String(dataDatabaseKlien[db].nama_klien || '').replace(/[\r\n\t]+/g, ' ').trim().substring(0, 120) || 'Pelanggan';
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

function prosesGetAllData_(parameter, ss, identitasSesi) {
  try {
    parameter = parameter || {};
    var reqTrackId = parameter.trackId ? String(parameter.trackId).trim().toLowerCase() : null;
    if (!reqTrackId && !identitasSesi) {
      return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Sesi tidak sah atau telah kedaluwarsa."})).setMimeType(ContentService.MimeType.JSON);
    }

    var cabangRequest = cabangOperasional_(parameter.cabang);

    // 🚀 PARALLEL FETCH: Ambil 6 tabel sekaligus dalam 1 waktu (Super Cepat!)
    var headersAPI = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
    var requests = [
      { url: SUPABASE_URL + "tiket?select=*", headers: headersAPI, muteHttpExceptions: true },
      { url: SUPABASE_URL + "users?select=*", headers: headersAPI, muteHttpExceptions: true },
      { url: SUPABASE_URL + "penjualan?select=*", headers: headersAPI, muteHttpExceptions: true },
      { url: SUPABASE_URL + "prospek?select=*", headers: headersAPI, muteHttpExceptions: true },
      { url: SUPABASE_URL + "database_klien?select=*", headers: headersAPI, muteHttpExceptions: true },
      { url: SUPABASE_URL + "garansi?select=*", headers: headersAPI, muteHttpExceptions: true }
    ];
    
    var responses = UrlFetchApp.fetchAll(requests);
    var dbTiket = JSON.parse(responses[0].getContentText()) || [];
    var dbUsers = reqTrackId ? [] : (JSON.parse(responses[1].getContentText()) || []);
    var dbPenjualan = reqTrackId ? [] : (JSON.parse(responses[2].getContentText()) || []);
    var dbProspek = reqTrackId ? [] : (JSON.parse(responses[3].getContentText()) || []);
    var dbKlien = reqTrackId ? [] : (JSON.parse(responses[4].getContentText()) || []);
    var dbGaransi = JSON.parse(responses[5].getContentText()) || [];

    var resultTiket = [], resultUsers = [], resultPenjualan = [], resultProspek = [], resultKlien = [], resultGaransi = [];
    var cabangByIdTiket = {};

    // === 1. PROSES TIKET ===
    for (var i = 0; i < dbTiket.length; i++) {
       var rowDB = dbTiket[i];
       if (reqTrackId && String(rowDB.id_tiket).toLowerCase() !== reqTrackId) continue;
       
       var dtLapor = rowDB.waktu_lapor ? new Date(rowDB.waktu_lapor) : new Date();
       
       // Bungkus data dengan nama kunci (Header) yang 100% sama agar Frontend tidak error
       var record = {
         "ID Tiket": rowDB.id_tiket,
         "No Transaksi": rowDB.no_transaksi || "",
         "Waktu Lapor": rowDB.waktu_lapor,
         "Target SLA (Jam)": rowDB.target_sla_jam,
         "Tenggat Waktu": rowDB.tenggat_waktu,
         "Klien & Lokasi": rowDB.klien_lokasi,
         "Jenis Pekerjaan": rowDB.jenis_pekerjaan,
         "Teknisi": rowDB.teknisi,
         "Status": rowDB.status,
         "Waktu Selesai": rowDB.waktu_selesai,
         "Status SLA": rowDB.status_sla,
         "Poin Performa": rowDB.poin_performa,
         "Sales": rowDB.sales,
         "Keterangan": rowDB.keterangan,
         "Target SLA Respon (Jam)": rowDB.target_sla_respon_jam,
         "Tenggat Respon": rowDB.tenggat_respon,
         "Waktu Respon": rowDB.waktu_respon,
         "Status SLA Respon": rowDB.status_sla_respon,
         "Status Peringatan": rowDB.status_peringatan,
         "Deskripsi Pekerjaan (BA)": rowDB.deskripsi_pekerjaan_ba,
         "Nama Customer": rowDB.nama_customer,
         "Kritik & Saran": rowDB.kritik_saran,
         "Tanda Tangan": rowDB.tanda_tangan,
         "Status Banding": rowDB.status_banding,
         "Sales Pengaju": rowDB.sales_pengaju,
         "Bukti Banding": rowDB.bukti_banding,
         "Keterangan Sales": rowDB.keterangan_sales,
         "Alasan Admin": rowDB.alasan_admin,
         "Nilai Penjualan": rowDB.nilai_penjualan,
         "Link PDF BA": rowDB.link_pdf_ba,
         "No WA Klien": rowDB.no_wa_klien,
         "Bobot Poin": rowDB.bobot_poin,
         "Veto Admin": rowDB.veto_admin,
         "Status Pembayaran": rowDB.status_pembayaran,
         "Tanggal Lunas": rowDB.tanggal_lunas,
         "Teknisi Sebelumnya": rowDB.teknisi_sebelumnya,
         "Penalti Teknisi Lama": rowDB.penalti_teknisi_lama,
         "Tenggat Pengganti": rowDB.tenggat_pengganti,
         "Cabang": rowDB.cabang || cabangRequest,
         "Admin SLA": rowDB.admin_sla
       };
       
       cabangByIdTiket[String(rowDB.id_tiket).trim()] = record["Cabang"];

       // 🤖 Kalkulasi SLA On-the-fly (Sangat Cepat, tanpa simpan ke Excel)
       if (!record["Tenggat Waktu"]) record["Tenggat Waktu"] = hitungTenggatJamKerja(dtLapor, parseFloat(record["Target SLA (Jam)"]) || 24, record["Cabang"]);
       
       if (record["Teknisi"] !== "Belum Ditugaskan" && record["Teknisi"] !== "") {
           if (!record["Tenggat Respon"]) record["Tenggat Respon"] = hitungTenggatJamKerja(dtLapor, parseFloat(record["Target SLA Respon (Jam)"]) || 1, record["Cabang"]);
       } else { record["Tenggat Respon"] = ""; }

       var statTkt = String(record["Status"] || '').trim();
       if (statTkt === "Pending" || statTkt === "Outsource" || statTkt === "Cancel") {
           record["Status SLA"] = statTkt === "Cancel" ? "BATAL" : (statTkt === "Outsource" ? "DIOPOR" : "DIPENDING");
       } else if (!record["Status SLA"]) {
           record["Status SLA"] = (new Date() > new Date(record["Tenggat Waktu"])) ? "TERLAMBAT" : "AMAN"; 
       }

       if (!record["Status SLA Respon"]) {
           if (record["Teknisi"] === "Belum Ditugaskan" || !record["Teknisi"]) { record["Status SLA Respon"] = "AMAN"; } 
           else { record["Status SLA Respon"] = record["Waktu Respon"] ? "TERPENUHI" : ((new Date() > new Date(record["Tenggat Respon"])) ? "GAGAL" : "AMAN"); }
       }
       
       resultTiket.push(record);
    }

    // === 2. PROSES USERS ===
    for (var i = 0; i < dbUsers.length; i++) {
       resultUsers.push({
         "Username": dbUsers[i].username, "Role": dbUsers[i].role, "Nama Asli": dbUsers[i].nama_asli,
         "Email": dbUsers[i].email, "Target Sales (Rp)": dbUsers[i].target_sales_rp, "No WA": dbUsers[i].no_wa,
         "Gaji Pokok": dbUsers[i].gaji_pokok, "Bonus Tambahan": dbUsers[i].bonus_tambahan, "Hak_Akses_Cabang": dbUsers[i].hak_akses_cabang
       });
    }

    // === 3. PROSES PENJUALAN ===
    for (var i = 0; i < dbPenjualan.length; i++) {
       resultPenjualan.push({
         "ID Penjualan": dbPenjualan[i].id_penjualan, "No Transaksi": dbPenjualan[i].no_transaksi, "Waktu Lapor": dbPenjualan[i].waktu_lapor,
         "Nama Pembeli": dbPenjualan[i].nama_pembeli, "Barang / Jasa": dbPenjualan[i].barang_jasa, "Sales": dbPenjualan[i].sales, "Nominal (Rp)": dbPenjualan[i].nominal_rp
       });
    }

    // === 4. PROSES PROSPEK ===
    for (var i = 0; i < dbProspek.length; i++) {
       resultProspek.push({
         "ID Prospek": dbProspek[i].id_prospek, "Tanggal Input": dbProspek[i].tanggal_input, "Nama Calon Customer": dbProspek[i].nama_calon_customer,
         "Kebutuhan": dbProspek[i].kebutuhan, "Status Prospek": dbProspek[i].status_prospek, "Sales Penanggung Jawab": dbProspek[i].sales_penanggung_jawab,
         "Estimasi (Rp)": dbProspek[i].estimasi_rp, "Bukti Chat": dbProspek[i].bukti_chat, "Surat Penawaran": dbProspek[i].surat_penawaran, "No WA": dbProspek[i].no_wa,
         "Waktu Follow Up Terakhir": dbProspek[i].waktu_follow_up_terakhir, "Riwayat Follow Up": dbProspek[i].riwayat_follow_up, "Waktu Peringatan CRM Terakhir": dbProspek[i].waktu_peringatan_crm_terakhir,
         "Waktu Minta Penawaran": dbProspek[i].waktu_minta_penawaran, "Waktu Selesai Penawaran": dbProspek[i].waktu_selesai_penawaran, "Target SLA Penawaran (Jam)": dbProspek[i].target_sla_penawaran_jam
       });
    }

    // === 5. PROSES KLIEN ===
    for (var i = 0; i < dbKlien.length; i++) {
       resultKlien.push({
         "ID Klien": dbKlien[i].id_klien, "Nama Klien": dbKlien[i].nama_klien, "No WA": dbKlien[i].no_wa,
         "Kategori": dbKlien[i].kategori, "Total Transaksi": dbKlien[i].total_transaksi, "Transaksi Terakhir": dbKlien[i].transaksi_terakhir,
         "Sumber": dbKlien[i].sumber, "Tag Produk": dbKlien[i].tag_produk
       });
    }

    // === 6. PROSES GARANSI ===
    for (var i = 0; i < dbGaransi.length; i++) {
       if (reqTrackId && String(dbGaransi[i].referensi_tiket_nota).toLowerCase() !== reqTrackId) continue;
       var recordGaransi = {
         "ID Garansi": dbGaransi[i].id_garansi, "Referensi (Tiket/Nota)": dbGaransi[i].referensi_tiket_nota, "Nama Pelanggan": dbGaransi[i].nama_pelanggan,
         "Barang / Jasa": dbGaransi[i].barang_jasa, "Durasi (Hari)": dbGaransi[i].durasi_hari, "Status": dbGaransi[i].status, "Tanggal Mulai": dbGaransi[i].tanggal_mulai,
         "Tanggal Habis": dbGaransi[i].tanggal_habis, "No Transaksi": dbGaransi[i].no_transaksi, "Sales": dbGaransi[i].sales, "Omzet": dbGaransi[i].omzet,
         "Keterangan": dbGaransi[i].keterangan, "Follow Up After-Sales Terkirim": dbGaransi[i].follow_up_after_sales_terkirim, "Cabang": dbGaransi[i].cabang, "Admin SLA": dbGaransi[i].admin_sla
       };
       
       if (String(recordGaransi.Status).trim() === 'Aktif' && recordGaransi["Tanggal Habis"]) {
           var tglHabis = new Date(recordGaransi["Tanggal Habis"]);
           if (!isNaN(tglHabis.getTime()) && new Date() > tglHabis) { recordGaransi.Status = 'Habis (Expired)'; }
       }
       resultGaransi.push(recordGaransi);
    }

    return ContentService.createTextOutput(JSON.stringify({ 
      tickets: resultTiket, users: resultUsers, penjualan: resultPenjualan, 
      prospek: resultProspek, dataKlien: resultKlien, garansi: resultGaransi 
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Error Internal getAllData Supabase: " + err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function kunciCacheAman_(nilai) {
  return byteArrayToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(nilai || ''),
    Utilities.Charset.UTF_8
  ));
}

function batasiFrekuensi_(scope, identitas, maksimal, ttlDetik) {
  var cache = CacheService.getScriptCache();
  var key = 'rate-' + kunciCacheAman_(scope + '|' + String(identitas || '').toLowerCase());
  var jumlah = parseInt(cache.get(key) || '0', 10);
  if (jumlah >= maksimal) return false;
  cache.put(key, String(jumlah + 1), ttlDetik);
  return true;
}

function sanitasiUserSupabase_(userDB) {
  userDB = userDB || {};
  return {
    username: userDB.username,
    role: userDB.role,
    nama_asli: userDB.nama_asli,
    email: userDB.email,
    target_sales_rp: userDB.target_sales_rp,
    no_wa: userDB.no_wa,
    gaji_pokok: userDB.gaji_pokok,
    bonus_tambahan: userDB.bonus_tambahan,
    hak_akses_cabang: userDB.hak_akses_cabang || userDB.cabang
  };
}

function endpointDenganCabang_(endpoint, cabang) {
  var filter = cabang === 'Kendari'
    ? 'or=(cabang.eq.Kendari,cabang.is.null)'
    : 'cabang=eq.' + encodeURIComponent(cabang);
  return endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + filter;
}

function ambilUsernameFilter_(endpoint) {
  var cocok = String(endpoint || '').match(/[?&]username=eq\.([^&]+)/i);
  if (!cocok) return '';
  try { return decodeURIComponent(cocok[1]).trim().toLowerCase(); }
  catch (error) { return ''; }
}

function pilihProperti_(objek, daftarKolom) {
  var hasil = {};
  for (var i = 0; i < daftarKolom.length; i++) {
    var kolom = daftarKolom[i];
    if (Object.prototype.hasOwnProperty.call(objek || {}, kolom)) hasil[kolom] = objek[kolom];
  }
  return hasil;
}

function prosesSupabaseProxy_(data, aktor, cabang) {
  var endpoint = String(data.endpoint || '').trim();
  var method = String(data.method || 'GET').trim().toUpperCase();
  if (!/^(GET|POST|PATCH|DELETE)$/.test(method)) throw new Error('Metode Supabase tidak diizinkan.');
  if (!endpoint || endpoint.length > 2200 || /[\r\n;]/.test(endpoint)) throw new Error('Endpoint Supabase tidak valid.');

  var cocokTabel = endpoint.match(/^([a-z_]+)(?:\?|$)/);
  var tabel = cocokTabel ? cocokTabel[1] : '';
  var tabelOperasional = ['tiket', 'penjualan', 'prospek', 'garansi'];
  var tabelDiizinkan = tabelOperasional.concat(['users', 'database_klien']);
  if (tabelDiizinkan.indexOf(tabel) === -1) throw new Error('Tabel Supabase tidak diizinkan.');

  var role = String(aktor.role || '').toLowerCase();
  var payload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
    ? Object.assign({}, data.payload)
    : null;
  var adminOperasional = ['admin', 'admin_raha', 'manager'];
  var manajemen = ['admin', 'admin_raha', 'manager', 'direktur'];
  var hasil;

  if (method === 'GET') {
    if (tabel === 'users') {
      var semuaUsers = callSupabase('users?select=username,role,nama_asli,email,target_sales_rp,no_wa,gaji_pokok,bonus_tambahan,hak_akses_cabang,cabang');
      return semuaUsers.filter(function(userDB) {
        var hakUser = normalisasiHakAksesCabang_(userDB.hak_akses_cabang || userDB.cabang) || 'Kendari';
        return aktor.hakAkses === 'Semua' || hakUser === 'Semua' || hakUser === cabang;
      }).map(sanitasiUserSupabase_);
    }
    if (tabel === 'database_klien' && manajemen.concat(['sales']).indexOf(role) === -1) return [];
    if (tabelOperasional.indexOf(tabel) !== -1) endpoint = endpointDenganCabang_(endpoint, cabang);
    return callSupabase(endpoint, 'GET');
  }

  if (!payload) throw new Error('Payload mutasi Supabase tidak valid.');

  if (tabel === 'users') {
    var usernameTarget = ambilUsernameFilter_(endpoint);
    if (method === 'POST') {
      if (role !== 'admin') throw new Error('Hanya Admin Pusat yang dapat membuat user.');
    } else if (method === 'PATCH') {
      if (role !== 'admin') {
        if (!usernameTarget || usernameTarget !== aktor.username) throw new Error('User hanya dapat mengubah profilnya sendiri.');
        payload = pilihProperti_(payload, ['nama_asli', 'email', 'no_wa', 'password']);
      }
    } else if (method === 'DELETE' && role !== 'admin') {
      throw new Error('Hanya Admin Pusat yang dapat menghapus user.');
    }
  } else if (tabel === 'database_klien') {
    throw new Error('Database Klien hanya dapat dimutasi melalui sinkronisasi CRM terproteksi.');
  } else {
    if (method === 'POST') {
      var rolePost = {
        tiket: adminOperasional,
        penjualan: adminOperasional,
        prospek: adminOperasional.concat(['sales']),
        garansi: adminOperasional
      };
      if (rolePost[tabel].indexOf(role) === -1) throw new Error('Role tidak diizinkan menambah data ' + tabel + '.');
      payload.cabang = cabang;
      payload.admin_sla = roleAdminUntukCabang_(cabang);
    } else if (method === 'PATCH') {
      var rolePatch = {
        tiket: adminOperasional.concat(['teknisi', 'sales']),
        penjualan: adminOperasional,
        prospek: adminOperasional.concat(['sales']),
        garansi: adminOperasional
      };
      if (rolePatch[tabel].indexOf(role) === -1) throw new Error('Role tidak diizinkan mengubah data ' + tabel + '.');
      if (tabel === 'tiket' && role === 'sales') {
        payload = pilihProperti_(payload, ['status_banding', 'sales_pengaju', 'bukti_banding', 'keterangan_sales']);
      } else if (tabel === 'tiket' && role === 'teknisi') {
        payload = pilihProperti_(payload, [
          'status', 'waktu_respon', 'waktu_selesai', 'status_sla', 'status_sla_respon', 'keterangan',
          'deskripsi_pekerjaan_ba', 'nama_customer', 'kritik_saran', 'tanda_tangan', 'link_pdf_ba'
        ]);
      }
      payload.cabang = cabang;
      payload.admin_sla = roleAdminUntukCabang_(cabang);
      endpoint = endpointDenganCabang_(endpoint, cabang);
    } else if (method === 'DELETE') {
      if (['admin', 'admin_raha'].indexOf(role) === -1) throw new Error('Role tidak diizinkan menghapus data ' + tabel + '.');
      endpoint = endpointDenganCabang_(endpoint, cabang);
    }
  }

  hasil = callSupabase(endpoint, method, payload);
  if (!Array.isArray(hasil) || hasil.length === 0) throw new Error('Tidak ada baris Supabase yang berubah.');
  if (tabel === 'users') return hasil.map(sanitasiUserSupabase_);
  console.log(JSON.stringify({ event: 'supabase_mutation', action: method, table: tabel, username: aktor.username, cabang: cabang }));
  return hasil;
}

function prosesTrackingPublik_(data) {
  var idTiket = String(data.idTiket || '').trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(idTiket)) throw new Error('ID tiket tracking tidak valid.');
  if (!batasiFrekuensi_('tracking', idTiket, 30, 300)) throw new Error('Terlalu banyak permintaan tracking.');

  var idEncoded = encodeURIComponent(idTiket);
  var tiket = callSupabase(
    'tiket?select=id_tiket,waktu_lapor,klien_lokasi,jenis_pekerjaan,teknisi,status,waktu_selesai,status_sla,deskripsi_pekerjaan_ba,nama_customer,kritik_saran,link_pdf_ba,no_wa_klien,status_pembayaran,tanggal_lunas,cabang&id_tiket=eq.' + idEncoded + '&limit=1'
  );
  var garansi = callSupabase(
    'garansi?select=id_garansi,referensi_tiket_nota,nama_pelanggan,barang_jasa,durasi_hari,status,tanggal_mulai,tanggal_habis,no_transaksi,sales,omzet,keterangan,follow_up_after_sales_terkirim,cabang&referensi_tiket_nota=eq.' + idEncoded
  );
  return { status: 'sukses', tiket: tiket, garansi: garansi };
}

function prosesSinkronisasiCRM_(data, aktor, cabang) {
  var noWA = normalisasiNoWA_(data.noWaKlien);
  if (!/^628\d{7,12}$/.test(noWA)) return { status: 'gagal', pesan: 'Nomor WhatsApp klien tidak valid.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var daftar = callSupabase('database_klien?no_wa=eq.' + encodeURIComponent(noWA) + '&select=*');
    var nama = String(data.namaKlien || '').trim() || 'Pelanggan';
    var sumber = String(data.sumberTransaksi || '').trim() || '-';
    var tagBaru = String(data.deskripsiProduk || '').trim();
    var tanggal = new Date().toISOString();

    if (daftar.length > 0) {
      var lama = daftar[0];
      var tagMap = {};
      String(lama.tag_produk || '').split(',').concat([tagBaru]).forEach(function(tag) {
        var bersih = String(tag || '').trim();
        if (bersih) tagMap[bersih.toLowerCase()] = bersih;
      });
      var hasilPatch = callSupabase('database_klien?id_klien=eq.' + encodeURIComponent(lama.id_klien), 'PATCH', {
        nama_klien: nama,
        total_transaksi: (Number(lama.total_transaksi) || 0) + 1,
        transaksi_terakhir: tanggal,
        sumber: sumber,
        tag_produk: Object.keys(tagMap).map(function(k) { return tagMap[k]; }).join(', '),
        cabang: lama.cabang || cabang
      });
      if (!Array.isArray(hasilPatch) || hasilPatch.length === 0) throw new Error('CRM tidak berhasil diperbarui.');
      return { status: 'sukses', data: hasilPatch[0] };
    }

    var idBaru = 'KLIEN-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
    var hasilPost = callSupabase('database_klien', 'POST', {
      id_klien: idBaru,
      nama_klien: nama,
      no_wa: noWA,
      kategori: 'Pelanggan',
      total_transaksi: 1,
      transaksi_terakhir: tanggal,
      sumber: sumber,
      tag_produk: tagBaru,
      cabang: cabang,
      admin_sla: roleAdminUntukCabang_(cabang)
    });
    if (!Array.isArray(hasilPost) || hasilPost.length === 0) throw new Error('CRM tidak berhasil dibuat.');
    console.log(JSON.stringify({ event: 'crm_sync', username: aktor.username, cabang: cabang, id_klien: idBaru }));
    return { status: 'sukses', data: hasilPost[0] };
  } finally {
    lock.releaseLock();
  }
}

function escapeHtmlServer_(nilai) {
  return String(nilai == null ? '' : nilai)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function doGet(e) {
  try {
    var hasil = prosesTrackingPublik_({ idTiket: e && e.parameter && (e.parameter.track || e.parameter.idTiket) });
    return ContentService.createTextOutput(JSON.stringify(hasil)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": err.message || String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Payload request kosong.');
    var data = JSON.parse(e.postData.contents);
    if (!data || !data.action) throw new Error('Action request tidak tersedia.');

    if (data.action === 'trackTicket') {
      return ContentService.createTextOutput(JSON.stringify(prosesTrackingPublik_(data))).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.action === 'beginBiometricRegistration') {
      try {
        return ContentService.createTextOutput(JSON.stringify(mulaiRegistrasiBiometrik_(data))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('beginBiometricRegistration: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Pendaftaran Passkey tidak dapat dimulai."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'registerBiometric') {
      try {
        return ContentService.createTextOutput(JSON.stringify(registerBiometric_(data))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('registerBiometric: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Pendaftaran Passkey ditolak oleh verifikasi keamanan."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'beginBiometricLogin') {
      try {
        if (!batasiFrekuensi_('biometric-begin', data.username, 10, 300)) throw new Error('Terlalu banyak percobaan Passkey.');
        return ContentService.createTextOutput(JSON.stringify(mulaiLoginBiometrik_(data))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('beginBiometricLogin: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Passkey belum tersedia atau permintaan tidak sah."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'verifyBiometric') {
      try {
        return ContentService.createTextOutput(JSON.stringify(verifyBiometric_(data))).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        console.error('verifyBiometric: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Verifikasi Passkey gagal. Gunakan password sebagai fallback."})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'login') {
      var usernameReq = String(data.username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,80}$/.test(usernameReq) || !/^[0-9a-f]{64}$/i.test(String(data.passwordHash || ''))) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Format kredensial tidak valid."})).setMimeType(ContentService.MimeType.JSON);
      }
      if (!batasiFrekuensi_('login', usernameReq, 8, 300)) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Terlalu banyak percobaan login. Silakan tunggu beberapa menit."})).setMimeType(ContentService.MimeType.JSON);
      }

      var dbUsers = callSupabase("users?username=ilike." + encodeURIComponent(usernameReq) + "&select=username,role,nama_asli,email,target_sales_rp,no_wa,gaji_pokok,bonus_tambahan,hak_akses_cabang,password&limit=1");

      if (dbUsers && dbUsers.length > 0) {
        var userDB = dbUsers[0];
        var passwordDB = String(userDB.password || '').trim();

        if (bandingkanStringKonstan_(passwordDB.toLowerCase(), String(data.passwordHash).toLowerCase())) {
          var record = {
            "Username": userDB.username,
            "Role": userDB.role,
            "Nama Asli": userDB.nama_asli,
            "Email": userDB.email,
            "Target Sales (Rp)": userDB.target_sales_rp,
            "No WA": userDB.no_wa,
            "Gaji Pokok": userDB.gaji_pokok,
            "Bonus Tambahan": userDB.bonus_tambahan,
            "Hak_Akses_Cabang": userDB.hak_akses_cabang
          };
          
          record = sertakanHakAksesCabang_(record);
          var sessionToken = buatSessionToken_(record.Username);
          
          return ContentService.createTextOutput(JSON.stringify({
            "status": "sukses", 
            "user": record, 
            "sessionToken": sessionToken
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        "status": "gagal",
        "pesan": "User tidak ditemukan atau sandi salah."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheetTiket = ss.getSheetByName("Tiket") || ss.getSheets()[0];
    var usersData = callSupabase("users?select=*");
    if (!Array.isArray(usersData)) throw new Error('Respons Supabase users tidak valid.');

    // Seluruh endpoint operasional wajib melewati otorisasi server. Role, cabang,
    // dan identitas pelaku selalu diambil ulang dari Supabase users; nilai pada
    // payload browser tidak pernah menjadi sumber otoritas.
    var otorisasi = otorisasiAction_(data, ss, usersData);
    if (!otorisasi.ok) {
      return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": otorisasi.pesan})).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'supabaseProxy') {
      var hasilProxy = prosesSupabaseProxy_(data, otorisasi.aktor, otorisasi.cabang);
      return ContentService.createTextOutput(JSON.stringify({"status": "sukses", "data": hasilProxy})).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'syncCRM') {
      return ContentService.createTextOutput(JSON.stringify(prosesSinkronisasiCRM_(data, otorisasi.aktor, otorisasi.cabang))).setMimeType(ContentService.MimeType.JSON);
    }

    // 🚀 MICROSERVICE: TERMINAL RELAY WHATSAPP
    if (data.action === 'relayWA') {
      var nomorRelay = normalisasiNoWA_(data.nomorTujuan);
      var pesanRelay = String(data.pesan || '').trim();
      if (!/^628\d{7,12}$/.test(nomorRelay) || !pesanRelay || pesanRelay.length > 4000) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Tujuan atau isi WhatsApp tidak valid."})).setMimeType(ContentService.MimeType.JSON);
      }
      if (!batasiFrekuensi_('relay-wa', otorisasi.aktor.username, 40, 300)) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Batas pengiriman WhatsApp sementara tercapai."})).setMimeType(ContentService.MimeType.JSON);
      }
      var terkirim = kirimNotifWA(nomorRelay, pesanRelay);
      return ContentService.createTextOutput(JSON.stringify(terkirim
        ? {"status": "sukses", "terkirim": true}
        : {"status": "gagal", "terkirim": false, "pesan": "Gateway WhatsApp menolak pengiriman."}
      )).setMimeType(ContentService.MimeType.JSON);
    }

    // 🚀 MICROSERVICE: PEMBUAT PDF BERITA ACARA
    if (data.action === 'buatPDF') {
      try {
        if (!batasiFrekuensi_('buat-pdf', otorisasi.aktor.username, 12, 600)) throw new Error('Batas pembuatan PDF sementara tercapai.');
        if (!/^[A-Za-z0-9_-]{3,80}$/.test(String(data.idTiket || ''))) throw new Error('ID tiket PDF tidak valid.');
        var logoUrl = "https://aplikasisla.vercel.app/depan_001.png";
        var deskripsi = escapeHtmlServer_(String(data.deskripsi || "-").substring(0, 6000)).replace(/\r?\n/g, '<br>');
        var kritik = escapeHtmlServer_(String(data.kritik || "-").substring(0, 3000)).replace(/\r?\n/g, '<br>');
        var teknisiArr = String(data.teknisi || "").split(',').map(function(s){return s.trim();}).filter(function(s){return s!=="" && s!=="-" && s!=="Belum Ditugaskan";});
        var teknisiNamesHtml = "";

        if (teknisiArr.length > 0) {
          for (var x = 0; x < teknisiArr.length; x++) {
            teknisiNamesHtml += "<div style='margin-bottom: 25px;'><div style='color:#10b981; font-size:12px; font-weight:bold; font-style:italic; margin-bottom:5px;'>&#10004; Disahkan via Sistem SLA</div><b>(" + escapeHtmlServer_(teknisiArr[x]) + ")</b></div>";
          }
        } else {
          teknisiNamesHtml = "<br><br><br><b>(...........................)</b>";
        }

        var ttdImg = data.ttdImg || "";
        var htmlTemplate = "<div style='font-family: Arial, sans-serif; padding: 40px; color: #333;'><div style='text-align: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 20px; margin-bottom: 30px;'><img src='" + logoUrl + "' style='height: 65px; margin-bottom: 12px;' /><h2 style='color: #1e3a8a; margin: 0; font-size:24px;'>BERITA ACARA PENYELESAIAN PEKERJAAN</h2><h3 style='margin: 8px 0 0 0; color: #555; font-size:16px;'>CV. ALFACOM MULTI SOLUTION</h3></div><table style='width: 100%; margin-bottom: 30px; font-size: 15px; line-height: 1.8;'><tr><td width='30%'><b>ID Tiket SLA</b></td><td>: <b>" + escapeHtmlServer_(data.idTiket) + "</b></td></tr><tr><td><b>Tanggal Penyelesaian</b></td><td>: " + escapeHtmlServer_(data.waktuSelesai) + "</td></tr><tr><td><b>Nama Klien / Lokasi</b></td><td>: " + escapeHtmlServer_(data.namaKlien) + "</td></tr><tr><td><b>Teknisi Pelaksana</b></td><td>: " + escapeHtmlServer_(data.teknisi) + "</td></tr></table><h4 style='background: #f8fafc; padding: 12px; margin-bottom: 10px; border-left: 4px solid #1e3a8a;'>Rincian Instalasi / Pekerjaan:</h4><p style='font-size: 15px; margin-top: 0; min-height: 80px; line-height: 1.6;'>" + deskripsi + "</p><h4 style='background: #fefce8; padding: 12px; margin-bottom: 10px; border-left: 4px solid #f59e0b;'>Catatan / Kepuasan Pelanggan:</h4><p style='font-size: 15px; margin-top: 0; min-height: 40px; line-height: 1.6;'>" + kritik + "</p><table style='width: 100%; margin-top: 50px; text-align: center; font-size: 15px;'><tr><td width='50%' style='vertical-align: top;'><b>Klien / PIC</b><br><div style='min-height: 100px; margin-top: 15px;'>" + (ttdImg.length > 50 ? "<img src='" + ttdImg + "' style='max-width: 200px; max-height: 120px;'>" : "<br><br><br>") + "</div><b>(" + escapeHtmlServer_(data.namaCustomer || "-") + ")</b></td><td width='50%' style='vertical-align: top;'><b>Teknisi Alfacom</b><br><div style='margin-top: 15px;'>" + teknisiNamesHtml + "</div></td></tr></table></div>";

        var blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).setName("BA_" + data.idTiket + ".pdf");
        var pdfFile = blob.getAs(MimeType.PDF);
        var folderIterator = DriveApp.getFoldersByName("Berita Acara Alfacom");
        var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder("Berita Acara Alfacom");
        var savedFile = folder.createFile(pdfFile);
        savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        return ContentService.createTextOutput(JSON.stringify({"status": "sukses", "url": savedFile.getUrl()})).setMimeType(ContentService.MimeType.JSON);
      } catch(e) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": e.toString()})).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === 'validateSession') {
      return ContentService.createTextOutput(JSON.stringify({
        "status": "sukses",
        "user": sertakanHakAksesCabang_(buatRecordUserAman_(otorisasi.aktor.record))
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (data.action === 'broadcastCRM') {
      var hasilBroadcastCRM = prosesBroadcastCRM_(data, usersData);
      return ContentService.createTextOutput(JSON.stringify(hasilBroadcastCRM)).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (data.action === 'tandaiLunas') {
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
      

    }

    if (data.action === 'getVariabelPayroll') {
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
      var namaTargetTunjangan = String(data.namaAsli || '').trim().toLowerCase();
      var userTargetTunjangan = null;
      for (var i = 0; i < usersData.length; i++) {
        if (String(usersData[i].nama_asli || '').trim().toLowerCase() === namaTargetTunjangan) {
          userTargetTunjangan = usersData[i];
          break;
        }
      }
      if (!userTargetTunjangan || !userTargetTunjangan.username) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "User target tunjangan tidak ditemukan."})).setMimeType(ContentService.MimeType.JSON);
      }
      var hasilUpdateTunjangan = callSupabase('users?username=eq.' + encodeURIComponent(userTargetTunjangan.username), 'PATCH', {
        bonus_tambahan: data.tunjanganData
      });
      if (!Array.isArray(hasilUpdateTunjangan) || hasilUpdateTunjangan.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Tunjangan gagal disimpan ke Supabase."})).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({"status": "sukses"})).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'laporBug') {
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

        for (var u = 0; u < usersData.length; u++) {
            if (String(usersData[u].role || '').trim().toLowerCase() === 'admin') {
                var noWAAdmin = String(usersData[u].no_wa || '').trim();
                if (noWAAdmin !== "") kirimNotifWA(noWAAdmin, pesanWA);
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
        var namaAsliReset = "";

        for (var i = 0; i < usersData.length; i++) {
            if (String(usersData[i].username || '').trim().toLowerCase() === String(data.username || '').trim().toLowerCase()) {
                namaAsliReset = String(usersData[i].nama_asli || data.username || '').trim();
                break;
            }
        }

        if (namaAsliReset === "") {
            return ContentService.createTextOutput(JSON.stringify({"status": "gagal", "pesan": "Username tidak ditemukan!"})).setMimeType(ContentService.MimeType.JSON);
        }

        var pesanResetSandi = "⚠️ *PERMINTAAN RESET SANDI* ⚠️\n\nAssalamu'alaikum Admin, user *" + namaAsliReset + "* (Username: " + data.username + ") meminta reset password. Segera hubungi yang bersangkutan.";
        for (var u = 0; u < usersData.length; u++) {
            if (String(usersData[u].role || '').trim().toLowerCase() === 'admin') {
                var noWaAdminReset = String(usersData[u].no_wa || '').trim();
                if (noWaAdminReset !== "") kirimNotifWA(noWaAdminReset, pesanResetSandi);
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
  var tiketData = callSupabase("tiket?select=*");
  var usersData = callSupabase("users?select=*");
  var garansiData = callSupabase("garansi?select=*");
  if (!Array.isArray(tiketData) || !Array.isArray(usersData) || !Array.isArray(garansiData)) {
    throw new Error("Respons Supabase untuk Robot Scanner tidak valid.");
  }

  var now = new Date();

  var hariIni = now.getDay();
  var jamIni = now.getHours();
  if (hariIni === 0 || jamIni < 8 || jamIni >= 20) return;

  var waMap = {};
  for (var u = 0; u < usersData.length; u++) {
    var namaAsli = String(usersData[u].nama_asli || '').trim().toLowerCase();
    var noWA = String(usersData[u].no_wa || '').trim();
    if (namaAsli && noWA !== "") { waMap[namaAsli] = noWA; }
  }

  function kirimNotifKeAdminCabangScanner_(cabang, pesan) {
    var roleTarget = roleAdminUntukCabang_(cabang);
    var terkirim = 0;
    for (var indexUser = 0; indexUser < usersData.length; indexUser++) {
      var role = String(usersData[indexUser].role || '').trim().toLowerCase();
      var nomor = String(usersData[indexUser].no_wa || '').trim();
      if (role === roleTarget && nomor && kirimNotifWA(nomor, pesan)) terkirim++;
    }
    return terkirim;
  }

  var cabangTiketByIdScanner = {};
  for (var tkt = 0; tkt < tiketData.length; tkt++) {
    if (!tiketData[tkt].id_tiket) continue;
    cabangTiketByIdScanner[String(tiketData[tkt].id_tiket).trim()] = cabangOperasional_(tiketData[tkt].cabang);
  }

  var listRefGaransi = {};
  for (var g = 0; g < garansiData.length; g++) {
    if (!garansiData[g].referensi_tiket_nota) continue;
    var refGaransiScanner = String(garansiData[g].referensi_tiket_nota).trim();
    var cabangGaransiScanner = cabangOperasional_(garansiData[g].cabang || cabangTiketByIdScanner[refGaransiScanner]);
    listRefGaransi[cabangGaransiScanner + '|' + refGaransiScanner] = true;
  }

  for (var i = 0; i < tiketData.length; i++) {
    var row = tiketData[i];
    var idTiket = row.id_tiket;
    var statusTiket = String(row.status || '').trim();
    if (statusTiket === "Cancel" || !idTiket) continue;

    var cabangTiketScanner = cabangOperasional_(row.cabang);
    var roleAdminTiketScanner = roleAdminUntukCabang_(cabangTiketScanner);
    var jamOperasionalTiketScanner = jamOperasionalCabang_(cabangTiketScanner);
    if (jamIni >= jamOperasionalTiketScanner.selesai) continue;

    var klien = row.klien_lokasi || "-";
    var pekerjaan = row.jenis_pekerjaan || "-";
    var teknisiStr = String(row.teknisi || '').trim();
    var labelAdminTiketScanner = cabangTiketScanner === 'Raha' ? 'Admin Raha' : 'Admin Kendari';
    var statusPeringatanLama = String(row.status_peringatan || '');
    var statusPeringatanBaru = statusPeringatanLama;

    if (statusTiket === "Selesai") {
        if (!listRefGaransi[cabangTiketScanner + '|' + idTiket]) {
            var waktuSelesaiTiket = row.waktu_selesai instanceof Date
              ? row.waktu_selesai
              : (row.waktu_selesai ? new Date(row.waktu_selesai) : new Date(NaN));
            if (!isNaN(waktuSelesaiTiket.getTime())) {
                var jamKerjaNganggurNota = hitungDurasiJamKerjaMs(waktuSelesaiTiket, now, cabangTiketScanner) / (1000 * 60 * 60);
                if (jamKerjaNganggurNota >= 9 && statusPeringatanLama.indexOf("ADMIN_NOTA_FAILED") === -1) {
                    var teksAdminNota_Admin = "🚨 *SLA ADMIN GAGAL (BUAT NOTA)* 🚨\n\nAssalamu'alaikum " + labelAdminTiketScanner + ",\nTiket Selesai Cabang " + cabangTiketScanner + " berikut sudah lebih dari 9 Jam Kerja belum dibuatkan Nota & Garansi!\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nSegera buatkan Nota agar SLA Anda tidak semakin merah!\n🌐 https://aplikasisla.vercel.app/";
                    var teksAdminNota_Manager = "⚠️ *LAPORAN KELALAIAN ADMIN (SLA NOTA)* ⚠️\n\nAssalamu'alaikum Manager,\nSistem mencatat " + labelAdminTiketScanner + " belum membuat Nota/Garansi melebihi batas 9 Jam Kerja untuk tiket selesai berikut:\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon untuk menegur dan mengingatkan Admin terkait kelalaian ini agar dokumen Klien segera diproses.\n🌐 https://aplikasisla.vercel.app/";
                    
                    kirimNotifKeAdminCabangScanner_(cabangTiketScanner, teksAdminNota_Admin);
                    for (var u = 0; u < usersData.length; u++) {
                        var roleUser = String(usersData[u].role || '').toLowerCase().trim();
                        var noWABos = String(usersData[u].no_wa || '').trim();
                        if (noWABos !== "" && (roleUser === 'manager' || roleUser === 'direktur')) kirimNotifWA(noWABos, teksAdminNota_Manager);
                    }
                    statusPeringatanBaru += " [ADMIN_NOTA_FAILED]";
                }
            }
        }
        if (statusPeringatanBaru !== statusPeringatanLama) {
          callSupabase('tiket?id_tiket=eq.' + encodeURIComponent(idTiket), 'PATCH', { status_peringatan: statusPeringatanBaru.trim(), cabang: cabangTiketScanner, admin_sla: roleAdminTiketScanner });
        }
        continue; 
    }

    // ==========================================
    // PERBAIKAN BUG: MENCEGAH ROBOT MENGIRIM PERINGATAN JIKA PENDING/OUTSOURCE
    // ==========================================
    if (statusTiket === "Pending" || statusTiket === "Outsource") {
        continue; 
    }
    if (teknisiStr === "Belum Ditugaskan" || !teknisiStr || teknisiStr === "-") {
      var waktuLaporTiket = row.waktu_lapor instanceof Date
        ? row.waktu_lapor
        : (row.waktu_lapor ? new Date(row.waktu_lapor) : new Date(NaN));
      if (!isNaN(waktuLaporTiket.getTime())) {
        var jamKerjaNganggur = hitungDurasiJamKerjaMs(waktuLaporTiket, now, cabangTiketScanner) / (1000 * 60 * 60);
        if (jamKerjaNganggur >= 27 && statusPeringatanLama.indexOf("ADMIN_SLA_FAILED") === -1) {
          var teksAdminTech_Admin = "⚠️ *SLA ADMIN GAGAL (BUTUH TEKNISI)* ⚠️\n\nAssalamu'alaikum " + labelAdminTiketScanner + ",\nTiket Cabang " + cabangTiketScanner + " berikut sudah melewati batas 3 Hari Kerja tanpa ditugaskan kepada teknisi manapun!\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon segera tugaskan teknisi!\n🌐 https://aplikasisla.vercel.app/";
          var teksAdminTech_Manager = "⚠️ *LAPORAN KELALAIAN ADMIN (PENUGASAN TEKNISI)* ⚠️\n\nAssalamu'alaikum Manager,\nSistem mencatat " + labelAdminTiketScanner + " belum menugaskan Teknisi melebihi batas 3 Hari Kerja untuk tiket berikut:\n\n🎫 *ID Tiket:* " + idTiket + "\n🏢 *Klien:* " + klien + "\n\nMohon tegur dan ingatkan Admin atas kelalaian distribusi tugas ini, atau evaluasi penambahan SDM Teknisi jika beban kerja saat ini terlalu tinggi.\n🌐 https://aplikasisla.vercel.app/";
          
          kirimNotifKeAdminCabangScanner_(cabangTiketScanner, teksAdminTech_Admin);
          for (var u = 0; u < usersData.length; u++) {
            var roleUser = String(usersData[u].role || '').toLowerCase().trim();
            var noWABos = String(usersData[u].no_wa || '').trim();
            if (noWABos !== "" && (roleUser === 'manager' || roleUser === 'direktur')) kirimNotifWA(noWABos, teksAdminTech_Manager);
          }
          statusPeringatanBaru += " [ADMIN_SLA_FAILED]";
        }
      }
      if (statusPeringatanBaru !== statusPeringatanLama) {
        callSupabase('tiket?id_tiket=eq.' + encodeURIComponent(idTiket), 'PATCH', { status_peringatan: statusPeringatanBaru.trim(), cabang: cabangTiketScanner, admin_sla: roleAdminTiketScanner });
      }
      continue; 
    }

    var tenggatRespon = row.tenggat_respon ? new Date(row.tenggat_respon) : null;
    var waktuRespon = row.waktu_respon;
    var tenggatPengerjaan = row.tenggat_waktu ? new Date(row.tenggat_waktu) : null;

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

    if (statusPeringatanBaru !== statusPeringatanLama) {
      callSupabase('tiket?id_tiket=eq.' + encodeURIComponent(idTiket), 'PATCH', { status_peringatan: statusPeringatanBaru.trim(), cabang: cabangTiketScanner, admin_sla: roleAdminTiketScanner });
    }
  }

  // Jalur cadangan: scanner khusus tetap dipanggil saat cek SLA berjalan.
  // Penanda per hari mencegah WA terkirim dua kali jika trigger 07:00 sudah sukses.
  jalankanScannerProspek_(usersData, now);
}

// ==========================================
// FUNGSI HELPER: SINKRONISASI SALES DARI GARANSI KE TIKET
// ==========================================
function robotPengecekGaransiHarian() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: "dilewati", pesan: "Robot lain masih berjalan." };

  try {
    var dataTiket = callSupabase("tiket?select=*");
    var dataGaransi = callSupabase("garansi?select=*");
    if (!Array.isArray(dataTiket) || !Array.isArray(dataGaransi)) {
      return { status: "gagal", pesan: "Respons Supabase Tiket/Garansi tidak valid." };
    }
    if (dataTiket.length === 0 || dataGaransi.length === 0) {
      return { status: "sukses", diperiksa: 0, terkirim: 0 };
    }

    var tiketById = {};
    for (var t = 0; t < dataTiket.length; t++) {
      var idTiket = String(dataTiket[t].id_tiket || "").trim();
      if (idTiket !== "") tiketById[idTiket] = dataTiket[t];
    }

    function tentukanHariFollowUp_(durasiHari) {
      if (durasiHari === 7) return 5;
      if (durasiHari === 30) return 7;
      if (durasiHari >= 90 && durasiHari <= 365) return 30;
      return 0;
    }

    var followUpSudahTerkirim = {};
    for (var g = 0; g < dataGaransi.length; g++) {
      var refAwal = String(dataGaransi[g].referensi_tiket_nota || "").trim();
      var durasiAwal = parseInt(dataGaransi[g].durasi_hari, 10) || 0;
      var hariAwal = tentukanHariFollowUp_(durasiAwal);
      if (refAwal && hariAwal && String(dataGaransi[g].follow_up_after_sales_terkirim || "").trim() !== "") {
        followUpSudahTerkirim[refAwal + "|" + hariAwal] = true;
      }
    }

    var sekarang = new Date();
    var hariIni = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate());
    var satuHariMs = 24 * 60 * 60 * 1000;
    var jumlahDiperiksa = 0;
    var jumlahTerkirim = 0;

    for (var i = 0; i < dataGaransi.length; i++) {
      var referensiTiket = String(dataGaransi[i].referensi_tiket_nota || "").trim();
      if (!referensiTiket || !tiketById[referensiTiket]) continue;

      var tiket = tiketById[referensiTiket];
      var statusTiket = String(tiket.status || "").toUpperCase();
      if (statusTiket.indexOf("SELESAI") === -1) continue;

      var statusGaransi = String(dataGaransi[i].status || "").toUpperCase();
      if (statusGaransi.indexOf("HABIS") !== -1 || statusGaransi.indexOf("HANGUS") !== -1 || statusGaransi.indexOf("DIKLAIM") !== -1) continue;

      var garansiHari = parseInt(dataGaransi[i].durasi_hari, 10) || 0;
      var hariFollowUp = tentukanHariFollowUp_(garansiHari);
      if (hariFollowUp === 0) continue;
      jumlahDiperiksa++;

      var tglSelesai = tiket.waktu_selesai instanceof Date
        ? tiket.waktu_selesai
        : (tiket.waktu_selesai ? new Date(tiket.waktu_selesai) : new Date(NaN));
      if (isNaN(tglSelesai.getTime())) continue;
      var tanggalSelesai = new Date(tglSelesai.getFullYear(), tglSelesai.getMonth(), tglSelesai.getDate());
      var daysPassed = Math.floor((hariIni.getTime() - tanggalSelesai.getTime()) / satuHariMs);
      if (daysPassed !== hariFollowUp || daysPassed < 0) continue;

      var kunciFollowUp = referensiTiket + "|" + hariFollowUp;
      if (followUpSudahTerkirim[kunciFollowUp]) continue;

      var waKlien = String(tiket.no_wa_klien || "").replace(/\D/g, "");
      if (waKlien.indexOf("0") === 0) waKlien = "62" + waKlien.substring(1);
      if (waKlien.indexOf("8") === 0) waKlien = "62" + waKlien;
      if (waKlien === "") continue;

      var namaKlien = String(tiket.klien_lokasi || tiket.nama_customer || "").trim();
      if (!namaKlien) namaKlien = String(dataGaransi[i].nama_pelanggan || "").trim();
      if (!namaKlien) namaKlien = "Bapak/Ibu";

      var layanan = String(dataGaransi[i].barang_jasa || "").trim();
      if (!layanan) layanan = String(tiket.jenis_pekerjaan || "").trim();
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
        callSupabase('garansi?id_garansi=eq.' + encodeURIComponent(dataGaransi[i].id_garansi), 'PATCH', { follow_up_after_sales_terkirim: "HARI_" + hariFollowUp + " | " + waktuKirim });
        followUpSudahTerkirim[kunciFollowUp] = true;
        jumlahTerkirim++;
      }
    }

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
