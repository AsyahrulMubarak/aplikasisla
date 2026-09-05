// Install ONLY in the PTS Apps Script project. Required Script Properties:
// PTS_SPREADSHEET_ID and PTS_BRIDGE_SECRET (same random secret as Vercel).
// Only doGet/doPost are public; all data/setup/security helpers end in "_".

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    success: false, message: 'PTS menggunakan login Alfacom.',
    portal: 'https://aplikasisla.vercel.app/index.html'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = null;
  var held = false;
  try {
    var raw = e && e.postData && e.postData.contents;
    ptsAssert_(typeof raw === 'string' && raw.length <= 240000, 'Permintaan tidak valid.', 'INVALID_PAYLOAD');
    var envelope = JSON.parse(raw);
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('PTS_BRIDGE_SECRET') || '';
    ptsAssert_(/^[0-9a-f]{64,128}$/i.test(secret), 'Konfigurasi PTS belum lengkap.', 'CONFIGURATION');
    ptsAssert_(typeof envelope.body === 'string' && envelope.body.length <= 196608, 'Permintaan tidak valid.', 'INVALID_PAYLOAD');
    ptsAssert_(typeof envelope.timestamp === 'number' && isFinite(envelope.timestamp) &&
      Math.floor(envelope.timestamp) === envelope.timestamp && envelope.timestamp >= Date.now() - 120000 &&
      envelope.timestamp <= Date.now() + 30000 && ptsUuid_(envelope.nonce), 'Permintaan kedaluwarsa.', 'AUTHENTICATION');
    var expected = ptsHex_(Utilities.computeHmacSha256Signature(
      String(envelope.timestamp) + '.' + envelope.nonce + '.' + envelope.body, secret, Utilities.Charset.UTF_8));
    ptsAssert_(ptsEqual_(expected, envelope.signature), 'Permintaan tidak diizinkan.', 'AUTHENTICATION');
    var request = JSON.parse(envelope.body);
    var actor = request.actor;
    ptsAssert_(request.audience === 'pts-v1' && ['session', 'getScenarios', 'saveScenario', 'deleteScenario'].indexOf(request.action) >= 0,
      'Operasi tidak diizinkan.', 'AUTHENTICATION');
    ptsAssert_(actor && ptsUuid_(actor.id) && typeof actor.username === 'string' && actor.username.length > 0 && actor.username.length <= 120 &&
      ['admin', 'manager', 'direktur'].indexOf(actor.role) >= 0, 'Akses PTS ditolak.', 'AUTHENTICATION');
    lock = LockService.getScriptLock();
    held = lock.tryLock(5000);
    ptsAssert_(held, 'PTS sedang memproses permintaan lain. Silakan coba kembali.', 'BUSY');
    ptsConsumeNonce_(properties, envelope.nonce);
    var ss = ptsSpreadsheet_();
    ptsVerifyDatabase_(ss);
    if (request.action === 'session') return ptsJson_({ success: true });
    if (request.action === 'getScenarios') {
      var result = getScenarios_(actor);
      if (result.success) {
        var pending = ptsPendingScenarios_(ss);
        result.data = result.data.filter(function(row) { return !pending[row.id]; });
      }
      return ptsJson_(result);
    }
    ptsAssert_(ptsUuid_(request.requestId), 'ID permintaan tidak valid.', 'INVALID_PAYLOAD');
    if (request.action === 'saveScenario') ptsValidatePayload_(request.payload);
    else ptsAssert_(request.payload && /^SCN-[0-9a-f-]{8,36}$/i.test(request.payload.scenarioId || ''), 'ID skenario tidak valid.', 'INVALID_PAYLOAD');
    return ptsJson_(ptsMutation_(ss, request));
  } catch (error) {
    return ptsJson_({ success: false, code: error.ptsCode || 'CONFIGURATION',
      message: error.ptsCode ? error.message : 'Backend PTS belum siap. Hubungi pengelola.' });
  } finally {
    if (held) lock.releaseLock();
  }
}

