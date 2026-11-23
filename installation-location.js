'use strict';
// Optional per-ticket installation point. GPS is requested only when starting work.
let numeroLokasiPemasangan_=0;
function koordinatPemasangan_(value) {
    const text=String(value??'').trim();
    if (!text) return null;
    const match=text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
    if (!match) throw Error('Koordinat harus berupa latitude, longitude. Contoh: -3.998500, 122.512300.');
    const latitude=Number(match[1]),longitude=Number(match[2]);
    if (Math.abs(latitude)>90 || Math.abs(longitude)>180) throw Error('Latitude harus -90 hingga 90 dan longitude -180 hingga 180.');
    return {latitude,longitude};
}
function titikPemasanganTiket_(ticket) {
    const lat=ticket?.['Latitude Pemasangan'],lng=ticket?.['Longitude Pemasangan'];
    return lat!==null && lat!==undefined && lng!==null && lng!==undefined ? {latitude:Number(lat),longitude:Number(lng)} : null;
}
function pasangKolomLokasiPemasangan_(row,ticket) {
    if (!row || row.querySelector('.input-koordinat-pemasangan')) return;
    const id='lokasi-pemasangan-'+(++numeroLokasiPemasangan_),field=document.createElement('div');
    field.className='installation-location-field';
    field.innerHTML='<label for="'+id+'">Koordinat Lokasi Pemasangan — Opsional</label><input id="'+id+'" class="input-koordinat-pemasangan" type="text" autocomplete="off" spellcheck="false" maxlength="80" placeholder="-3.998500, 122.512300" aria-describedby="'+id+'-help"><small id="'+id+'-help">Salin latitude, longitude dari Google Maps. Jika diisi, teknisi harus berada dalam radius 100 meter untuk beralih ke On Progress. Status lain mengikuti aturan yang berlaku.</small>';
    const point=titikPemasanganTiket_(ticket),input=field.querySelector('input');
    input.value=point ? point.latitude+', '+point.longitude : '';
    input.addEventListener('input',()=>input.setCustomValidity(''));
    row.appendChild(field);
}
function siapkanLokasiPemasanganTiket_() {
    return [...document.querySelectorAll('#wadah-pekerjaan .pekerjaan-item')].filter(row=>row.querySelector('.input-pekerjaan-multi')?.value.trim()).map(row=>{
        const input=row.querySelector('.input-koordinat-pemasangan');
        let point;
        try { point=koordinatPemasangan_(input?.value); } catch(error) { input?.setCustomValidity(error.message);input?.reportValidity();throw error; }
        if (point) return {lokasi_pemasangan_latitude:point.latitude,lokasi_pemasangan_longitude:point.longitude};
        const old=modeEditTiket && (globalTickets||[]).find(t=>t['ID Tiket']===document.getElementById('input-id')?.value);
        return titikPemasanganTiket_(old) ? {lokasi_pemasangan_latitude:null,lokasi_pemasangan_longitude:null} : {};
    });
}
function htmlLokasiPemasanganTiket_(ticket) {
    const p=titikPemasanganTiket_(ticket);
    if (!p) return '';
    return '<p><strong>Lokasi pemasangan:</strong> <a href="https://www.google.com/maps?q='+encodeURIComponent(p.latitude+','+p.longitude)+'" target="_blank" rel="noopener noreferrer">'+p.latitude+', '+p.longitude+'</a> · Radius mulai kerja 100 m</p>';
}
function tampilkanAturanLokasiMulai_(ticket) {
    let note=document.getElementById('update-aturan-lokasi');
    if (!note) {note=document.createElement('p');note.id='update-aturan-lokasi';note.className='installation-location-note';note.setAttribute('role','status');document.getElementById('update-status')?.insertAdjacentElement('afterend',note);}
    const p=titikPemasanganTiket_(ticket),starting=document.getElementById('update-status')?.value==='On Progress' && ticket?.Status!=='On Progress';
    note.hidden=!p;
    note.textContent=p ? (starting ? 'Teknisi perlu mengizinkan lokasi saat menyimpan. On Progress hanya diizinkan dalam radius 100 meter dari '+p.latitude+', '+p.longitude+'.' : 'Tiket ini memiliki titik pemasangan. Radius 100 meter berlaku saat teknisi beralih ke On Progress; status lain mengikuti aturan yang berlaku.') : '';
}
function ambilLokasiMulaiTiket_() {
    return new Promise((resolve,reject)=>{
        if (!navigator.geolocation) return reject(Error('Lokasi perangkat tidak tersedia. Gunakan perangkat dengan GPS untuk memulai pekerjaan.'));
        navigator.geolocation.getCurrentPosition(position=>{
            const {latitude,longitude,accuracy}=position.coords;
            if (![latitude,longitude,accuracy,position.timestamp].every(Number.isFinite) || accuracy<0 || accuracy>100) return reject(Error('Lokasi GPS belum akurat (maksimal 100 meter). Aktifkan lokasi presisi dan coba lagi di lokasi pemasangan.'));
            resolve({latitude,longitude,accuracy,capturedAt:new Date(position.timestamp).toISOString()});
        },error=>reject(Error(error.code===1 ? 'Izin lokasi ditolak. Izinkan lokasi untuk beralih ke On Progress.' : 'Lokasi belum berhasil diperoleh. Aktifkan GPS dan coba lagi.')),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    });
}
document.querySelectorAll('#wadah-pekerjaan .pekerjaan-item').forEach(row=>pasangKolomLokasiPemasangan_(row));
