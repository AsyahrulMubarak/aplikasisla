'use strict';
// Optional device identity. Lookup never sends messages or creates a claim.
const serialPerangkatUI_ = { rows:new WeakMap(), claim:null, nextId:0, autofill:null, scanner:null };
function normalisasiSerial_(value) { return String(value || '').trim().toUpperCase(); }
function konteksSerial_() {
    return [String(cabangAktif || ''), typeof penggunaAktif==='undefined' ? '' : [penggunaAktif?.Username,penggunaAktif?.Role].join(':'), modeEditTiket ? document.getElementById('input-id').value : ''].join('|');
}
function waktuSerial_(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) return 'Belum ditentukan';
    return new Date(value).toLocaleString('id-ID', { timeZone:'Asia/Makassar', dateStyle:'medium', timeStyle:'short' }) + ' WITA';
}
function htmlSerialTiket_(ticket) {
    const brand=ticket['Merek Mesin'] ? '<p><strong>Merek mesin:</strong> '+amanTeks_(ticket['Merek Mesin'])+'</p>' : '';
    if (!ticket['Serial Number']) return brand;
    const unchecked=ticket['Pemeriksaan Serial']?.status==='belum_terverifikasi';
    return brand+'<p><strong>SN:</strong> '+amanTeks_(ticket['Serial Number'])+(unchecked ? ' · Riwayat belum terverifikasi' : '')+'</p>';
}
function pasangKolomSerial_(row, ticket) {
    if (!row || row.querySelector('.input-serial-number')) return;
    const id = 'serial-perangkat-' + (++serialPerangkatUI_.nextId);
    const field = document.createElement('div');
    field.className = 'serial-field';
    field.innerHTML = '<div class="serial-identity"><div><label for="'+id+'">Serial number perangkat</label>' +
        '<div class="serial-input-actions"><input id="'+id+'" class="input-serial-number" type="text" maxlength="120" autocomplete="off" spellcheck="false" placeholder="Contoh: X8K123456" aria-describedby="'+id+'-help">' +
        '<button type="button" class="btn-action-primary serial-scan">Scan barcode</button></div></div>' +
        '<div><label for="'+id+'-brand">Merek mesin</label><input id="'+id+'-brand" class="input-merk-mesin" type="text" maxlength="80" placeholder="Contoh: Epson"></div></div>' +
        '<small class="serial-help" id="'+id+'-help">Scan label SN atau ketik nomornya. Jika cocok, data pelanggan dan merek yang tersedia akan terisi.</small>' +
        '<div class="serial-autofill" aria-live="polite" hidden></div>' +
        '<div class="serial-result" aria-live="polite" hidden></div>';
    row.appendChild(field);
    const input = field.querySelector('.input-serial-number');
    const brand = field.querySelector('.input-merk-mesin');
    input.value = ticket?.['Serial Number'] || '';
    brand.value = ticket?.['Merek Mesin'] || '';
    const state = { input, brand, field, result:field.querySelector('.serial-result'), notice:field.querySelector('.serial-autofill'), original:normalisasiSerial_(input.value), originalBrand:brand.value.trim(), version:0, timer:null, controller:null, data:null, key:'', promise:null, reason:'' };
    serialPerangkatUI_.rows.set(row, state);
    input.addEventListener('input', () => {
        clearTimeout(state.timer); state.controller?.abort(); state.version++;
        if (state.autofillBrand && state.autofillBrand.sn!==normalisasiSerial_(input.value)) {
            if (brand.value===state.autofillBrand.value) brand.value='';
            state.autofillBrand=null;
        }
        if (serialPerangkatUI_.autofill?.row===row && serialPerangkatUI_.autofill.sn!==normalisasiSerial_(input.value)) bersihkanAutofillSerial_(row);
        state.notice.hidden=true;
        state.data=null; state.key=''; state.reason='';
        state.result.hidden=!normalisasiSerial_(input.value);
        state.result.textContent='Menunggu pemeriksaan SN…';
        if (normalisasiSerial_(input.value)) state.timer=setTimeout(() => periksaSerial_(row), 550);
    });
    input.addEventListener('keydown', event => {
        if (event.key!=='Enter' || event.isComposing) return;
        event.preventDefault();
        input.value=normalisasiSerial_(input.value);
        periksaSerial_(row);
    });
    input.addEventListener('blur', () => { input.value=normalisasiSerial_(input.value); periksaSerial_(row); });
    field.querySelector('.serial-scan').addEventListener('click', () => pindaiBarcodeSerial_(row));
    if (input.value) periksaSerial_(row);
}
function bersihkanAutofillSerial_(row) {
    const previous=serialPerangkatUI_.autofill;
    if (previous?.row!==row) return;
    for (const [field,value] of previous.fields) if (field.value===value) field.value='';
    serialPerangkatUI_.autofill=null;
    tampilkanInfoKlienCRM_(document.getElementById('input-wa-klien')?.value || '');
}
document.getElementById('wadah-pekerjaan')?.addEventListener('click', event => {
    const row=event.target.closest('.btn-del')?.closest('.pekerjaan-item');
    if (row) bersihkanAutofillSerial_(row);
},true);
document.getElementById('form-sla')?.addEventListener('reset',()=>{serialPerangkatUI_.autofill=null;hentikanPindaiBarcodeSerial_();});
function isiDataDariSerial_(row, data, sn) {
    const state=serialPerangkatUI_.rows.get(row);
    state.notice.hidden=false;
    if (!data || normalisasiSerial_(data.serial_number)!==sn) {
        state.notice.textContent='Data pelanggan dari SN ini belum ditemukan di cabang aktif. Isi data secara manual.';
        return;
    }

    state.input.value=sn;
    const fields=[];
    const name=document.getElementById('input-klien');
    const phone=document.getElementById('input-wa-klien');
    const phoneKey=value => String(value || '').replace(/\D/g,'').replace(/^0062/,'62').replace(/^0/,'62').replace(/^8/,'628');
    const pairs=[[name,data.nama,value=>String(value || '').trim().toLowerCase()],[phone,data.kontak,phoneKey]];
    if (!modeEditTiket) {
        // Multiple machines share one customer. Keep manually entered data or
        // the customer of the first device if a different customer is found.
        const conflict=pairs.some(([field,value,key]) => value && field?.value.trim() && key(field.value)!==key(value));
        if (!conflict) {
            for (const [field,value] of pairs) {
                if (!field || !value || field.value.trim()) continue;
                field.value=value;
                if (field===phone && typeof formatWA==='function') formatWA(field);
                fields.push([field,field.value]);
            }
            if (fields.length) serialPerangkatUI_.autofill={row,sn,fields};
            if (phone?.value) tampilkanInfoKlienCRM_(phone.value);
        }
        if (conflict) state.notice.textContent='SN ditemukan. Periksa pelanggan yang sudah terisi sebelum menyimpan.';
        else state.notice.textContent='SN ditemukan. Lengkapi data yang masih kosong.';
    } else state.notice.textContent='SN ditemukan.';

    if (data.merk_mesin && !state.brand.value.trim()) {
        state.brand.value=data.merk_mesin;
        state.autofillBrand={sn,value:state.brand.value};
        if (data.merek_dari_deskripsi) state.notice.textContent+=' Periksa merek dari deskripsi tiket lama.';
    }
}

