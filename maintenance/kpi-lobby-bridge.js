        const KPI_APP_URL = 'https://alfacomapp.github.io/alfacom-kpi/';
        const KPI_APP_ORIGIN = 'https://alfacomapp.github.io';
        const KPI_WORKER_URL = 'https://alfacom-kpi.alfacomapp.workers.dev';

        function penggunaBolehMengaksesKpi_() {
            const role = String(penggunaAktif && penggunaAktif.Role || '').trim().toLowerCase();
            const cabang = String(penggunaAktif && penggunaAktif.Hak_Akses_Cabang || '').trim().toLowerCase();
            return ['direktur', 'manager', 'admin_raha'].includes(role) || (role === 'admin' && ['', 'semua', 'kendari', 'raha'].includes(cabang));
        }

        async function bukaAplikasiKpi() {
            if (!punyaAksesLobby() || !penggunaBolehMengaksesKpi_()) {
                showToast('Akses KPI khusus Direktur, Manager, Admin Kendari, dan Admin Raha.', 'warning');
                return;
            }
            const tombol = document.getElementById('btn-lobby-kpi');
            const status = document.getElementById('main-lobby-status');
            const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
            const tabKpi = window.open(KPI_APP_URL + '#sla-handoff=' + nonce, '_blank');
            if (!tabKpi) { showToast('Izinkan pop-up untuk membuka Aplikasi KPI.', 'warning'); return; }
            tombol.disabled = true;
            status.innerText = 'Menghubungkan sesi ke Aplikasi KPI...';
            let tokenKpi = '', siap = false, terkirim = false, timer, listener;
            const controller = new AbortController();
            const kirimSesi = () => {
                if (!siap || !tokenKpi || terkirim || tabKpi.closed) return;
                terkirim = true;
                tabKpi.postMessage({ type: 'sla:kpi-session', nonce: nonce, token: tokenKpi }, KPI_APP_ORIGIN);
            };
            const selesai = new Promise((resolve, reject) => {
                listener = event => {
                    if (event.origin !== KPI_APP_ORIGIN || event.source !== tabKpi || !event.data || event.data.nonce !== nonce) return;
                    if (event.data.type === 'kpi:sla-ready') { siap = true; kirimSesi(); }
                    if (event.data.type === 'kpi:sla-accepted' && terkirim) resolve();
                    if (event.data.type === 'kpi:sla-error') reject(new Error('Sesi KPI tidak dapat dibuka. Silakan coba lagi.'));
                };
                window.addEventListener('message', listener);
                timer = setTimeout(() => { controller.abort(); reject(new Error('Koneksi KPI melewati batas waktu. Silakan coba lagi.')); }, 90000);
            });
            // Pasang penanganan langsung agar timeout selama autentikasi tidak menjadi rejection tanpa handler.
            selesai.catch(() => {});
            try {
                await pastikanTokenSupabaseAktif_();
                const response = await fetch(KPI_WORKER_URL, {
                    signal: controller.signal,
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'apiLoginSla', args: [penggunaAktif.SessionToken] })
                });
                const result = await response.json();
                if (!response.ok || !result || !result.ok || typeof result.token !== 'string' || !result.token) throw new Error(result && result.message || 'Login KPI belum berhasil.');
                tokenKpi = result.token;
                kirimSesi();
                await selesai;
                status.innerText = 'Aplikasi KPI sudah dibuka sesuai hak akses Anda.';
            } catch (error) {
                status.innerText = error && error.message || 'Gagal membuka Aplikasi KPI.';
                showToast(status.innerText, 'error');
                if (!tabKpi.closed) tabKpi.close();
            } finally {
                tokenKpi = '';
                clearTimeout(timer);
                window.removeEventListener('message', listener);
                tombol.disabled = false;
            }
        }
