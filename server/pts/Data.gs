// PTS business storage adapted from kodepts.txt; separate Apps Script project only.
function ensureSheetHeaders_(sheet, headers) {
  if (!sheet) return;
  var lastColumn = sheet.getLastColumn();
  var existing = sheet.getRange(1, 1, 1, Math.min(lastColumn, headers.length)).getValues()[0];
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i]) !== headers[i]) throw new Error('Struktur sheet PTS tidak cocok.');
  }
  if (lastColumn >= headers.length) return;

  var missingHeaders = headers.slice(lastColumn);
  sheet.getRange(1, lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
}

// === DATABASE SETUP ===
function setupDatabase_() {
  var ss = ptsSpreadsheet_();
  
  // PTS data only. Portal users are never created or modified here.
  // Sheet TargetScenarios
  var scenarioHeaders = [
    'ID', 'Title', 'Opex', 'Salary', 'Reserve', 'Profit',
    'HppPct', 'MarketingCount', 'SalesRatio', 'TotalSales',
    'SalesTarget', 'PerMarketingTarget', 'WalkinTarget', 'CreatedBy', 'CreatedAt',
    'OpexPct', 'ProfitPct', 'FixedCostPct'
  ];
  var scenarioSheet = ss.getSheetByName('TargetScenarios');
  if (!scenarioSheet) {
    scenarioSheet = ss.insertSheet('TargetScenarios');
    scenarioSheet.appendRow(scenarioHeaders);
  } else {
    ensureSheetHeaders_(scenarioSheet, scenarioHeaders);
  }

  // 3. Sheet TargetSalesAllocations
  var allocationSheet = ss.getSheetByName('TargetSalesAllocations');
  if (!allocationSheet) {
    allocationSheet = ss.insertSheet('TargetSalesAllocations');
    allocationSheet.appendRow([
      'ScenarioID', 'ScenarioTitle', 'SalesNo', 'SalesName', 'TargetSales',
      'AssignmentMode', 'TotalSalesTarget', 'AssignedSalesTarget',
      'RemainingSalesTarget', 'CreatedBy', 'CreatedAt'
    ]);
  }

  // 4. Sheet SalesRealizations
  var realizationSheet = ss.getSheetByName('SalesRealizations');
  if (!realizationSheet) {
    realizationSheet = ss.insertSheet('SalesRealizations');
    realizationSheet.appendRow([
      'ScenarioID', 'ScenarioTitle', 'RowNo', 'SalesNo', 'SalesName',
      'TargetSales', 'RealisasiOmset', 'AchievementPct', 'SurplusOmset',
      'DeficitOmset', 'Status', 'BonusLevel', 'BonusBreakdown',
      'BonusAmount', 'CreatedBy', 'CreatedAt'
    ]);
  }

  // 5. Sheet CommissionSummary
  var summarySheet = ss.getSheetByName('CommissionSummary');
  if (!summarySheet) {
    summarySheet = ss.insertSheet('CommissionSummary');
    summarySheet.appendRow([
      'ScenarioID', 'ScenarioTitle', 'TotalTargetTeam', 'TotalRealisasiTeam',
      'MarginPct', 'MarginKotorDidapat', 'TotalBonusDibayar',
      'SisaMarginPerusahaan', 'CreatedBy', 'CreatedAt'
    ]);
  }

  // 6. Sheet AuditLog
  var logSheet = ss.getSheetByName('AuditLog');
  if (!logSheet) {
    logSheet = ss.insertSheet('AuditLog');
    logSheet.appendRow(['Timestamp', 'Username', 'Action', 'Details']);
  }

  return { success: true, message: 'Database berhasil disiapkan.' };
}


// === TARGET SCENARIOS CRUD API ===
function getScenarios_(actor) {
  var session = actor;

  try {
    var ss = ptsSpreadsheet_();
    var sheet = ss.getSheetByName('TargetScenarios');
    if (!sheet) return { success: true, data: [] };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    var rows = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
    var result = [];

    for (var i = rows.length - 1; i >= 0; i--) {
      result.push({
        id: String(rows[i][0]),
        title: String(rows[i][1]),
        opex: Number(rows[i][2]),
        salary: Number(rows[i][3]),
        reserve: Number(rows[i][4]),
        profit: Number(rows[i][5]),
        hppPct: Number(rows[i][6]),
        marketingCount: Number(rows[i][7]),
        salesRatio: Number(rows[i][8]),
        totalSales: Number(rows[i][9]),
        salesTarget: Number(rows[i][10]),
        perMarketingTarget: Number(rows[i][11]),
        walkinTarget: Number(rows[i][12]),
        createdBy: String(rows[i][13]),
        createdAt: String(rows[i][14]),
        opexPct: Number(rows[i][15]),
        profitPct: Number(rows[i][16]),
        fixedCostPct: Number(rows[i][17])
      });
    }

    return { success: true, data: result };
  } catch(e) {
    return { success: false, code: 'RETRY', message: 'Riwayat PTS belum dapat dibaca. Silakan coba kembali.' };
  }
}

