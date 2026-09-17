        function renderFotoAbsensi_(foto) {
            const aman = nilai => String(nilai || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const dilihat = new Set();
            return (Array.isArray(foto) ? foto : []).map(item => {
                const url = String(item && item.url || '').trim();
                if (!/^https?:\/\/[^\s]+$/i.test(url) || dilihat.has(url)) return '';
                dilihat.add(url);
                const waktu = new Date(item.waktu || '');
                const jam = isNaN(waktu.getTime()) ? '' : ' · ' + String(waktu.getHours()).padStart(2, '0') + ':' + String(waktu.getMinutes()).padStart(2, '0');
                const label = 'Lihat Foto ' + String(item.tipe || 'Absen') + jam;
                return '<a href="' + aman(url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block; margin:6px 6px 0 0; padding:6px 9px; border:1px solid #bfdbfe; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-size:11px; font-weight:600; text-decoration:none;">📷 ' + aman(label) + '</a>';
            }).join('');
        }