function ptsJson_(result) {
  result.protocol = 'pts-v1';
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function ptsAssert_(condition, message, code) {
  if (!condition) { var error = new Error(message); error.ptsCode = code; throw error; }
}
function ptsUuid_(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function ptsHex_(bytes) { return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function ptsEqual_(a, b) {
  if (typeof b !== 'string' || !/^[0-9a-f]{64}$/.test(b)) return false;
  var different = 0;
  for (var i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
function ptsConsumeNonce_(properties, nonce) {
  // Durable replay records, protected by the same script lock. Cache eviction
  // must never turn a previously accepted signature into a new request.
  var records = JSON.parse(properties.getProperty('PTS_REQUEST_NONCES') || '{}');
  var now = Date.now();
  Object.keys(records).forEach(function(key) { if (records[key] <= now) delete records[key]; });
  ptsAssert_(!records[nonce], 'Permintaan sudah diterima.', 'AUTHENTICATION');
  ptsAssert_(Object.keys(records).length < 110, 'PTS sedang sibuk. Silakan coba kembali sebentar lagi.', 'BUSY');
  records[nonce] = now + 151000;
  properties.setProperty('PTS_REQUEST_NONCES', JSON.stringify(records));
}
function ptsSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('PTS_SPREADSHEET_ID') || '';
  ptsAssert_(/^[A-Za-z0-9_-]{20,100}$/.test(id), 'Database PTS belum dikonfigurasi.', 'CONFIGURATION');
  return SpreadsheetApp.openById(id);
}
function ptsVerifyDatabase_(ss) {
  var sheet = ss.getSheetByName('TargetScenarios');
  ptsAssert_(sheet && sheet.getLastRow() > 0, 'Database ini belum dikenali sebagai PTS.', 'CONFIGURATION');
  var expected = ['ID', 'Title', 'Opex', 'Salary', 'Reserve', 'Profit', 'HppPct', 'MarketingCount', 'SalesRatio', 'TotalSales', 'SalesTarget', 'PerMarketingTarget', 'WalkinTarget', 'CreatedBy', 'CreatedAt'];
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  ptsAssert_(expected.every(function(value, i) { return value === String(actual[i]); }), 'Struktur database PTS tidak cocok.', 'CONFIGURATION');
  var others = {
    TargetSalesAllocations: ['ScenarioID', 'ScenarioTitle', 'SalesNo', 'SalesName', 'TargetSales', 'AssignmentMode', 'TotalSalesTarget', 'AssignedSalesTarget', 'RemainingSalesTarget', 'CreatedBy', 'CreatedAt'],
    SalesRealizations: ['ScenarioID', 'ScenarioTitle', 'RowNo', 'SalesNo', 'SalesName', 'TargetSales', 'RealisasiOmset', 'AchievementPct', 'SurplusOmset', 'DeficitOmset', 'Status', 'BonusLevel', 'BonusBreakdown', 'BonusAmount', 'CreatedBy', 'CreatedAt'],
    CommissionSummary: ['ScenarioID', 'ScenarioTitle', 'TotalTargetTeam', 'TotalRealisasiTeam', 'MarginPct', 'MarginKotorDidapat', 'TotalBonusDibayar', 'SisaMarginPerusahaan', 'CreatedBy', 'CreatedAt']
  };
  Object.keys(others).forEach(function(name) {
    var existing = ss.getSheetByName(name);
    if (!existing) return; // Existing optional sheets are created only on save.
    var headers = existing.getRange(1, 1, 1, others[name].length).getValues()[0];
    ptsAssert_(others[name].every(function(value, i) { return value === String(headers[i]); }), 'Struktur database PTS tidak cocok.', 'CONFIGURATION');
  });
}
function sanitizeInput_(value) {
  if (typeof value !== 'string') return value;
  var text = value.replace(/<[^>]*>?/gm, '').trim();
  return /^[=+@-]/.test(text) ? "'" + text : text;
}
function safeDateFormat_(date) { return Utilities.formatDate(date || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function logAction_(username, action, details) {
  try {
    var sheet = ptsSpreadsheet_().getSheetByName('AuditLog');
    if (sheet) sheet.appendRow([safeDateFormat_(new Date()), sanitizeInput_(username), action, JSON.stringify(details || {})]);
  } catch (_) { /* Business results do not depend on optional audit output. */ }
}
function ptsValidatePayload_(p) {
  ptsAssert_(p && typeof p === 'object' && !Array.isArray(p), 'Data skenario tidak valid.', 'INVALID_PAYLOAD');
  ptsAssert_(typeof p.title === 'string' && p.title.trim().length > 0 && p.title.length <= 200, 'Judul skenario wajib diisi, maksimal 200 karakter.', 'INVALID_PAYLOAD');
  function number(value, min, max) { return (value === undefined || value === null) || (typeof value === 'number' && isFinite(value) && value >= min && value <= max); }
  var money = ['opex', 'salary', 'profit', 'totalSales', 'salesTarget', 'perMarketingTarget', 'walkinTarget', 'assignedSalesTarget'];
  money.forEach(function(key) { ptsAssert_(number(p[key], 0, 1e15), 'Angka skenario tidak valid.', 'INVALID_PAYLOAD'); });
  ['reserve', 'remainingSalesTarget'].forEach(function(key) { ptsAssert_(number(p[key], -1e15, 1e15), 'Angka skenario tidak valid.', 'INVALID_PAYLOAD'); });
  ['hppPct', 'opexPct', 'profitPct', 'salesRatio'].forEach(function(key) { ptsAssert_(number(p[key], 0, 100), 'Persentase harus antara 0 dan 100.', 'INVALID_PAYLOAD'); });
  ptsAssert_(number(p.fixedCostPct, 0, 1e15) && number(p.marketingCount, 0, 200) && (!p.marketingCount || Math.floor(p.marketingCount) === p.marketingCount), 'Jumlah sales tidak valid.', 'INVALID_PAYLOAD');
  ['salesTargetAllocation', 'salesRealizations'].forEach(function(key) {
    var list = p[key];
    ptsAssert_(list === undefined || (Array.isArray(list) && list.length <= 200), 'Maksimal 200 baris sales per skenario.', 'INVALID_PAYLOAD');
    (list || []).forEach(function(item) {
      ptsAssert_(item && typeof item === 'object' && !Array.isArray(item), 'Baris sales tidak valid.', 'INVALID_PAYLOAD');
      ['name', 'status', 'bonusLevel', 'bonusBreakdown'].forEach(function(field) {
        ptsAssert_(item[field] === undefined || (typeof item[field] === 'string' && item[field].length <= 600), 'Teks sales terlalu panjang.', 'INVALID_PAYLOAD');
      });
      ['salesNo', 'rowNo', 'target', 'realisasi', 'achievementPct', 'surplus', 'deficit', 'bonus'].forEach(function(field) {
        ptsAssert_(number(item[field], 0, 1e15), 'Nilai sales tidak valid.', 'INVALID_PAYLOAD');
      });
    });
  });
  if (p.commissionSummary !== undefined && p.commissionSummary !== null) {
    ptsAssert_(typeof p.commissionSummary === 'object' && !Array.isArray(p.commissionSummary), 'Ringkasan komisi tidak valid.', 'INVALID_PAYLOAD');
    ['totalTargetTeam', 'totalReal', 'marginPct', 'totalMarginGot', 'totalBonus'].forEach(function(key) {
      ptsAssert_(number(p.commissionSummary[key], 0, 1e15), 'Ringkasan komisi tidak valid.', 'INVALID_PAYLOAD');
    });
    ptsAssert_(number(p.commissionSummary.netCompany, -1e15, 1e15), 'Sisa margin tidak valid.', 'INVALID_PAYLOAD');
  }
}
function ptsLedger_(ss) {
  var headers = ['RequestID', 'ActorID', 'Action', 'PayloadHash', 'ScenarioID', 'Status', 'Response', 'CreatedAt'];
  var sheet = ss.getSheetByName('PTS_Operations');
  if (!sheet) { sheet = ss.insertSheet('PTS_Operations'); sheet.appendRow(headers); }
  var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  ptsAssert_(headers.every(function(value, i) { return value === actual[i]; }), 'Catatan operasi PTS tidak cocok.', 'CONFIGURATION');
  return sheet;
}
function ptsPendingScenarios_(ss) {
  var pending = {};
  var ledger = ss.getSheetByName('PTS_Operations');
  if (!ledger || ledger.getLastRow() < 2) return pending;
  ledger.getRange(2, 1, ledger.getLastRow() - 1, 8).getValues().forEach(function(row) {
    if (row[2] === 'saveScenario' && row[5] !== 'DONE') pending[row[4]] = true;
  });
  return pending;
}
function ptsRemoveScenario_(ss, id) {
  ['TargetSalesAllocations', 'SalesRealizations', 'CommissionSummary', 'TargetScenarios'].forEach(function(name) {
    deleteRowsByScenarioId_(ss.getSheetByName(name), id);
  });
}
function ptsMutation_(ss, request) {
  var ledger = ptsLedger_(ss);
  var rows = ledger.getLastRow() > 1 ? ledger.getRange(2, 1, ledger.getLastRow() - 1, 8).getValues() : [];
  var hash = ptsHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(request.payload), Utilities.Charset.UTF_8));
  var index = -1;
  for (var i = 0; i < rows.length; i++) { if (String(rows[i][0]) === request.requestId) { index = i; break; } }
  var record;
  var rowNumber;
  if (index >= 0) {
    record = rows[index]; rowNumber = index + 2;
    ptsAssert_(record[1] === request.actor.id && record[2] === request.action && record[3] === hash, 'ID permintaan sudah dipakai untuk data berbeda.', 'CONFLICT');
    if (record[5] === 'DONE') return JSON.parse(record[6]);
  } else {
    var id = request.action === 'saveScenario' ? 'SCN-' + Utilities.getUuid() : request.payload.scenarioId;
    if (request.action === 'deleteScenario') {
      var scenarios = ss.getSheetByName('TargetScenarios');
      var ids = scenarios.getLastRow() > 1 ? scenarios.getRange(2, 1, scenarios.getLastRow() - 1, 1).getValues() : [];
      ptsAssert_(ids.some(function(row) { return String(row[0]) === id; }), 'Skenario tidak ditemukan.', 'NOT_FOUND');
    }
    record = [request.requestId, request.actor.id, request.action, hash, id, 'PENDING', '', safeDateFormat_(new Date())];
    ledger.appendRow(record); rowNumber = ledger.getLastRow();
  }
  try {
    var result;
    if (request.action === 'saveScenario') {
      // Retry reuses the same ID and cleans only its own incomplete attempt.
      ptsRemoveScenario_(ss, record[4]);
      result = saveScenario_(request.actor, request.payload, record[4]);
      if (!result.success) return result;
    } else {
      ptsRemoveScenario_(ss, record[4]);
      logAction_(request.actor.username, 'DELETE_SCENARIO', { id: record[4], userId: request.actor.id });
      result = { success: true, message: 'Skenario berhasil dihapus.' };
    }
    SpreadsheetApp.flush();
    record[5] = 'DONE'; record[6] = JSON.stringify(result);
    ledger.getRange(rowNumber, 1, 1, record.length).setValues([record]);
    SpreadsheetApp.flush();
    return result;
  } catch (_) {
    return { success: false, code: 'RETRY', message: 'Operasi belum selesai. Coba kembali dengan data yang sama.' };
  }
}
