(function () {
    'use strict';
    const evidenceBucket = 'sla-sales-evidence';
    const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const dateKey = value => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    const localValue = value => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T');
    const iso = value => { const d = new Date(value + (value.length === 16 ? ':00' : '') + '+08:00'); if (!Number.isFinite(d.getTime())) throw Error('Tanggal dan waktu tidak valid.'); return d.toISOString(); };
    const money = value => 'Rp' + new Intl.NumberFormat('id-ID').format(Number(value) || 0);
    const when = value => value ? new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) + ' WITA' : '—';
    const manager = () => ['admin','admin_raha','manager','direktur'].includes(rolePengguna());
    const identity = () => String(penggunaAktif?.Username || '') + '/' + String(cabangAktif || '');
    const $ = id => document.getElementById(id);
    let targets = [], followups = [], scope = '', loadedAt = 0, loading = null, generation = 0, draft = null;
    let period = dateKey(new Date()).slice(0,7), selected = '';
    function employees() {
        const users = (globalUsers || []).filter(u => u && rolePengguna(u) === 'sales' && u['Akun Aktif'] !== false && !u['Sinkron Akses Akun'] && dataSesuaiCabangAktif_(u));
        if (rolePengguna() === 'sales' && !users.some(u => u.Username === penggunaAktif.Username)) users.push(penggunaAktif);
        return users.filter(u => manager() || u.Username === penggunaAktif.Username).sort((a,b) => String(a['Nama Asli']).localeCompare(String(b['Nama Asli']),'id'));
    }
    function targetFor(username, month = period) { return targets.find(t => t.username === username && t.periode === month && t.cabang === cabangAktif); }
    async function pages(table, fields) {
        const rows = [];
        for (;;) {
            const page = await callSupabase(table + '?select=' + fields + '&cabang=eq.' + encodeURIComponent(cabangAktif) + '&limit=500&offset=' + rows.length);
            if (!Array.isArray(page)) throw Error('Format data sales tidak valid.');
            rows.push(...page);
            if (page.length < 500) return rows;
            if (rows.length >= 50000) throw Error('Data sales terlalu besar. Hubungi admin.');
        }
    }
    function panel() {
        if (!$('sales-workspace')) return;
        const allowed = manager() || rolePengguna() === 'sales';
        $('sales-workspace').hidden = !allowed;
        if (!allowed) return;
        const staff = employees();
        if (!staff.some(u => u.Username === selected)) selected = rolePengguna() === 'sales' ? penggunaAktif.Username : staff[0]?.Username || '';
        const employee = staff.find(u => u.Username === selected), target = targetFor(selected);
        const legacy = Number(employee?.['Target Sales (Rp)'] || employee?.['Target Sales'] || 0);
        const related = (globalProspek || []).filter(p => p && dataSesuaiCabangAktif_(p) && String(p['Sales Penanggung Jawab'] || '').split(',').some(n => n.trim().toLowerCase() === String(employee?.['Nama Asli'] || '').trim().toLowerCase()));
        const prospects = related.filter(p => p['Tanggal Input'] && Number.isFinite(Date.parse(p['Tanggal Input'])) && dateKey(p['Tanggal Input']).startsWith(period));
        const deals = prospects.filter(p => /closing|deal/i.test(p['Status Prospek'] || '')).length;
        const rate = prospects.length ? Math.round(deals / prospects.length * 1000) / 10 : 0;
        const today = dateKey(new Date());
        const completed = new Set(followups.filter(f => f.username === selected && dateKey(f.waktu_kontak) === today).map(f => f.id_prospek)).size;
        let revenue = 0;
        try { revenue = renderDashboard({hitungSaja:true,bulan:period.slice(5),tahun:period.slice(0,4)}).statsSales[employee?.['Nama Asli']]?.revenue || 0; } catch (_) { /* The main dashboard may still be loading. */ }
        const host = $('sales-workspace');
        host.innerHTML = `<h3>Target & tindak lanjut sales</h3><p class="sales-muted">Target per sales dan per bulan. Closing mengikuti status tiket secara otomatis.</p>
            <div class="sales-pickers"><label>Periode target<input id="sales-target-period" type="month" value="${safe(period)}" required></label><label>Nama sales<select id="sales-target-person" ${manager() ? '' : 'disabled'}>${staff.map(u => `<option value="${safe(u.Username)}" ${u.Username===selected?'selected':''}>${safe(u['Nama Asli'])}</option>`).join('')}</select></label></div>
            <form id="sales-target-form"><div class="sales-target-grid">
                <div class="sales-target-card"><strong>Omzet</strong>${manager()?`<label>Target per bulan (Rp)<input id="sales-target-revenue" type="number" min="1" max="999999999999999" step="1" value="${safe(target?.omzet ?? (legacy || ''))}" placeholder="150000000" required></label>`:`<div class="sales-value">${target || legacy ? money(target?.omzet ?? legacy) : 'Belum diatur'}</div>`}<p class="sales-muted">Realisasi: ${money(revenue)}</p></div>
                <div class="sales-target-card"><strong>Konversi</strong>${manager()?`<label>Prospek menjadi deal (%)<input id="sales-target-conversion" type="number" min="0.01" max="100" step="0.01" value="${safe(target?.konversi ?? 25)}" required></label>`:`<div class="sales-value">${target ? safe(target.konversi)+'%' : 'Belum diatur'}</div>`}<p class="sales-muted">${deals} deal / ${prospects.length} prospek pada periode ini · ${rate}%</p></div>
                <div class="sales-target-card"><strong>Tindak lanjut</strong>${manager()?`<label>Target per hari kerja<input id="sales-target-followup" type="number" min="1" max="999" step="1" value="${safe(target?.followup_harian ?? 8)}" required></label>`:`<div class="sales-value">${target ? safe(target.followup_harian)+' / hari' : 'Belum diatur'}</div>`}<p class="sales-muted">Hari ini: ${completed} pelanggan tercatat</p></div>
            </div>${manager()?`<label class="sales-check"><input id="sales-target-proof" type="checkbox" ${target?.bukti_wajib !== false?'checked':''}><span>Bukti wajib untuk menghitung tindak lanjut</span></label>`:`<p class="sales-muted">Bukti ${target?.bukti_wajib===false?'opsional':'wajib'} untuk setiap catatan tindak lanjut.</p>`}
            <p class="sales-muted">Satu pelanggan dihitung sekali per hari. Beberapa kebutuhan dalam satu prospek tetap dihitung sebagai satu pelanggan.</p>
            <div class="sales-footer"><span id="sales-target-status" class="sales-muted" role="status">${target?'Target periode ini tersimpan.':'Target periode ini belum disimpan.'}</span>${manager()?'<button type="submit" id="sales-target-save" class="btn-solid-primary">Simpan target</button>':''}</div></form>`;
        $('sales-target-period').addEventListener('change',event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { period=event.target.value; panel(); } });
        $('sales-target-person').addEventListener('change',event => { selected=event.target.value; panel(); });
        $('sales-target-form').addEventListener('submit',saveTarget);
    }
    async function saveTarget(event) {
        event.preventDefault(); if (!manager() || $('sales-target-save').disabled) return;
        const button=$('sales-target-save'), actor=identity(); button.disabled=true; $('sales-target-status').textContent='Menyimpan target...';
        try {
            const data={cabang:cabangAktif,periode:period,username:selected,omzet:Number($('sales-target-revenue').value),konversi:Number($('sales-target-conversion').value),followup_harian:Number($('sales-target-followup').value),bukti_wajib:$('sales-target-proof').checked};
            const saved=await callSupabase('rpc/sla_sales_save_target','POST',{p_data:data});
            if (actor!==identity()) return;
            targets=targets.filter(t => !(t.cabang===saved.cabang && t.periode===saved.periode && t.username===saved.username)); targets.push(saved);
            panel(); renderDashboard(); showToast('Target sales berhasil disimpan.','success');
        } catch(error) { if(actor===identity()) $('sales-target-status').textContent='Gagal menyimpan: '+error.message; }
        finally { button.disabled=false; }
    }
    function histories() {
        const container=$('prospek-container'); if(!container) return;
        container.querySelectorAll('[data-sales-history]').forEach(el => el.remove());
        container.querySelectorAll('.card').forEach(card => {
            const id=card.querySelector('h3 span')?.textContent.trim();
            const rows=followups.filter(f=>f.id_prospek===id).sort((a,b)=>Date.parse(b.waktu_kontak)-Date.parse(a.waktu_kontak));
            if(!rows.length)return;
            const current=(globalProspek||[]).find(p=>p['ID Prospek']===id),latest=rows[0];
            const active=!/closing|deal|batal|tanpa keterangan/i.test(current?.['Status Prospek']||'');
            const block=document.createElement('div');block.dataset.salesHistory=id;block.className='sales-history';
            block.innerHTML=(active&&latest.jadwal?`<div class="sales-due"><strong>${Date.parse(latest.jadwal)<Date.now()?'Jadwal terlewat':'Tindak lanjut berikutnya'}:</strong> ${safe(latest.langkah)} · ${safe(when(latest.jadwal))}</div>`:'')+`<details><summary>Catatan & bukti tindak lanjut (${rows.length})</summary>${rows.map(row=>`<article><strong>${safe(row.hasil)}</strong><p class="sales-muted">${safe(row.nama_sales)} · ${safe(row.kanal)} · ${safe(when(row.waktu_kontak))}</p><p>${safe(row.ringkasan)}</p>${row.jadwal?`<p>Berikutnya: ${safe(row.langkah)} · ${safe(when(row.jadwal))}</p>`:''}${row.bukti_jenis!=='none'?`<button type="button" class="btn-action-primary" data-sales-proof="${safe(row.id)}">Lihat bukti</button>`:'<p class="sales-muted">Bukti tidak dilampirkan (opsional).</p>'}</article>`).join('')}</details>`;
            block.addEventListener('click',event=>{const button=event.target.closest('[data-sales-proof]');if(button)void openProof(button.dataset.salesProof)});card.append(block);
        });
    }
    async function refresh(force=false) {
        if(typeof penggunaAktif==='undefined'||!penggunaAktif||!$('sales-workspace'))return;
        if(!manager()&&rolePengguna()!=='sales'){ $('sales-workspace').hidden=true;return; }
        const key=identity();
        if(key!==scope){generation++;scope=key;targets=[];followups=[];loadedAt=0;loading=null;selected='';}
        if(!force&&Date.now()-loadedAt<30000){queueMicrotask(()=>{panel();histories()});return;}
        if(loading&&!force)return loading;
        const request=++generation;
        loading=(async()=>{try{
            const [t,f]=await Promise.all([pages('sla_sales_targets','*'),pages('sla_sales_followups','id,id_prospek,cabang,username,nama_sales,waktu_kontak,kanal,hasil,ringkasan,bukti_jenis,bukti_path,bukti_nama,langkah,jadwal')]);
            if(key!==identity()||request!==generation)return;
            targets=t;followups=f;loadedAt=Date.now();panel();histories();renderDashboard();
        }catch(error){if(key===identity()&&request===generation){$('sales-workspace').hidden=false;$('sales-workspace').innerHTML='<h3>Target & tindak lanjut sales</h3><p class="sales-message">'+safe(error.message)+'</p><button type="button" class="btn-action-primary" id="sales-reload">Muat ulang</button>';$('sales-reload').addEventListener('click',()=>refresh(true));}}
        finally{if(request===generation)loading=null;}})();return loading;
    }
    function validate(step) {
        if(!draft||draft.actor!==identity())throw Error('Akun atau cabang berubah. Buka kembali form tindak lanjut.');
        if(step===1){
            if(!$('followup-hasil').value)throw Error('Pilih hasil kontak terlebih dahulu.');
            if(!$('followup-keterangan').value.trim())throw Error('Ringkasan percakapan wajib diisi.');
            if(new Date(iso($('followup-waktu').value)).getTime()>Date.now()+300000)throw Error('Waktu kontak tidak boleh berada di masa mendatang.');
        }
        if(step===2){
            const file=$('followup-bukti').files[0],kind=document.querySelector('input[name="sales-proof-kind"]:checked').value;
            const required=targetFor(penggunaAktif.Username,dateKey(iso($('followup-waktu').value)).slice(0,7))?.bukti_wajib!==false;
            const link=$('followup-link').value.trim();
            if(required&&((kind==='file'&&!file)||(kind==='link'&&!link)))throw Error('Lampirkan bukti tindak lanjut terlebih dahulu.');
            if(file&&kind==='file'&&(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size>10485760))throw Error('Bukti harus JPG, PNG, WEBP, atau PDF dengan ukuran maksimal 10 MB.');
            if(link&&kind==='link'){let url;try{url=new URL(link)}catch{throw Error('Tautan bukti tidak valid.')}if(!['https:','http:'].includes(url.protocol))throw Error('Gunakan tautan bukti http atau https.');}
            if($('followup-hasil').value!=='Tidak berminat'){
                if(!$('followup-langkah').value||!$('followup-jadwal').value)throw Error('Isi langkah dan jadwal berikutnya.');
                if(iso($('followup-jadwal').value)<=iso($('followup-waktu').value))throw Error('Jadwal berikutnya harus setelah waktu kontak.');
            }
        }
    }
    function payload() {
        const kind=document.querySelector('input[name="sales-proof-kind"]:checked').value,file=$('followup-bukti').files[0],closed=$('followup-hasil').value==='Tidak berminat';
        return {id:draft.id,id_prospek:draft.prospect['ID Prospek'],cabang:draft.branch,waktu_kontak:iso($('followup-waktu').value),kanal:$('followup-kanal').value,hasil:$('followup-hasil').value,ringkasan:$('followup-keterangan').value.trim(),bukti_jenis:kind==='file'?(file?'file':'none'):($('followup-link').value.trim()?'link':'none'),bukti_path:kind==='link'?$('followup-link').value.trim():null,bukti_nama:kind==='file'?file?.name:'Tautan bukti',langkah:closed?null:$('followup-langkah').value,jadwal:closed?null:iso($('followup-jadwal').value)};
    }
    function showStep(step) {
        if(!draft||draft.saving)return;draft.step=step;
        document.querySelectorAll('[data-sales-step]').forEach(el=>el.hidden=Number(el.dataset.salesStep)!==step);
        document.querySelectorAll('[data-sales-marker]').forEach(el=>{if(Number(el.dataset.salesMarker)===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current')});
        $('followup-error').textContent='';$('followup-prev').hidden=step===1;$('followup-step-label').textContent='Langkah '+step+' dari 3';
        $('btn-submit-followup').textContent=['Lanjut: bukti & jadwal','Lanjut: periksa catatan','Simpan tindak lanjut'][step-1];
        if(step===2){const closed=$('followup-hasil').value==='Tidak berminat';$('followup-next-fields').hidden=closed;$('followup-finished').hidden=!closed;const target=targetFor(penggunaAktif.Username,dateKey(iso($('followup-waktu').value)).slice(0,7));$('followup-proof-label').textContent='Bukti tindak lanjut'+(target?.bukti_wajib===false?' (opsional)':' *');}
        if(step===3){const data=payload();const rows=[['Pelanggan',draft.prospect['Nama Calon Customer']],['Cara & waktu',data.kanal+' · '+when(data.waktu_kontak)],['Hasil kontak',data.hasil],['Ringkasan',data.ringkasan],['Bukti',data.bukti_jenis==='none'?'Tidak dilampirkan (opsional)':data.bukti_nama],['Langkah berikutnya',data.jadwal?data.langkah+' · '+when(data.jadwal):'Tidak diperlukan (pelanggan tidak berminat)']];$('followup-review').innerHTML=rows.map(([k,v])=>'<dt>'+safe(k)+'</dt><dd>'+safe(v)+'</dd>').join('');}
    }
    function open(id) {
        if(draft?.saving)return;
        const p=(globalProspek||[]).find(p=>p['ID Prospek']===id&&dataSesuaiCabangAktif_(p));
        const own=String(p?.['Sales Penanggung Jawab']||'').split(',').some(n=>n.trim().toLowerCase()===String(penggunaAktif?.['Nama Asli']||'').trim().toLowerCase());
        if(!p||(!manager()&&!(rolePengguna()==='sales'&&own))||/closing|deal|batal|tanpa keterangan|menunggu pemulihan/i.test(p['Status Prospek']||'')){showToast('Prospek tidak dapat ditindaklanjuti. Muat ulang data.','error');return;}
        $('sales-followup-form').reset();draft={id:crypto.randomUUID(),prospect:p,actor:identity(),branch:cabangAktif,step:1,saving:false};
        $('followup-id-prospek').value=id;$('followup-customer').textContent=p['Nama Calon Customer']+' · '+id;
        $('followup-waktu').value=localValue(new Date());$('followup-jadwal').value=localValue(new Date(Date.now()+86400000));
        $('followup-file-zone').hidden=false;$('followup-link-zone').hidden=true;$('followup-proof-name').textContent='Belum ada file dipilih.';$('followup-preview').hidden=true;
        showStep(1);$('modal-followup').style.display='flex';
    }
    function close(){if(draft?.saving)return;$('modal-followup').style.display='none';draft=null;}
    async function storageRequest(path,options,retry=true) {
        const token=await pastikanTokenSupabaseAktif_();
        const response=await fetch(SUPABASE_URL+'/storage/v1/'+path,{...options,headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,...options.headers}});
        if(response.status===401&&retry){await pastikanTokenSupabaseAktif_(true);return storageRequest(path,options,false);}
        if(!response.ok){const error=await response.json().catch(()=>({}));if(options.method==='POST'&&path.startsWith('object/'+evidenceBucket+'/')&&(response.status===409||error.error==='Duplicate'||error.code==='Duplicate'))return null;throw Error(error.message||error.error||'Bukti tidak dapat diproses.');}
        return response.json();
    }
    async function save(event) {
        event.preventDefault();if(!draft||draft.saving)return;
        try {validate(1);if(draft.step===1){showStep(2);return;}validate(2);if(draft.step===2){showStep(3);return;}}catch(error){$('followup-error').textContent=error.message;return;}
        const data=payload(),current=draft,file=$('followup-bukti').files[0];
        current.saving=true;$('followup-fields').disabled=true;$('btn-submit-followup').disabled=true;$('followup-prev').disabled=true;$('btn-submit-followup').textContent='Menyimpan...';$('followup-error').textContent='';
        try {
            if(data.bukti_jenis==='file'){
                if(current.actor!==identity())throw Error('Akun atau cabang berubah.');
                const token=await pastikanTokenSupabaseAktif_();const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
                const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];
                data.bukti_path=current.branch+'/'+current.prospect['ID Prospek']+'/'+claims.sub+'/'+current.id+'.'+extension;
                await storageRequest('object/'+evidenceBucket+'/'+data.bukti_path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':file.type,'x-upsert':'false'},body:file});
            }
            if(current.actor!==identity())throw Error('Akun atau cabang berubah.');
            const saved=await callSupabase('rpc/sla_sales_save_followup','POST',{p_data:data});
            followups=followups.filter(row=>row.id!==saved.id);followups.push(saved);
            $('modal-followup').style.display='none';draft=null;
            try {await ambilSemuaData(true);await refresh(true);showToast('Tindak lanjut dan bukti berhasil disimpan.','success');}
            catch(refreshError){histories();showToast('Catatan tersimpan. Muat ulang halaman untuk memperbarui seluruh data.','warning');}
        }catch(error){$('followup-error').textContent='Gagal menyimpan: '+error.message;}
        finally {current.saving=false;$('followup-fields').disabled=false;$('btn-submit-followup').disabled=false;$('followup-prev').disabled=false;$('btn-submit-followup').textContent='Simpan tindak lanjut';}
    }
    async function openProof(id) {
        const row=followups.find(f=>f.id===id);if(!row)return;
        const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
        try{let url=row.bukti_path;if(row.bukti_jenis==='file'){const result=await storageRequest('object/sign/'+evidenceBucket+'/'+row.bukti_path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:180})});url=result.signedURL.startsWith('http')?result.signedURL:SUPABASE_URL+'/storage/v1'+result.signedURL;}
            const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('Tautan bukti tidak valid.');if(tab)tab.location.href=parsed.href;else showToast('Izinkan popup untuk membuka bukti.','warning');
        }catch(error){if(tab)tab.close();showToast(error.message,'error');}
    }
    function init() {
        $('sales-followup-form')?.addEventListener('submit',save);
        $('followup-prev')?.addEventListener('click',()=>showStep(draft.step-1));$('followup-close')?.addEventListener('click',close);
        document.querySelectorAll('input[name="sales-proof-kind"]').forEach(input=>input.addEventListener('change',()=>{$('followup-file-zone').hidden=input.value!=='file';$('followup-link-zone').hidden=input.value!=='link';$('followup-error').textContent='';}));
        $('followup-bukti')?.addEventListener('change',()=>{if(draft&&!draft.saving)draft.id=crypto.randomUUID();const file=$('followup-bukti').files[0];$('followup-proof-name').textContent=file?file.name:'Belum ada file dipilih.';$('followup-preview').hidden=true;if(file&&['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=10485760){const reader=new FileReader();reader.onload=()=>{if($('followup-bukti').files[0]===file){$('followup-preview').src=reader.result;$('followup-preview').hidden=false;}};reader.readAsDataURL(file);}});
    }
    window.SalesWorkspace={refresh,open,save,close,revenueTarget:(user,month,year,fallback)=>{if(!/^\d{1,2}$/.test(String(month)))return fallback;return targetFor(user.Username,year+'-'+String(month).padStart(2,'0'))?.omzet??fallback;}};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
