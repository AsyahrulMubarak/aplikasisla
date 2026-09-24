function statusProspekMenghentikanReminder_(status) {
  var nilai = String(status || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (nilai === 'proses servis' || nilai === 'proses service') nilai = 'on progress';
  return !nilai || /closing|batal|tanpa keterangan/.test(nilai);
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
