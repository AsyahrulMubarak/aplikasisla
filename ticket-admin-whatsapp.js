// Manual WhatsApp shortcuts for admins.
function bolehChatAdminTiket_(ticket){
 if(!penggunaAktif||!['admin','admin_raha'].includes(rolePengguna())||!dataSesuaiCabangAktif_(ticket))return false;
 const access=String(penggunaAktif.Hak_Akses_Cabang||'').trim().toLowerCase(),branch=String(ticket.Cabang||cabangAktif||'Kendari').trim().toLowerCase();
 return !((access!=='semua'&&access!==branch)||(rolePengguna()==='admin_raha'&&branch!=='raha'));
}
function nomorWATiketAdmin_(value){
 let phone=String(value||'').trim().replace(/[\s().+-]/g,'');
 if(phone.startsWith('0'))phone='62'+phone.slice(1);else if(phone.startsWith('8'))phone='62'+phone;
 return /^62\d{8,13}$/.test(phone)?phone:'';
}
function htmlTombolChatKlienAdmin_(ticket){
 if(!bolehChatAdminTiket_(ticket))return '';
 const phone=nomorWATiketAdmin_(ticket['No WA Klien']);
 if(!phone)return '<button type="button" class="btn-action-primary" disabled title="Lengkapi satu nomor WhatsApp klien melalui Edit Detail.">Chat WA Klien · nomor belum valid</button>';
 return `<a class="btn-action-primary" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-top:5px;">💬 Chat WA Klien</a>`;
}
function htmlTombolChatSalesAdmin_(ticket){
 if(!bolehChatAdminTiket_(ticket))return '';
 const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' '),names=[...new Set(String(ticket.Sales||'').split(/[,;\n\r]/).map(norm).filter(n=>n&&n!=='-'))];
 if(!names.length)return '<button type="button" class="btn-action-primary" disabled>Chat WA Sales · sales belum ditentukan</button>';
 return names.map(name=>{
  const users=(globalUsers||[]).filter(u=>norm(u.Role)==='sales'&&(norm(u['Nama Asli'])===name||norm(u.Username)===name));
  const label=amanTeks_(users.length===1?(users[0]['Nama Asli']||users[0].Username):name);
  const phone=users.length===1?nomorWATiketAdmin_(users[0]['No WA']):'';
  if(!phone)return `<button type="button" class="btn-action-primary" disabled title="Periksa nama dan nomor WhatsApp sales pada profil pegawai.">Chat WA Sales · ${label} · periksa profil</button>`;
  return `<a class="btn-action-primary" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-top:5px;">💬 Chat WA Sales · ${label}</a>`;
 }).join('');
}

function barisRincianNotifTiket_(tiket, labelPekerjaan) {
    const kelengkapan = [];
    const pekerjaan = String(tiket.jenis_pekerjaan ?? '').replace(
        /#[ \t]*kelengkapan[ \t]*[:=][ \t]*([^#\r\n]*)/gi,
        (_, nilai) => {
            if (nilai.trim()) kelengkapan.push(nilai.trim());
            return '';
        }
    ).split(/\r?\n/).map(baris => baris.trim()).filter(Boolean).join('\n');
    const rincian = [
        ['📍 *Cabang:*', tiket.cabang],
        ['🖨️ *Merek Mesin:*', tiket.merk_mesin],
        ['🔢 *Serial Number:*', tiket.serial_number]
    ].flatMap(([label, nilai]) => {
        const isi = String(nilai ?? '').replace(/\s+/g, ' ').trim();
        return isi && isi !== '-' ? [`${label} ${isi}`] : [];
    });
    if (pekerjaan) rincian.push(`🛠️ *${labelPekerjaan}:* ${pekerjaan}`);
    if (kelengkapan.length) rincian.push(`📦 *Kelengkapan:* ${kelengkapan.join(', ')}`);
    return rincian;
}

function pesanWAPendaftaranTiket_(tiket) {
    return [
        "Assalamu'alaikum, Sahabat Alfacom.",
        '',
        'Tiket perbaikan Anda telah terdaftar:',
        `🎫 *ID Tiket:* ${tiket.id_tiket}`,
        ...barisRincianNotifTiket_(tiket, 'Keluhan'),
        '',
        'Pantau progres perbaikan di tautan berikut.',
        `https://aplikasisla.vercel.app/?track=${encodeURIComponent(tiket.id_tiket)}`
    ].join('\n');
}

function pesanWAPenugasanTiket_(tiket, tugasPengganti = false) {
    return [
        tugasPengganti ? '🔄 *TUGAS PENGGANTI*' : '🆕 *TUGAS BARU*',
        '',
        `Bismillah, antum mendapat penugasan untuk tiket *${tiket.id_tiket}*.`,
        '',
        `🏢 *Klien:* ${tiket.klien_lokasi}`,
        ...barisRincianNotifTiket_(tiket, 'Pekerjaan'),
        `💼 *Sales:* ${tiket.sales || 'Tidak ada'}`,
        `⏳ *Target respons:* ${tiket.target_sla_respon_jam} jam kerja`,
        `⏳ *Target pengerjaan:* ${tiket.target_sla_jam} jam kerja`,
        '',
        'Silakan masuk ke aplikasi untuk merespons tiket ini.',
        'https://aplikasisla.vercel.app/'
    ].join('\n');
}
