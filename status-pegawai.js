// Shared, read-only status panels. User-provided values are always text nodes.
function renderStatusPegawai_(target, result, working = false, onOpenTicket = null) {
    target.replaceChildren();
    const rows = Array.isArray(result.data) ? result.data : [];
    const summary = document.createElement('p');
    summary.style.cssText = 'font-size:12px;color:#64748b;margin:0 0 12px;';
    summary.textContent = `${result.cabang} · ${working ? 'Tiket On Progress' : 'Izin dan sakit yang disetujui hari ini'}`;
    target.append(summary);
    if (!rows.length) {
        const empty = document.createElement('p');
        empty.style.cssText = 'font-size:13px;color:#64748b;margin:0;';
        empty.textContent = working ? 'Belum ada teknisi yang mengerjakan tiket On Progress.' : 'Tidak ada pegawai yang sedang izin atau sakit.';
        target.append(empty);
        return;
    }
    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:0;display:grid;gap:10px;';
    for (const row of rows) {
        const item = document.createElement('li');
        item.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc;';
        const name = document.createElement('strong');
        name.style.cssText = 'display:block;font-size:13px;color:#0f172a;';
        name.textContent = row.nama;
        const detail = document.createElement('span');
        detail.style.cssText = 'display:block;font-size:12px;color:#475569;margin-top:5px;overflow-wrap:anywhere;';
        const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(value + 'T12:00:00+08:00').toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Makassar'}) : '-';
        if (working && typeof onOpenTicket === 'function') {
            detail.append(`${row.tiket.length} tiket: `);
            row.tiket.forEach((id, index) => {
                if (index) detail.append(', ');
                const button = document.createElement('button');
                button.type = 'button';
                button.style.cssText = 'background:none;border:0;padding:2px 0;margin:0;font:inherit;color:#2563a9;text-decoration:underline;cursor:pointer;';
                button.textContent = id;
                button.setAttribute('aria-label', `Lihat deskripsi pekerjaan tiket ${id}`);
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try { await onOpenTicket(id, result.cabang); }
                    finally { button.disabled = false; }
                });
                detail.append(button);
            });
        } else {
            detail.textContent = working ? `${row.tiket.length} tiket: ${row.tiket.join(', ')}` : `${row.status} · ${date(row.mulai)}${row.selesai ? ' – ' + date(row.selesai) : ' · sampai kembali bekerja'}`;
        }
        item.append(name, detail);
        list.append(item);
    }
    target.append(list);
}
