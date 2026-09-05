'use strict';
const { createHmac, randomUUID } = require('node:crypto');
const ACTIONS = new Set(['session', 'getScenarios', 'saveScenario', 'deleteScenario']);
const ROLES = new Set(['admin', 'manager', 'direktur']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 192 * 1024;
const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
function fail(status, message, code) { throw new HttpError(status, message, code); }

function createPtsHandler(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const nonce = options.nonce || randomUUID;
  const authBase = 'https://oozkqjgllubhjctnkxwl.supabase.co';
  // This is a public Supabase publishable key, never a service-role key.
  const publicKey = 'sb_publishable_Wa3EUtroPjqwfCkJOyRSSw_MWnMXH6E';

  async function getJson(url, init, timeout = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const content = await response.text();
      let data;
      try { data = JSON.parse(content); }
      catch { fail(502, 'Layanan PTS belum memberikan respons yang valid.', 'UPSTREAM_INVALID'); }
      return { response, data };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      fail(503, 'Koneksi PTS belum tersedia. Silakan coba kembali.', 'UPSTREAM_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }

  async function readBody(req) {
    let body = req.body;
    if (body === undefined) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > MAX_BODY) fail(413, 'Data PTS terlalu besar.', 'BODY_TOO_LARGE');
        chunks.push(bytes);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > MAX_BODY) fail(413, 'Data PTS terlalu besar.', 'BODY_TOO_LARGE');
      try { body = JSON.parse(body); } catch { fail(400, 'Format permintaan tidak valid.', 'INVALID_BODY'); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Format permintaan tidak valid.', 'INVALID_BODY');
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) fail(413, 'Data PTS terlalu besar.', 'BODY_TOO_LARGE');
    return body;
  }

  async function actorFromToken(token, usernameHint) {
    const headers = { apikey: publicKey, Authorization: `Bearer ${token}` };
    const auth = await getJson(`${authBase}/auth/v1/user`, { headers });
    if ([401, 403].includes(auth.response.status)) fail(401, 'Sesi Alfacom telah berakhir. Silakan masuk kembali.', 'SESSION_EXPIRED');
    if (!auth.response.ok) fail(503, 'Pemeriksaan sesi Alfacom belum tersedia.', 'AUTH_UNAVAILABLE');
    const user = auth.data;
    if (!UUID.test(user.id || '') || typeof user.email !== 'string' || !user.email.toLowerCase().endsWith('@alfacom.local')) {
      fail(403, 'Akun Alfacom tidak dikenali.', 'ACCESS_DENIED');
    }
    const canonical = user.email.slice(0, -'@alfacom.local'.length).toLowerCase();
    let profile = await getJson(`${authBase}/rest/v1/users?username_login=eq.${encodeURIComponent(canonical)}&select=username,nama_asli,role&limit=2`, { headers });
    // Compatibility with the existing portal when username_login migration
    // has not been installed. The hint is only accepted if it matches Auth.
    if (profile.response.status === 400 && ['42703', 'PGRST204'].includes(profile.data?.code)) {
      if (typeof usernameHint !== 'string' || usernameHint.length > 120 || normalize(usernameHint) !== canonical) {
        fail(403, 'Identitas akun Alfacom tidak cocok.', 'ACCESS_DENIED');
      }
      profile = await getJson(`${authBase}/rest/v1/users?username=eq.${encodeURIComponent(usernameHint)}&select=username,nama_asli,role&limit=2`, { headers });
    }
    if (!profile.response.ok) fail(503, 'Profil Alfacom belum dapat diperiksa.', 'PROFILE_UNAVAILABLE');
    if (!Array.isArray(profile.data) || profile.data.length !== 1) fail(403, 'Profil Alfacom tidak ditemukan atau tidak unik.', 'ACCESS_DENIED');
    const record = profile.data[0];
    const role = String(record.role || '').trim().toLowerCase();
    if (normalize(record.username) !== canonical || !ROLES.has(role)) fail(403, 'PTS hanya untuk Admin, Manager, dan Direktur.', 'ACCESS_DENIED');
    return { id: user.id, username: record.username, fullname: String(record.nama_asli || record.username), role };
  }

  return async function ptsHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); fail(405, 'Metode tidak diizinkan.', 'METHOD_NOT_ALLOWED'); }
      const origin = req.headers.origin;
      const allowedOrigins = new Set(['https://aplikasisla.vercel.app']);
      if (env.VERCEL_URL) allowedOrigins.add(`https://${env.VERCEL_URL}`);
      if (env.PTS_DEV_ORIGIN && env.NODE_ENV !== 'production') allowedOrigins.add(env.PTS_DEV_ORIGIN);
      if (origin && !allowedOrigins.has(origin)) fail(403, 'Asal permintaan tidak diizinkan.', 'ORIGIN_DENIED');
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'Gunakan format JSON.', 'CONTENT_TYPE');
      const authorization = String(req.headers.authorization || '');
      const token = authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
      if (!token || token.length > 8192) fail(401, 'Silakan masuk melalui login Alfacom.', 'SESSION_EXPIRED');
      const body = await readBody(req);
      if (!ACTIONS.has(body.action)) fail(400, 'Operasi PTS tidak dikenali.', 'INVALID_ACTION');
      if (env.PTS_ENABLED !== 'true' || !/^[0-9a-f]{64,128}$/i.test(env.PTS_BRIDGE_SECRET || '') ||
          !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.PTS_GAS_URL || '')) {
        fail(503, 'PTS belum diaktifkan. Silakan kembali ke lobby.', 'PTS_NOT_READY');
      }
      const actor = await actorFromToken(token, body.username);
      if (['saveScenario', 'deleteScenario'].includes(body.action) && !UUID.test(body.requestId || '')) fail(400, 'ID permintaan tidak valid.', 'INVALID_REQUEST_ID');
      const payload = body.action === 'saveScenario' ? body.payload :
        body.action === 'deleteScenario' ? { scenarioId: body.scenarioId } : {};
      if (body.action === 'saveScenario' && (!payload || typeof payload !== 'object' || Array.isArray(payload))) fail(400, 'Data skenario tidak valid.', 'INVALID_PAYLOAD');
      const requestBody = JSON.stringify({ audience: 'pts-v1', action: body.action, actor, requestId: body.requestId || nonce(), payload });
      const timestamp = now(); const requestNonce = nonce();
      const signature = createHmac('sha256', env.PTS_BRIDGE_SECRET).update(`${timestamp}.${requestNonce}.${requestBody}`).digest('hex');
      const upstream = await getJson(env.PTS_GAS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, nonce: requestNonce, body: requestBody, signature }),
        redirect: 'follow'
      }, 12000);
      if (!upstream.response.ok || typeof upstream.data?.success !== 'boolean' || upstream.data?.protocol !== 'pts-v1') {
        fail(502, 'Backend PTS belum sesuai. Silakan kembali ke lobby.', 'BACKEND_MISMATCH');
      }
      if (!upstream.data.success) {
        const safeCodes = { INVALID_PAYLOAD: 400, CONFLICT: 409, NOT_FOUND: 404, BUSY: 503, RETRY: 503, CONFIGURATION: 503 };
        const status = safeCodes[upstream.data.code] || 502;
        const message = ['INVALID_PAYLOAD', 'CONFLICT', 'NOT_FOUND', 'BUSY', 'RETRY'].includes(upstream.data.code)
          ? String(upstream.data.message || 'Operasi PTS belum berhasil.').slice(0, 300)
          : 'Backend PTS belum siap. Silakan kembali ke lobby.';
        return send(status, { success: false, code: upstream.data.code || 'BACKEND_ERROR', message });
      }
      // Identity always comes from authenticated Supabase/profile responses.
      if (body.action === 'session') return send(200, { success: true, user: actor });
      return send(200, { success: true, data: upstream.data.data, message: upstream.data.message });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      send(status, { success: false, code: error.code || 'INTERNAL_ERROR', sessionExpired: status === 401,
        message: error instanceof HttpError ? error.message : 'PTS belum dapat memproses permintaan.' });
    }
  };
}
module.exports = { createPtsHandler };
