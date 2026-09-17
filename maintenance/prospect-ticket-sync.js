        function statusProspekDariStatusTiket_(status) {
            return ({'on progress':'On Progress', 'pending':'Pending', 'selesai':'Closing / Deal', 'closed':'Closing / Deal', 'cancel':'Batal', 'batal':'Batal'})[String(status || '').trim().toLowerCase()] || '';
        }

        function pilihProspekUntukTiket_(daftar, tiket) {
            const norm = nilai => String(nilai || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const sales = nilai => [...new Set(String(nilai || '').split(',').map(norm).filter(Boolean))].sort().join('|');
            const wa = normalisasiWASementara_(tiket.no_wa_klien);
            const cabang = norm(tiket.cabang);
            const waktuTiket = new Date(tiket.waktu_lapor).getTime();
            const nama = norm(tiket.klien_lokasi);
            const penanggung = sales(tiket.sales);
            if (!/^628\d{7,12}$/.test(wa) || !['kendari','raha'].includes(cabang) || !Number.isFinite(waktuTiket)) return { data: [], ambigu: false };
            const unik = new Map();
            (Array.isArray(daftar) ? daftar : []).forEach(p => {
                if (!p || !/^[A-Za-z0-9_-]+$/.test(String(p.id_prospek || ''))) return;
                if (norm(p.cabang) !== cabang || normalisasiWASementara_(p.no_wa) !== wa) return;
                if (!['tahap penawaran','kunjungan toko','on progress','pending','proses servis'].includes(norm(p.status_prospek))) return;
                const dibuat = new Date(p.tanggal_input).getTime();
                if (!Number.isFinite(dibuat) || dibuat > waktuTiket) return;
                // Nama panggilan boleh berbeda hanya jika WA, cabang, dan seluruh sales cocok.
                if (penanggung ? sales(p.sales_penanggung_jawab) !== penanggung : (!nama || norm(p.nama_calon_customer) !== nama)) return;
                unik.set(String(p.id_prospek), p);
            });
            const kandidat = [...unik.values()];
            const namaSama = kandidat.filter(p => nama && norm(p.nama_calon_customer) === nama);
            const pilihan = namaSama.length ? namaSama : kandidat;
            return { data: pilihan.length === 1 ? pilihan : [], ambigu: pilihan.length > 1 };
        }

        async function sinkronkanStatusProspekDariTiket_(statusTiket, noWaCustomer, namaCustomer, konteksTiket) {
            const konteks = konteksTiket || {};
            const id = String(konteks['ID Tiket'] || konteks.id_tiket || '').trim();
            const cabang = normalisasiCabang(konteks.Cabang || konteks.cabang || cabangAktif);
            const kosong = { ditemukan: 0, diperbarui: 0, status: '', notifTerkirim: 0, notifGagal: 0 };
            if (!/^[A-Za-z0-9_-]+$/.test(id) || !['Kendari','Raha'].includes(cabang)) return kosong;
            // Ambil identitas dan status terbaru dari tiket tersimpan, bukan label tampilan lama.
            const rows = await callSupabase('tiket?id_tiket=eq.' + encodeURIComponent(id) + '&cabang=eq.' + encodeURIComponent(cabang) + '&select=id_tiket,no_wa_klien,klien_lokasi,sales,cabang,waktu_lapor,status');
            if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0].id_tiket) !== id || normalisasiCabang(rows[0].cabang) !== cabang) return kosong;
            const tiket = rows[0];
            const tujuan = statusProspekDariStatusTiket_(tiket.status);
            if (!tujuan) return kosong;
            const daftar = await callSupabase('prospek?cabang=eq.' + encodeURIComponent(cabang) + '&select=id_prospek,no_wa,nama_calon_customer,status_prospek,sales_penanggung_jawab,cabang,tanggal_input');
            if (!Array.isArray(daftar)) throw new Error('Respons pencarian Prospek tidak valid.');
            const pilihan = pilihProspekUntukTiket_(daftar, tiket);
            const result = { ...kosong, ditemukan: pilihan.data.length, status: tujuan, ambigu: pilihan.ambigu };
            for (const p of pilihan.data) {
                if (String(p.status_prospek).trim().toLowerCase() === tujuan.toLowerCase()) continue;
                const endpoint = endpointFilterSupabase_('prospek', 'id_prospek', p.id_prospek) + '&cabang=eq.' + encodeURIComponent(cabang) + '&status_prospek=eq.' + encodeURIComponent(p.status_prospek);
                const updated = await callSupabase(endpoint, 'PATCH', { status_prospek: tujuan });
                // Perubahan manual yang mendahului PATCH tidak ditimpa dan tidak memicu WA.
                if (Array.isArray(updated) && updated.length === 0) continue;
                pastikanHasilMutasiSupabase_(updated, 'Prospek ' + p.id_prospek);
                result.diperbarui++;
                const lokal = (globalProspek || []).find(item => String(item['ID Prospek']) === String(p.id_prospek));
                if (lokal) lokal['Status Prospek'] = tujuan;
                const pesan = `⚠️ *UPDATE PROSPEK OTOMATIS*\n\nProspek *${p.nama_calon_customer}* kini berstatus *${tujuan}*, mengikuti tiket *${id}*.\n\nSilakan lihat perkembangannya pada aplikasi SLA.`;
                const notif = await kirimNotifWAInternal(p.sales_penanggung_jawab, pesan);
                const terkirim = Number(notif && notif.terkirim) || 0;
                result.notifTerkirim += terkirim;
                result.notifGagal += (Number(notif && notif.gagal) || 0) + (!terkirim && !(notif && notif.gagal) ? 1 : 0);
            }
            return result;
        }
