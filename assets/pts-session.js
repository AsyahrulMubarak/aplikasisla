/* PTS uses the existing portal session; it never creates a second login. */
(function () {
    'use strict';
    const STORAGE_KEY = 'sesiLoginSLA';
    const AUTH_URL = 'https://oozkqjgllubhjctnkxwl.supabase.co';
    const PUBLIC_KEY = 'sb_publishable_Wa3EUtroPjqwfCkJOyRSSw_MWnMXH6E';
    let refreshPromise = null;
    let activeUsername = '';
    let verifiedUser = null;
    let pendingMutation = null;
    let operationBusy = false;

    function sessionError(message) {
        const error = new Error(message || 'Silakan masuk melalui login Alfacom.');
        error.sessionExpired = true;
        return error;
    }
    function readSession() {
        let session;
        try { session = JSON.parse(sessionStorage.getItem(STORAGE_KEY)); }
        catch { throw sessionError('Sesi Alfacom tidak dapat dibaca.'); }
        const time = Number(session && session.loginTime);
        if (!session || !session.user || !session.user.SessionToken || !session.user.Username ||
            !Number.isFinite(time) || time <= 0 || time > Date.now() + 60000 || Date.now() - time > 86400000) {
            throw sessionError();
        }
        if (activeUsername && activeUsername !== session.user.Username) throw sessionError('Akun Alfacom telah berubah. Buka PTS kembali dari lobby.');
        return session;
    }
    function tokenExpiry(token) {
        try {
            const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return Number(JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).exp) * 1000;
        } catch { return 0; }
    }
    async function fetchJson(url, init, timeoutMs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
            const data = await response.json().catch(() => null);
            if (!data) throw new Error('Respons PTS belum dapat dibaca. Silakan coba kembali.');
            return { response, data };
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Koneksi melewati batas waktu. Coba kembali dengan data yang sama.');
            throw error;
        } finally { clearTimeout(timeout); }
    }
    async function currentToken(forceRefresh = false) {
        const session = readSession();
        if (!forceRefresh && tokenExpiry(session.user.SessionToken) > Date.now() + 60000) return session.user.SessionToken;
        if (!session.user.RefreshToken) {
            if (!forceRefresh && tokenExpiry(session.user.SessionToken) > Date.now()) return session.user.SessionToken;
            throw sessionError();
        }
        if (!refreshPromise) {
            refreshPromise = (async () => {
                const beforeToken = session.user.SessionToken;
                const result = await fetchJson(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, {
                    method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: session.user.RefreshToken })
                }, 15000);
                if (!result.response.ok) {
                    if ([400, 401, 403].includes(result.response.status)) throw sessionError();
                    throw new Error('Pembaruan sesi Alfacom belum tersedia. Silakan coba kembali.');
                }
                if (!result.data.access_token) throw sessionError();
                const latest = readSession();
                if (latest.user.Username !== session.user.Username || latest.user.SessionToken !== beforeToken) {
                    throw sessionError('Sesi berubah ketika diperbarui. Buka kembali PTS dari lobby.');
                }
                // Preserve every existing field, including branch/module selection.
                latest.user.SessionToken = result.data.access_token;
                latest.user.RefreshToken = result.data.refresh_token || latest.user.RefreshToken;
                latest.user.SessionExpiresAt = result.data.expires_at ? Number(result.data.expires_at) * 1000 : tokenExpiry(result.data.access_token);
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
                return latest.user.SessionToken;
            })();
        }
        try { return await refreshPromise; }
        finally { refreshPromise = null; }
    }
    async function request(action, payload) {
        const initial = readSession();
        const write = action === 'saveScenario' || action === 'deleteScenario';
        const body = { action, username: initial.user.Username };
        if (action === 'saveScenario') body.payload = payload;
        if (action === 'deleteScenario') body.scenarioId = payload;
        if (write) {
            const key = JSON.stringify(body);
            if (!pendingMutation || pendingMutation.key !== key) pendingMutation = { key, id: crypto.randomUUID() };
            body.requestId = pendingMutation.id;
        }
        // A single 401 retry may refresh credentials. Network failures on writes
        // are never automatically retried; manual retry retains the request ID.
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = await currentToken(attempt === 1);
            const result = await fetchJson('/api/pts', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body)
            }, 30000);
            if (readSession().user.Username !== initial.user.Username) throw sessionError('Akun Alfacom berubah.');
            if (result.response.status === 401 && attempt === 0) continue;
            if (result.response.status === 401) throw sessionError(result.data.message);
            if (result.response.status === 403) {
                const error = new Error(result.data.message || 'PTS hanya untuk Admin, Manager, dan Direktur.');
                error.accessDenied = true; throw error;
            }
            if (result.response.ok && result.data.success) {
                if (write) pendingMutation = null;
                return result.data;
            }
            if (!result.response.ok && !result.data.message) throw new Error('PTS belum tersedia.');
            return result.data;
        }
        throw sessionError();
    }
    function notifySessionError(error) {
        if (error.sessionExpired || error.accessDenied) {
            verifiedUser = null;
            window.dispatchEvent(new CustomEvent('pts-session-rejected', { detail: error.message }));
        }
    }
    window.PTSAuth = Object.freeze({
        get user() { return verifiedUser; },
        async start() {
            const session = readSession();
            activeUsername = session.user.Username;
            const result = await request('session');
            if (!result.success || !result.user) throw new Error(result.message || 'PTS belum siap.');
            verifiedUser = result.user;
            return verifiedUser;
        },
        async call(action, payload) {
            if (!verifiedUser) throw sessionError();
            const write = action === 'saveScenario' || action === 'deleteScenario';
            if (write && operationBusy) throw new Error('Operasi sebelumnya masih diproses.');
            if (write) operationBusy = true;
            try { return await request(action, payload); }
            catch (error) { notifySessionError(error); throw error; }
            finally { if (write) operationBusy = false; }
        }
    });
})();
