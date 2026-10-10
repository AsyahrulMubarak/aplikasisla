        function kunciNamaPekerjaanTeknisi_(nama) {
            const key = String(nama || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
            return key === 'syawal' ? 'muhammad syawal' : key;
        }

        function rekapPekerjaanTeknisi_(tickets, users, bulan, tahun) {
            const periodFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit' });
            const current = periodFormat.format(new Date()).split('-');
            const month = bulan === 'all' ? 'all' : String(Number(bulan) >= 1 && Number(bulan) <= 12 ? Number(bulan) : Number(current[1])).padStart(2, '0');
            const year = Number(tahun) > 0 && Number(tahun) <= 9999 ? Number(tahun) : Number(current[0]);
            const labelPeriode = month === 'all' ? 'Semua periode' : new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', month: 'long', year: 'numeric' }).format(new Date(`${year}-${month}-01T00:00:00+08:00`));
            const rows = new Map(), seen = new Set();
            const ensure = name => {
                const key = kunciNamaPekerjaanTeknisi_(name);
                if (!rows.has(key)) rows.set(key, { nama: key === 'muhammad syawal' ? 'Muhammad Syawal' : String(name).trim().replace(/\s+/g, ' '), solo: 0, tim: 0, total: 0 });
                return rows.get(key);
            };
            (users || []).filter(user => user && dataSesuaiCabangAktif_(user)).forEach(user => {
                if (rolePengguna(user) === 'teknisi' && user['Nama Asli']) ensure(user['Nama Asli']);
            });
            let totalSelesai = 0;
            (tickets || []).filter(ticket => ticket && dataSesuaiCabangAktif_(ticket)).forEach(ticket => {
                const id = String(ticket['ID Tiket'] || '').trim();
                if (!id || id.startsWith('SLS-') || String(ticket.Status || '').trim().toLowerCase() !== 'selesai' || !ticket['Waktu Selesai']) return;
                const date = parseSafeDate(ticket['Waktu Selesai']);
                if (Number.isNaN(date.getTime())) return;
                const period = periodFormat.format(date);
                if (month !== 'all' && period !== `${year}-${month}`) return;
                const uniqueId = (normalisasiCabang(ticket.Cabang) || 'Kendari') + '|' + id;
                if (seen.has(uniqueId)) return;
                seen.add(uniqueId);
                totalSelesai++;
                const displayNames = new Map(daftarTeknisiUnikTiket_(ticket.Teknisi).map(name => [kunciNamaPekerjaanTeknisi_(name), name]));
                const members = [...displayNames.keys()].filter(key => key && !['-', 'belum ditugaskan'].includes(key));
                members.forEach(key => {
                    const row = ensure(displayNames.get(key));
                    if (members.length === 1) row.solo++; else row.tim++;
                    row.total++;
                });
            });
            const teknisi = [...rows.values()].sort((a, b) => a.total - b.total || a.nama.localeCompare(b.nama, 'id-ID'));
            return { totalSelesai, teknisi, labelPeriode, totalKeterlibatan: teknisi.reduce((total, row) => total + row.total, 0) };
        }

        function buatHtmlDiagramPekerjaanTeknisi_(nama, rekap) {
            const summary = rekap || { totalSelesai: 0, teknisi: [], labelPeriode: 'Periode terpilih' };
            const own = summary.teknisi.find(row => kunciNamaPekerjaanTeknisi_(row.nama) === kunciNamaPekerjaanTeknisi_(nama)) || { solo: 0, tim: 0 };
            const total = summary.totalSelesai;
            const chart = (title, count, color, kind) => {
                const percent = total > 0 ? Math.round(count / total * 1000) / 10 : 0;
                const background = total > 0 ? `conic-gradient(${color} 0% ${percent}%, #e2e8f0 ${percent}% 100%)` : '#cbd5e1';
                const description = `${title}: ${count} dari ${total} tiket selesai, ${percent}%`;
                return `<div class="chart-box technician-work-chart" data-work-kind="${kind}">
                    <div class="chart-title">${title}</div>
                    <div class="donut" role="img" aria-label="${amanTeks_(description)}" style="background:${background};"><div class="donut-inner"><span class="donut-val" style="color:${color};">${total > 0 ? percent.toLocaleString('id-ID') + '%' : '—'}</span><span class="donut-label">Dari total selesai</span></div></div>
                    <div class="chart-legend"><div class="legend-item"><span><span class="legend-dot" style="background:${color};"></span>${kind === 'solo' ? 'Selesai sendiri' : 'Selesai bersama tim'}</span><b>${count}</b></div><div class="legend-item"><span><span class="legend-dot" style="background:#e2e8f0;"></span>Tiket selesai lainnya</span><b>${Math.max(0, total - count)}</b></div></div>
                    <p class="work-chart-caption">${count} dari ${total} tiket selesai · ${amanTeks_(summary.labelPeriode)}</p>
                    ${total === 0 ? '<p class="work-chart-empty">Belum ada tiket selesai pada periode ini.</p>' : ''}
                </div>`;
            };
            return '<div class="charts-container technician-work-charts">' + chart('PEKERJAAN SOLO', own.solo, 'var(--primary)', 'solo') + chart('PEKERJAAN TIM', own.tim, 'var(--purple)', 'tim') + '</div>';
        }

        function buatHtmlDiagramPerbandinganTeknisi_(rekap) {
            const summary = rekap || { totalSelesai: 0, teknisi: [], labelPeriode: 'Periode terpilih', totalKeterlibatan: 0 };
            const rows = [...summary.teknisi].sort((a, b) => a.total - b.total || a.nama.localeCompare(b.nama, 'id-ID'));
            const palette = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#e11d48', '#0891b2', '#4f46e5', '#0d9488'];
            const names = rows.map(row => row.nama).sort((a, b) => a.localeCompare(b, 'id-ID'));
            const color = row => row.total === 0 ? '#cbd5e1' : palette[names.indexOf(row.nama) % palette.length];
            let offset = 0;
            const segments = rows.filter(row => row.total > 0).map(row => {
                const start = offset;
                offset += row.total / summary.totalKeterlibatan * 100;
                return `${color(row)} ${start}% ${offset}%`;
            });
            const background = segments.length ? `conic-gradient(${segments.join(', ')})` : '#cbd5e1';
            return `<div class="card team-work-card">
                <h3 class="team-work-title">Jumlah Tiket Selesai per Teknisi</h3>
                <p class="work-chart-caption">${amanTeks_(summary.labelPeriode)} · ${summary.totalSelesai} tiket selesai pada cabang ini</p>
                <div class="team-work-chart">
                    <div class="donut" role="img" aria-label="${amanTeks_('Jumlah pekerjaan solo dan tim: ' + rows.map(row => row.nama + ' ' + row.total + ' tiket').join(', '))}" style="background:${background};"><div class="donut-inner"><span class="donut-val">${summary.totalKeterlibatan}</span><span class="donut-label">Keterlibatan</span></div></div>
                    <ol class="team-work-legend">${rows.map(row => `<li><div class="team-work-name"><span class="legend-dot" style="background:${color(row)};"></span><div><strong>${amanTeks_(row.nama)}</strong><small>Solo ${row.solo} · Tim ${row.tim}</small></div></div><b>${row.total} tiket</b></li>`).join('')}</ol>
                </div>
                ${summary.totalSelesai === 0 ? '<p class="work-chart-empty">Belum ada tiket selesai pada periode ini.</p>' : ''}
                <p class="work-chart-caption">Urutan dari jumlah paling sedikit ke paling banyak. Satu tiket tim dihitung sekali untuk setiap teknisi anggotanya.</p>
            </div>`;
        }