function hentikanPindaiBarcodeSerial_() {
    const scan=serialPerangkatUI_.scanner;
    if (!scan) return;
    serialPerangkatUI_.scanner=null;
    scan.stream?.getTracks().forEach(track=>track.stop());
    clearTimeout(scan.timer);
    scan.dialog.close();
    scan.dialog.remove();
}

async function pindaiBarcodeSerial_(row) {
    const state=serialPerangkatUI_.rows.get(row);
    if (!state || !row.isConnected) return;
    if (typeof BarcodeDetector!=='function' || !navigator.mediaDevices?.getUserMedia) {
        state.input.focus();
        state.notice.hidden=false;
        state.notice.textContent='Kamera barcode belum didukung di browser ini. Gunakan scanner USB/Bluetooth atau ketik SN.';
        return;
    }

    hentikanPindaiBarcodeSerial_();
    const dialog=document.createElement('dialog');
    const titleId=state.input.id+'-scanner-title';
    dialog.className='serial-scanner';
    dialog.setAttribute('aria-labelledby',titleId);
    dialog.innerHTML='<h3 id="'+titleId+'">Scan barcode serial number</h3><p>Arahkan kamera ke barcode SN pada mesin.</p>' +
        '<video autoplay muted playsinline></video><button type="button" class="btn-action-primary">Tutup</button>';
    document.body.appendChild(dialog);
    const scan={dialog,row,context:konteksSerial_(),stream:null,timer:null};
    serialPerangkatUI_.scanner=scan;
    const current=()=>serialPerangkatUI_.scanner===scan && row.isConnected && scan.context===konteksSerial_();
    const close=()=>{if(serialPerangkatUI_.scanner===scan)hentikanPindaiBarcodeSerial_();};
    dialog.querySelector('button').addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.showModal();
    try {
        const formats=await BarcodeDetector.getSupportedFormats();
        if (!current()) {close();return;}
        const detector=new BarcodeDetector({formats:formats.filter(format=>format!=='unknown')});
        const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
        if (!current()) {stream.getTracks().forEach(track=>track.stop());close();return;}
        scan.stream=stream;
        const video=dialog.querySelector('video');
        video.srcObject=stream;
        await video.play();
        const detect=async()=>{
            if (!current()) {close();return;}
            const codes=await detector.detect(video).catch(()=>[]);
            if (!current()) {close();return;}
            const values=[...new Set(codes.map(code=>normalisasiSerial_(code.rawValue)).filter(sn=>sn && sn.length<=120 && !/[\r\n]/.test(sn)))];
            if (values.length!==1) {scan.timer=setTimeout(detect,180);return;}
            const [sn]=values;
            close();
            state.input.value=sn;
            state.input.dispatchEvent(new Event('input',{bubbles:true}));
            periksaSerial_(row);
        };
        detect();
    } catch {
        if (!current()) {close();return;}
        close();
        state.input.focus();
        state.notice.hidden=false;
        state.notice.textContent='Kamera tidak dapat digunakan. Gunakan scanner USB/Bluetooth atau ketik SN.';
    }
}

