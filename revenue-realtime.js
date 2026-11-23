(function () {
    'use strict';
    const tables = ['tiket', 'penjualan', 'garansi', 'users', 'prospek', 'sla_performance_revision'];
    const dashboardRoles = ['admin', 'admin_raha', 'manager', 'direktur', 'sales', 'teknisi', 'freelance'];
    const technician = role => ['teknisi', 'freelance'].includes(role);
    const debounceMs = 350, healthMs = 15000, maxAgeMs = 60000;
    let state = null, healthTimer = null, observer = null;
    const shown = el => !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
    function context() {
        if (typeof penggunaAktif === 'undefined' || !penggunaAktif?.SessionToken) return null;
        const user = penggunaAktif, role = rolePengguna(user);
        if (!dashboardRoles.includes(role)) return null;
        const lobby = shown(document.getElementById('main-lobby-wrapper'));
        const view = lobby ? 'lobby' : shown(document.getElementById('app-wrapper')) ? 'workspace' : '';
        const branch = normalisasiCabang(lobby ? document.getElementById('lobby-cabang')?.value : cabangAktif);
        if (!view || !branch || !penggunaBolehMengaksesCabang(branch, user)) return null;
        const key = [user.Username, role, user.Hak_Akses_Cabang, view, branch].join('|');
        return { user, key, branch, view, role };
    }
    const valid = s => !!s && state === s && context()?.key === s.ctx.key && context()?.user === s.ctx.user;
    function relevant(payload, branch) {
        if (!payload || !tables.includes(payload.table)) return false;
        if (payload.table === 'users') return true;
        const before = normalisasiCabang(payload.old?.cabang), after = normalisasiCabang(payload.new?.cabang);
        if (before === branch || after === branch) return true;
        // Default replica identity omits old branch on UPDATE/DELETE. A record
        // may have left this branch; reread its scoped sources to remove it.
        if (payload.eventType === 'DELETE' && !before) return true;
        if (payload.eventType === 'UPDATE' && !before) return true;
        return !before && !after;
    }
    function removeLobbyChannel(s) {
        const client = s.client, channel = s.channel;
        s.client = null; s.channel = null; s.connected = false;
        if (client && channel) {
            try { Promise.resolve(client.removeChannel(channel)).catch(() => {}); } catch {}
        }
    }
    function stop() {
        const s = state; state = null;
        if (!s) return;
        clearTimeout(s.timer); clearTimeout(s.retryTimer);
        s.job?.abort?.();
        removeLobbyChannel(s);
    }
    function queue(s, delay = debounceMs) {
        if (!valid(s)) return;
        s.dirty = true;
        if (s.job || s.timer || document.hidden) return;
        s.timer = setTimeout(() => { s.timer = null; void drain(s); }, delay);
    }
    async function drain(s) {
        if (!valid(s) || s.job || !s.dirty || document.hidden) return;
        if (s.ctx.view === 'workspace' && typeof permintaanDataAktif_ !== 'undefined' && permintaanDataAktif_?.promise) {
            trackExternal(s, permintaanDataAktif_.promise);
        }
        if (s.external) return;
        // A page restored before this deferred script installed can already
        // have its initial lobby GET running. Let that read finish first.
        if (s.ctx.view === 'lobby' && typeof permintaanRingkasanLobby_ !== 'undefined' && permintaanRingkasanLobby_ && !permintaanRingkasanLobby_.signal.aborted) {
            s.timer = setTimeout(() => { s.timer = null; void drain(s); }, debounceMs);
            return;
        }
        s.dirty = false;
        const job = { abort: null }; s.job = job;
        let ok = false;
        try {
            // A dashboard rerender must never reuse a score cached before the
            // database notification. The subsequent render reads this revision.
            window.SLAAchievementScore?.invalidate({ defer: true });
            let work;
            if (s.ctx.view === 'lobby') {
                work = muatRingkasanLobby_();
                const controller = typeof permintaanRingkasanLobby_ === 'undefined' ? null : permintaanRingkasanLobby_;
                job.abort = () => controller?.abort();
            } else {
                work = ambilSemuaData(true, null, { paksaBaru: true });
                const controller = typeof permintaanDataAktif_ === 'undefined' ? null : permintaanDataAktif_?.controller;
                job.abort = () => controller?.abort();
            }
            ok = (await work) !== false;
            if (valid(s)) {
                void window.SLAAchievementScore?.refresh();
                if (s.ctx.view === 'lobby' && window.SLACreditLobby) {
                    ok = (await window.SLACreditLobby.refresh(true)) !== false && ok;
                }
            }
            if (ok && valid(s)) { s.lastSuccess = Date.now(); s.readFailures = 0; }
        } catch (error) {
            if (valid(s)) console.warn('[DASHBOARD REALTIME] Pembaruan belum berhasil:', error?.message || 'Koneksi terputus.');
        } finally {
            s.job = null;
            if (valid(s)) {
                if (!ok) { s.dirty = true; s.readFailures++; }
                if (s.dirty) queue(s, ok ? debounceMs : Math.min(15000, 1000 * 2 ** Math.min(s.readFailures, 4)));
            }
        }
    }
    function reconnectLobby(s) {
        if (!valid(s) || s.retryTimer) return;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(s.connectionFailures++, 5));
        s.retryTimer = setTimeout(() => {
            s.retryTimer = null;
            if (!valid(s)) return;
            removeLobbyChannel(s); void connectLobby(s);
        }, delay);
    }
    async function connectLobby(s) {
        if (!valid(s) || s.ctx.view !== 'lobby' || s.connecting || s.channel || !window.supabase?.createClient) return;
        s.connecting = true;
        try {
            const token = await pastikanTokenSupabaseAktif_();
            if (!valid(s)) return;
            const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });
            await client.realtime.setAuth(token);
            if (!valid(s)) return;
            const channel = client.channel('sla-lobby-revenue-' + s.ctx.branch.toLowerCase() + '-' + String(s.ctx.user.Username).replace(/[^a-z0-9_-]/gi, '-'));
            s.client = client; s.channel = channel; s.lastAuth = Date.now();
            const subscribed = technician(s.ctx.role) ? tables.filter(table => !['penjualan', 'prospek'].includes(table)) : tables;
            subscribed.forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
                if (valid(s) && s.channel === channel && relevant(payload, s.ctx.branch)) queue(s);
            }));
            channel.subscribe(status => {
                if (!valid(s) || s.channel !== channel) return;
                if (status === 'SUBSCRIBED') {
                    s.connected = true; s.connectionFailures = 0;
                    // Catch events committed while the initial GET or reconnect
                    // was in flight, rather than relying on replayed events.
                    queue(s);
                } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
                    s.connected = false; reconnectLobby(s); queue(s);
                }
            });
        } catch (error) {
            if (valid(s)) { removeLobbyChannel(s); reconnectLobby(s); }
        } finally { s.connecting = false; }
    }
    function reconcile() {
        const ctx = context();
        if (!ctx) { stop(); return; }
        if (!state || state.ctx.key !== ctx.key || state.ctx.user !== ctx.user) {
            stop();
            state = { ctx, dirty: false, timer: null, retryTimer: null, job: null, client: null, channel: null,
                connecting: false, connected: false, connectionFailures: 0, readFailures: 0, lastSuccess: Date.now(), lastAuth: 0, external: null };
        }
        if (state.ctx.view === 'lobby' && !state.retryTimer) void connectLobby(state);
    }
    function notify(payload, branch) {
        reconcile();
        const s = state;
        if (!s || s.ctx.view !== 'workspace' || s.ctx.branch !== normalisasiCabang(branch) || !relevant(payload, s.ctx.branch)) return false;
        queue(s); return true;
    }
    function reconnected(branch) {
        reconcile();
        if (state?.ctx.view === 'workspace' && state.ctx.branch === branch) { state.connected = true; queue(state); }
    }
    async function health() {
        reconcile(); const s = state;
        if (!s || document.hidden) return;
        const disconnected = s.ctx.view === 'lobby' ? !s.connected : typeof kanalRealtimeSLA_ === 'undefined' || kanalRealtimeSLA_?.state !== 'joined';
        if (s.dirty || disconnected || Date.now() - s.lastSuccess > maxAgeMs) queue(s);
        if (s.ctx.view === 'lobby' && s.client && Date.now() - s.lastAuth > 240000) {
            try { const token = await pastikanTokenSupabaseAktif_(); if (valid(s) && s.client) { await s.client.realtime.setAuth(token); s.lastAuth = Date.now(); } }
            catch { if (valid(s)) reconnectLobby(s); }
        } else if (s.ctx.view === 'workspace' && disconnected) {
            Promise.resolve(mulaiRealtimeSLA_()).catch(() => {});
        }
    }
    function wake() { reconcile(); if (state && !document.hidden) queue(state, 0); }
    function trackExternal(s, work) {
        s.external = work;
        const settled = () => { if (s.external === work) s.external = null; if (valid(s) && s.dirty) queue(s); };
        work.then(settled, settled);
    }
    function install() {
        for (const [name, view] of [['muatRingkasanLobby_', 'lobby'], ['ambilSemuaData', 'workspace']]) {
            const original = window[name];
            if (typeof original !== 'function') continue;
            window[name] = function (...args) {
                reconcile(); const s = state, work = original.apply(this, args);
                if (s?.ctx.view === view && !s.job && work?.then) trackExternal(s, work);
                return work;
            };
            Object.assign(window[name], original);
        }
        observer = new MutationObserver(reconcile);
        for (const id of ['main-lobby-wrapper', 'app-wrapper']) {
            const el = document.getElementById(id);
            if (el) observer.observe(el, { attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden'] });
        }
        document.addEventListener('change', event => {
            if (['lobby-cabang', 'lobby-periode'].includes(event.target?.id)) { reconcile(); if (state) queue(state); }
        });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
        window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener('pagehide', stop);
        healthTimer = setInterval(() => { void health(); }, healthMs);
        reconcile();
    }
    window.SLARevenueLiveSync = { notify, reconnected, reconcile, clear: stop,
        snapshot: () => state ? { view: state.ctx.view, branch: state.ctx.branch, connected: state.connected,
            queued: state.dirty, reading: !!state.job, lastSuccess: state.lastSuccess } : null };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
}());
