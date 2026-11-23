(function () {
    'use strict';
    const metadata = new WeakMap();
    const pending = new Map();
    const idKey = kind => kind === 'tiket' ? 'ID Tiket' : 'ID Prospek';
    const rows = kind => kind === 'tiket' ? globalTickets : globalProspek;
    const current = (kind, id) => (rows(kind) || []).find(row => row && String(row[idKey(kind)]) === id);
    const cancelled = () => Object.assign(new Error('Akun atau cabang berubah. Buka kembali data yang dipilih.'), { code: 'REQUEST_ABORTED' });

    function prepareTicket(row, raw) {
        if (Object.prototype.hasOwnProperty.call(raw, 'has_tanda_tangan')) {
            metadata.set(row, { loaded: !raw.has_tanda_tangan && !raw.has_bukti_banding, signature: raw.has_tanda_tangan === true, appeal: raw.has_bukti_banding === true });
        }
        return row;
    }
    function prepareProspect(row, raw) {
        if (Object.prototype.hasOwnProperty.call(raw, 'has_bukti_chat')) {
            metadata.set(row, { loaded: !raw.has_bukti_chat, proof: raw.has_bukti_chat === true });
        }
        return row;
    }
    function needsMedia(row) {
        if (!row) return false;
        const state = metadata.get(row);
        if (state) return state.loaded === false;
        // Realtime can omit unchanged TOAST columns. Never treat omitted files as empty.
        return row['ID Tiket'] !== undefined ? row['Tanda Tangan'] === undefined || row['Bukti Banding'] === undefined
            : row['ID Prospek'] !== undefined && row['Bukti Chat'] === undefined;
    }
    function hasProspectProof(row) { return metadata.get(row)?.proof === true || String(row?.['Bukti Chat'] || '').length > 10; }
    function hasStoredFile(row, key) {
        const state = metadata.get(row);
        return key === 'Tanda Tangan' ? state?.signature === true : key === 'Bukti Banding' ? state?.appeal === true : key === 'Bukti Chat' ? state?.proof === true : false;
    }
    function clear() {
        for (const entry of pending.values()) entry.controller.abort();
        pending.clear();
    }
    async function load(kind, value) {
        const id = String(value || '').trim();
        if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error('ID lampiran tidak valid.');
        const row = current(kind, id);
        if (!row) throw new Error('Data tidak ditemukan. Muat ulang daftar terlebih dahulu.');
        if (!needsMedia(row)) return row;
        const user = penggunaAktif, branch = cabangAktif, username = String(user?.Username || '');
        if (!user || !username || !['Kendari', 'Raha'].includes(branch)) throw cancelled();
        const key = username + '|' + branch + '|' + kind + '|' + id;
        if (pending.has(key)) return pending.get(key).promise;
        const controller = new AbortController();
        const sameContext = () => !controller.signal.aborted && penggunaAktif === user && String(penggunaAktif?.Username || '') === username && cabangAktif === branch;
        const promise = (async () => {
            const table = kind === 'tiket' ? 'tiket' : 'prospek';
            const column = kind === 'tiket' ? 'id_tiket' : 'id_prospek';
            const fields = kind === 'tiket' ? 'id_tiket,cabang,tanda_tangan,bukti_banding,versi_workflow' : 'id_prospek,cabang,bukti_chat';
            const scope = branch === 'Kendari' ? 'or=(cabang.eq.Kendari,cabang.is.null)' : 'cabang=eq.Raha';
            const response = await callSupabase(table + '?select=' + fields + '&' + column + '=eq.' + encodeURIComponent(id) + '&' + scope + '&limit=1', 'GET', null, { signal: controller.signal });
            if (!sameContext()) throw cancelled();
            if (!Array.isArray(response) || response.length !== 1 || String(response[0][column]) !== id || (response[0].cabang || 'Kendari') !== branch) throw new Error('Lampiran tidak ditemukan atau tidak dapat diakses.');
            const target = current(kind, id);
            if (!target) throw cancelled();
            const raw = response[0];
            if (kind === 'tiket') {
                if (Number.isFinite(Number(raw.versi_workflow)) && Number.isFinite(Number(target['Versi Workflow'])) && Number(raw.versi_workflow) !== Number(target['Versi Workflow'])) throw new Error('Data tiket berubah. Sinkronkan data sebelum mengedit.');
                target['Tanda Tangan'] = raw.tanda_tangan || '';
                target['Bukti Banding'] = raw.bukti_banding || '';
                metadata.set(target, { loaded: true, signature: target['Tanda Tangan'].length > 50, appeal: !!target['Bukti Banding'] });
            } else {
                target['Bukti Chat'] = raw.bukti_chat || '';
                metadata.set(target, { loaded: true, proof: target['Bukti Chat'].length > 10 });
            }
            return target;
        })();
        pending.set(key, { promise, controller });
        try { return await promise; }
        finally { if (pending.get(key)?.promise === promise) pending.delete(key); }
    }
    function failed(error) {
        if (error?.code !== 'REQUEST_ABORTED') showToast('Lampiran belum dapat dimuat: ' + (error.message || 'Coba kembali.') + ' Data belum diubah.', 'error');
    }
    function wrap(name, kind, resolveId, submitting = false) {
        const original = window[name];
        if (typeof original !== 'function') return;
        const running = new Map();
        window[name] = function (...args) {
            const id = String(resolveId(args) || '').trim();
            if (!id || !needsMedia(current(kind, id))) return original.apply(this, args);
            if (submitting) args[0]?.preventDefault?.();
            if (running.has(id)) return running.get(id);
            const work = load(kind, id).then(() => original.apply(this, args)).catch(failed);
            running.set(id, work);
            return work.finally(() => { if (running.get(id) === work) running.delete(id); });
        };
    }
    function install() {
        const originalUpsert = window.upsertRecordRealtime_;
        if (typeof originalUpsert === 'function') window.upsertRecordRealtime_ = function (list, key, id, incoming) {
            const previous = (list || []).find(row => String(row?.[key] || '').toLowerCase() === String(id || '').toLowerCase());
            const result = originalUpsert.apply(this, arguments);
            const target = (result || []).find(row => String(row?.[key] || '').toLowerCase() === String(id || '').toLowerCase());
            if (!target || target === previous) return result;
            const old = metadata.get(previous);
            if (key === 'ID Tiket') {
                const signature = incoming['Tanda Tangan'], appeal = incoming['Bukti Banding'];
                metadata.set(target, { loaded: signature !== undefined && appeal !== undefined,
                    signature: signature === undefined ? old?.signature === true || String(previous?.['Tanda Tangan'] || '').length > 50 : String(signature || '').length > 50,
                    appeal: appeal === undefined ? old?.appeal === true || !!previous?.['Bukti Banding'] : !!appeal });
            } else if (key === 'ID Prospek') {
                const proof = incoming['Bukti Chat'];
                metadata.set(target, { loaded: proof !== undefined, proof: proof === undefined ? old?.proof === true || String(previous?.['Bukti Chat'] || '').length > 10 : String(proof || '').length > 10 });
            }
            return result;
        };
        wrap('aktifkanEditTiket', 'tiket', args => args[0]);
        wrap('bukaModalUpdate', 'tiket', args => args[0]);
        wrap('submitUpdate', 'tiket', () => document.getElementById('update-id')?.value, true);
        wrap('submitData', 'tiket', args => args[1] === 'sla' && typeof modeEditTiket !== 'undefined' && modeEditTiket ? document.getElementById('input-id')?.value : '', true);
        wrap('unduhBuktiChatProspek', 'prospek', args => args[0]);
        const originalViewer = window.lihatBuktiChatProspek;
        if (typeof originalViewer === 'function') window.lihatBuktiChatProspek = function (value) {
            const id = String(value || '').trim();
            if (!needsMedia(current('prospek', id))) return originalViewer.call(this, value);
            // Reserve the tab during the user's click, before the attachment fetch.
            const tab = window.open('about:blank', '_blank');
            if (!tab) { showToast('Izinkan pop-up untuk membuka bukti chat, lalu coba lagi.', 'warning'); return; }
            tab.opener = null;
            tab.document.body.textContent = 'Memuat bukti chat…';
            return load('prospek', id).then(() => {
                const source = sumberBuktiChatProspek_(id);
                if (tab.closed) return;
                const url = source.blob ? URL.createObjectURL(source.blob) : source.url;
                tab.location.href = url;
                if (source.blob) setTimeout(() => URL.revokeObjectURL(url), 60000);
            }).catch(error => { tab.close(); failed(error); });
        };
    }
    window.WorkspaceMedia = { prepareTicket, prepareProspect, hasProspectProof, hasStoredFile, load, clear };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
}());