window.addEventListener('pagehide',hentikanPindaiBarcodeSerial_);
document.addEventListener('visibilitychange',()=>{if(document.hidden)hentikanPindaiBarcodeSerial_();});

function pesanSerial_(state, text, status) {
    state.result.hidden=false; state.result.dataset.state=status; state.result.textContent=text;
}
async function periksaSerial_(row, force=false, autofill=true) {
    const state=serialPerangkatUI_.rows.get(row); if (!state) return null;
    clearTimeout(state.timer);
    const sn=normalisasiSerial_(state.input.value), context=konteksSerial_(), key=sn+'|'+context;
    if (!sn) { state.result.hidden=true; return null; }
    if (!force && state.key===key && state.promise) return state.promise;
    if (!force && state.key===key && state.data) return state.data;
    state.controller?.abort(); state.controller=new AbortController();
    const version=++state.version; state.key=key; state.data=null;
    pesanSerial_(state, 'Memeriksa riwayat perangkat…', 'loading');
    state.promise=(async () => {
        try {
            const options={signal:state.controller.signal};
            const params={p_serial_number:sn,p_exclude_ticket:modeEditTiket ? document.getElementById('input-id').value : null};
            const canFill=autofill && (!modeEditTiket || sn!==state.original) && ['admin','admin_raha','manager','direktur'].includes(rolePengguna());
            const lookup=canFill ? callSupabase('rpc/sla_data_tiket_dari_serial','POST', {...params,p_cabang:cabangAktif}, options)
                .then(device => {
                    if (version===state.version && row.isConnected && context===konteksSerial_() && sn===normalisasiSerial_(state.input.value)) isiDataDariSerial_(row,device,sn);
                }).catch(() => {
                    if (version===state.version && row.isConnected && context===konteksSerial_()) {
                        state.notice.hidden=false;
                        state.notice.textContent='Autofill SN belum tersedia. Data dapat diisi secara manual.';
                    }
                }) : Promise.resolve();
            const data=await callSupabase('rpc/sla_riwayat_serial_perangkat','POST', params, options);
            if (!data || data.serial_number!==sn || !Array.isArray(data.tickets) || !Array.isArray(data.warranties)) throw Error('Hasil pemeriksaan SN tidak valid.');
            if (version!==state.version || !row.isConnected || context!==konteksSerial_()) return null;
            state.data=data; tampilkanHasilSerial_(row); await lookup; return data;
        } catch (error) {
            if (version!==state.version || !row.isConnected || context!==konteksSerial_()) return null;
            pesanSerial_(state, 'Riwayat belum dapat diperiksa. Tiket biasa dapat dilanjutkan dengan penanda belum terverifikasi.', 'error');
            const retry=document.createElement('button'); retry.type='button'; retry.className='btn-action-primary'; retry.textContent='Coba lagi';
            retry.addEventListener('click', () => periksaSerial_(row,true)); state.result.appendChild(retry);
            return null;
        } finally { if (version===state.version) state.promise=null; }
    })();
    return state.promise;
}
function tampilkanHasilSerial_(row) {
    const state=serialPerangkatUI_.rows.get(row), data=state.data;
    const tickets=data.tickets, active=data.warranties.filter(g => g.active_items.length);
    const open=tickets.filter(t => !['Selesai','Closed','Cancel','Batal'].includes(t.status));
    const done=tickets.filter(t => ['Selesai','Closed'].includes(t.status));
    const title=open.length ? 'Perangkat ini memiliki tiket yang masih berjalan' : active.length ? 'Ada cakupan garansi yang masih aktif' : done.length ? 'Perangkat ini pernah diservis' : tickets.length ? 'SN ini pernah tercatat' : 'Riwayat SN belum ditemukan';
    pesanSerial_(state, '', open.length ? 'open' : active.length ? 'warranty' : tickets.length ? 'history' : 'empty');
    const heading=document.createElement('strong'); heading.textContent=title; state.result.appendChild(heading);
    const info=document.createElement('p'); info.textContent=tickets.length ? done.length+' servis selesai · '+tickets.length+' tiket sesuai hak akses.' : 'Tiket tetap dapat dibuat. Riwayat lama tanpa SN terstruktur mungkin belum ditemukan.'; state.result.appendChild(info);
    if (open.length) {
        const p=document.createElement('p'); p.textContent='Periksa tiket '+open.map(t=>t.id_tiket+' ('+t.cabang+')').join(', ')+' sebelum membuat tiket tambahan.'; state.result.appendChild(p);
    }
    for (const g of active) {
        const p=document.createElement('p');
        p.textContent='Kartu '+g.id_garansi+' · Tiket asal '+g.referensi_tiket_nota+' · '+g.cabang;
        state.result.appendChild(p);
        for (const item of g.active_items) { const small=document.createElement('small'); small.textContent=item.nama+' · Berlaku sampai '+waktuSerial_(item.tanggal_habis); state.result.appendChild(small); }
        if (!modeEditTiket && ['admin','admin_raha','manager','direktur'].includes(rolePengguna())) {
            const button=document.createElement('button'); button.type='button'; button.className='btn-action-primary'; button.textContent='Tinjau klaim garansi'; button.disabled=!!state.reviewing;
            button.addEventListener('click', () => tinjauKlaimSerial_(row,g.id_garansi,button)); state.result.appendChild(button);
        }
    }
    if (active.length) { const p=document.createElement('p'); p.textContent='Periksa kecocokan perangkat dan apakah keluhan termasuk cakupan garansi.'; state.result.appendChild(p); }
    if (tickets.length || data.warranties.length) {
        const details=document.createElement('details'), summary=document.createElement('summary'), list=document.createElement('ul');
        summary.textContent='Lihat riwayat servis dan garansi'; details.appendChild(summary);
        for (const t of tickets) { const li=document.createElement('li'); li.textContent=t.id_tiket+' · '+t.cabang+' · '+t.status+' · '+waktuSerial_(t.waktu_selesai || t.waktu_lapor)+' — '+(t.jenis_pekerjaan || 'Deskripsi belum tersedia'); list.appendChild(li); }
        for (const g of data.warranties) { const li=document.createElement('li'); li.textContent='Garansi '+g.id_garansi+' · '+g.status_efektif+' · '+g.referensi_tiket_nota+(g.tanggal_habis ? ' · Batas '+waktuSerial_(g.tanggal_habis) : ''); list.appendChild(li); }
        details.appendChild(list); state.result.appendChild(details);
    }
    if ((!modeEditTiket || normalisasiSerial_(state.input.value)!==state.original) && (active.length || open.length)) {
        const actions=document.createElement('div'); actions.className='serial-actions';
        const button=document.createElement('button'); button.type='button'; button.className='btn-action-primary'; button.textContent='Lanjutkan sebagai servis biasa';
        const label=document.createElement('label'); label.hidden=true; label.textContent='Alasan membuat tiket servis biasa';
        const reason=document.createElement('textarea'); reason.className='serial-normal-reason'; reason.rows=2; reason.maxLength=1000; reason.value=state.reason;
        reason.placeholder='Contoh: Kerusakan power supply; garansi sebelumnya hanya roller.';
        reason.addEventListener('input', () => state.reason=reason.value.trim()); label.appendChild(reason);
        button.addEventListener('click', () => { label.hidden=false; reason.focus(); });
        actions.appendChild(button); state.result.append(actions,label);
    }
}
async function siapkanSerialTiket_() {
    const rows=[...document.querySelectorAll('#wadah-pekerjaan .pekerjaan-item')].filter(row => row.querySelector('.input-pekerjaan-multi')?.value.trim());
    const snapshot=rows.map(row=>[row.querySelector('.input-pekerjaan-multi').value,normalisasiSerial_(row.querySelector('.input-serial-number')?.value),row.querySelector('.input-merk-mesin')?.value.trim() || '']);
    const context=konteksSerial_();
    const seen=new Set(), payloads=[];
    // Validate every device before the first ticket is written.
    for (const row of rows) {
        const state=serialPerangkatUI_.rows.get(row); if (!state) { payloads.push({}); continue; }
        const sn=normalisasiSerial_(state.input.value);
        const brand=state.brand.value.trim();
        if (brand.length>80) throw Error('Merek mesin maksimal 80 karakter.');
        const payload=brand!==state.originalBrand ? {merk_mesin:brand || null} : {};
        if (!sn) { payloads.push(state.original ? {...payload,serial_number:null,pemeriksaan_serial:null} : payload); continue; }
        if (sn.length>120) throw Error('SN maksimal 120 karakter.');
        if (seen.has(sn)) throw Error('SN '+sn+' diisi lebih dari sekali. Periksa kembali perangkat.'); seen.add(sn);
        if (modeEditTiket && sn===state.original) { payloads.push(payload); continue; }
        const data=await periksaSerial_(row,true,false);
        if (normalisasiSerial_(state.input.value)!==sn) throw Error('SN berubah saat diperiksa. Simpan kembali setelah pemeriksaan selesai.');
        const needsReason=data && (data.warranties.some(g=>g.active_items.length) || data.tickets.some(t=>!['Selesai','Closed','Cancel','Batal'].includes(t.status)));
        if (needsReason && state.reason.length<5) {
            const reason=state.result.querySelector('.serial-normal-reason');
            if (reason) { reason.parentElement.hidden=false; reason.focus(); }
            throw Error('SN '+sn+' memiliki garansi aktif atau tiket berjalan. Tinjau klaim atau isi alasan servis biasa minimal 5 karakter.');
        }
        payloads.push({ ...payload, serial_number:sn, pemeriksaan_serial:{ status:data ? 'terverifikasi' : 'belum_terverifikasi', alasan_servis_biasa:state.reason || '', diperiksa_pada:data?.checked_at || null } });
    }
    const finalRows=[...document.querySelectorAll('#wadah-pekerjaan .pekerjaan-item')].filter(row=>row.querySelector('.input-pekerjaan-multi')?.value.trim());
    if (context!==konteksSerial_() || finalRows.length!==rows.length || rows.some((row,i)=>row!==finalRows[i] || row.querySelector('.input-pekerjaan-multi').value!==snapshot[i][0] || normalisasiSerial_(row.querySelector('.input-serial-number')?.value)!==snapshot[i][1] || (row.querySelector('.input-merk-mesin')?.value.trim() || '')!==snapshot[i][2])) throw Error('Data perangkat berubah saat diperiksa. Periksa lalu simpan kembali.');
    return payloads;
}
async function tinjauKlaimSerial_(row, id, button) {
    const state=serialPerangkatUI_.rows.get(row);
    if (state.reviewing) return;
    const sn=normalisasiSerial_(state.input.value), description=row.querySelector('.input-pekerjaan-multi').value, context=konteksSerial_();
    state.reviewing=true;
    button.disabled=true;
    try {
        const data=await periksaSerial_(row,true,false);
        const g=data?.warranties.find(g=>g.id_garansi===id && g.active_items.length);
        if (!g) throw Error('Garansi belum dapat diverifikasi atau tidak lagi aktif. Periksa kembali riwayat.');
        const cards=await callSupabase(endpointFilterSupabase_('garansi','id_garansi',id),'GET');
        if (!Array.isArray(cards) || cards.length!==1) throw Error('Kartu garansi belum dapat dimuat. Coba kembali.');
        if (!row.isConnected || normalisasiSerial_(state.input.value)!==sn || row.querySelector('.input-pekerjaan-multi').value!==description || context!==konteksSerial_()) throw Error('Data perangkat berubah. Periksa SN dan tinjau klaim kembali.');
        const mapped=petakanGaransiSupabase_(cards[0]), current=globalGaransi.find(x=>x['ID Garansi']===id);
        if (current) Object.assign(current,mapped); else globalGaransi.push(mapped);
        // Use the established item selection, confirmation, and notification path.
        bukaKlaimItemGaransi(id);
        if (!draftKlaimItemGaransi_ || draftKlaimItemGaransi_.id!==id) throw Error('Buka cabang asal garansi untuk memproses klaim sesuai hak akses.');
        document.getElementById('klaim-item-keluhan').value=description.slice(0,2000);
        serialPerangkatUI_.claim={row,id,requestId:draftKlaimItemGaransi_.requestId,sn,description};
    } catch (error) { showToast(error.message,'warning'); }
    finally { state.reviewing=false; button.disabled=false; state.result.querySelectorAll('button').forEach(el=>el.disabled=false); }
}
function selesaikanKlaimSerial_(result,id,requestId) {
    const claim=serialPerangkatUI_.claim;
    if (!claim || claim.id!==id || claim.requestId!==requestId || !result.idTiket) return;
    serialPerangkatUI_.claim=null;
    // Consume only the claimed device; retain all other unsaved devices and form values.
    if (claim.row.isConnected && normalisasiSerial_(claim.row.querySelector('.input-serial-number')?.value)===claim.sn && claim.row.querySelector('.input-pekerjaan-multi').value===claim.description) {
        claim.row.remove();
        if (!document.querySelector('#wadah-pekerjaan .pekerjaan-item')) tambahKolomPekerjaan();
    }
}
document.querySelectorAll('#wadah-pekerjaan .pekerjaan-item').forEach(row=>pasangKolomSerial_(row));
