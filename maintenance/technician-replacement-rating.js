        function namaTeknisiPenggantian_(value) {
            const names = new Map();
            daftarTeknisiUnikTiket_(value).forEach(name => {
                const key = kunciNamaPekerjaanTeknisi_(name);
                if (key && !['-', 'belum ditugaskan'].includes(key)) names.set(key, key === 'muhammad syawal' ? 'Muhammad Syawal' : name.trim().replace(/\s+/g, ' '));
            });
            return names;
        }

        function tanggalCatatanPenggantian_(value) {
            const text = String(value || '').trim();
            let parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2})[.:](\d{2})[.:](\d{2})$/);
            if (parts) parts = [parts[3], parts[2], parts[1], parts[4], parts[5], parts[6]];
            else {
                const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
                if (!iso) return null;
                parts = iso.slice(1);
            }
            const [year, month, day, hour, minute, second] = parts.map(Number);
            if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
            const dateText = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const date = new Date(`${dateText}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`);
            if (Number.isNaN(date.getTime()) || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) !== dateText) return null;
            return date.toISOString();
        }

        function riwayatPenggantianTeknisi_(ticket) {
            // An array is the server's authoritative journal, including an empty one.
            if (Array.isArray(ticket['Riwayat Penggantian Teknisi'])) return ticket['Riwayat Penggantian Teknisi'];
            const events = [], text = String(ticket.Keterangan || '');
            const pattern = /\[([^\]\r\n]+)\][^\r\n]*PERGANTIAN TEKNISI[\r\n]+Dari: ([^\r\n]*)[\r\n]+Ke: ([^\r\n]*)/g;
            for (const match of text.matchAll(pattern)) events.push({ waktu: tanggalCatatanPenggantian_(match[1]), dari: match[2].trim(), ke: match[3].trim(), sumber: 'catatan_lama' });
            if (!events.length && namaTeknisiPenggantian_(ticket['Teknisi Sebelumnya']).size) events.push({ waktu: null, dari: ticket['Teknisi Sebelumnya'], ke: ticket.Teknisi, sumber: 'metadata_lama' });
            return events;
        }

        function rekapPenggantianTeknisi_(tickets, bulan, tahun) {
            const periodFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit' });
            const current = periodFormat.format(new Date()).split('-');
            const month = bulan === 'all' ? 'all' : String(Number(bulan) >= 1 && Number(bulan) <= 12 ? Number(bulan) : Number(current[1])).padStart(2, '0');
            const year = Number(tahun) > 0 ? Number(tahun) : Number(current[0]);
            const rows = new Map(), seen = new Set();
            (tickets || []).filter(ticket => ticket && dataSesuaiCabangAktif_(ticket)).forEach(ticket => {
                const id = String(ticket['ID Tiket'] || '').trim();
                if (!id || id.startsWith('SLS-')) return;
                const uniqueId = (normalisasiCabang(ticket.Cabang) || 'Kendari') + '|' + id;
                if (seen.has(uniqueId)) return;
                seen.add(uniqueId);
                riwayatPenggantianTeknisi_(ticket).forEach(event => {
                    if (!event || typeof event !== 'object') return;
                    const before = namaTeknisiPenggantian_(event.dari), after = namaTeknisiPenggantian_(event.ke);
                    const date = event.waktu ? parseSafeDate(event.waktu) : new Date(NaN);
                    const dated = !Number.isNaN(date.getTime());
                    before.forEach((name, key) => {
                        if (after.has(key)) return;
                        if (dated && month !== 'all' && periodFormat.format(date) !== `${year}-${month}`) return;
                        if (!rows.has(key)) rows.set(key, { nama: name, jumlah: 0, tiket: new Set(), tanpaTanggal: 0 });
                        const row = rows.get(key);
                        if (!dated) row.tanpaTanggal++;
                        if (dated || month === 'all') { row.jumlah++; row.tiket.add(uniqueId); }
                    });
                });
            });
            return [...rows.values()].map(row => ({ ...row, tiket: row.tiket.size }));
        }