function saveScenario_(actor, payload, scenarioId) {
  var session = actor;

  try {
    
    var ss = ptsSpreadsheet_();
    setupDatabase_();
    var sheet = ss.getSheetByName('TargetScenarios');
    if (!sheet) return { success: false, message: 'Sheet TargetScenarios tidak ditemukan.' };
    var allocationSheet = ss.getSheetByName('TargetSalesAllocations');
    var realizationSheet = ss.getSheetByName('SalesRealizations');
    var summarySheet = ss.getSheetByName('CommissionSummary');

    var newId = scenarioId;
    var title = sanitizeInput_(payload.title || 'Skenario Tanpa Judul');
    var nowStr = safeDateFormat_(new Date());
    var totalSalesTarget = Number(payload.salesTarget || 0);
    var assignedSalesTarget = Number(payload.assignedSalesTarget || 0);
    var remainingSalesTarget = Number(payload.remainingSalesTarget || 0);

    sheet.appendRow([
      newId,
      title,
      Number(payload.opex || 0),
      Number(payload.salary || 0),
      Number(payload.reserve || 0),
      Number(payload.profit || 0),
      Number(payload.hppPct || 0),
      Number(payload.marketingCount || 0),
      Number(payload.salesRatio || 0),
      Number(payload.totalSales || 0),
      Number(payload.salesTarget || 0),
      Number(payload.perMarketingTarget || 0),
      Number(payload.walkinTarget || 0),
      sanitizeInput_(session.username),
      nowStr,
      Number(payload.opexPct || 0),
      Number(payload.profitPct || 0),
      Number(payload.fixedCostPct || 0)
    ]);

    var allocations = Array.isArray(payload.salesTargetAllocation) ? payload.salesTargetAllocation : [];
    if (allocationSheet && allocations.length) {
      var allocationRows = allocations.map(function(item, index) {
        return [
          newId,
          title,
          Number(item.salesNo || index + 1),
          sanitizeInput_(String(item.name || 'Sales ' + (index + 1))),
          Number(item.target || 0),
          item.isManual ? 'Manual' : 'Otomatis',
          totalSalesTarget,
          assignedSalesTarget,
          remainingSalesTarget,
          sanitizeInput_(session.username),
          nowStr
        ];
      });
      allocationSheet.getRange(allocationSheet.getLastRow() + 1, 1, allocationRows.length, allocationRows[0].length).setValues(allocationRows);
    }

    var realizations = Array.isArray(payload.salesRealizations) ? payload.salesRealizations : [];
    if (realizationSheet && realizations.length) {
      var realizationRows = realizations.map(function(item, index) {
        return [
          newId,
          title,
          Number(item.rowNo || index + 1),
          Number(item.salesNo || 0),
          sanitizeInput_(String(item.name || '')),
          Number(item.target || 0),
          Number(item.realisasi || 0),
          Number(item.achievementPct || 0),
          Number(item.surplus || 0),
          Number(item.deficit || 0),
          sanitizeInput_(String(item.status || '')),
          sanitizeInput_(String(item.bonusLevel || '')),
          sanitizeInput_(String(item.bonusBreakdown || '')),
          Number(item.bonus || 0),
          sanitizeInput_(session.username),
          nowStr
        ];
      });
      realizationSheet.getRange(realizationSheet.getLastRow() + 1, 1, realizationRows.length, realizationRows[0].length).setValues(realizationRows);
    }

    if (summarySheet && payload.commissionSummary) {
      summarySheet.appendRow([
        newId,
        title,
        Number(payload.commissionSummary.totalTargetTeam || 0),
        Number(payload.commissionSummary.totalReal || 0),
        Number(payload.commissionSummary.marginPct || 0),
        Number(payload.commissionSummary.totalMarginGot || 0),
        Number(payload.commissionSummary.totalBonus || 0),
        Number(payload.commissionSummary.netCompany || 0),
        sanitizeInput_(session.username),
        nowStr
      ]);
    }

    logAction_(session.username, 'SAVE_SCENARIO', { id: newId, title: title });
    return { success: true, message: 'Skenario berhasil disimpan.' };

  } catch(e) {
    return { success: false, code: 'RETRY', message: 'Simpan belum selesai. Coba kembali dengan data yang sama.' };
  }
}

function deleteScenario_(actor, scenarioId) {
  var session = actor;

  try {
    var ss = ptsSpreadsheet_();
    var sheet = ss.getSheetByName('TargetScenarios');
    if (!sheet) return { success: false, message: 'Sheet tidak ditemukan.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: 'Skenario tidak ditemukan.' };

    var rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var rowIndex = -1;

    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(scenarioId)) {
        rowIndex = i + 2; // Header is row 1
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, message: 'Skenario tidak ditemukan.' };
    }

    sheet.deleteRow(rowIndex);
    deleteRowsByScenarioId_(ss.getSheetByName('TargetSalesAllocations'), scenarioId);
    deleteRowsByScenarioId_(ss.getSheetByName('SalesRealizations'), scenarioId);
    deleteRowsByScenarioId_(ss.getSheetByName('CommissionSummary'), scenarioId);
    logAction_(session.username, 'DELETE_SCENARIO', { id: scenarioId });

    return { success: true, message: 'Skenario berhasil dihapus.' };
  } catch(e) {
    return { success: false, code: 'RETRY', message: 'Hapus belum selesai. Silakan coba kembali.' };
  }
}

function deleteRowsByScenarioId_(sheet, scenarioId) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(scenarioId)) {
      sheet.deleteRow(i + 2);
    }
  }
}
