import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export function parseDriveClient(value) {
  if (value.web) throw new Error('Google Drive requires Desktop OAuth credentials, not Web credentials');
  const source = value.installed || value;
  const clientId = source.client_id || source.clientId || '';
  const clientSecret = source.client_secret || source.clientSecret || '';
  if (!clientId) return null;
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Invalid Google OAuth client ID');
  return { clientId, clientSecret };
}

export async function exchangeGoogleToken(client, parameters, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...parameters }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth: ${data.error_description || data.error || `HTTP ${response.status}`}`);
  return data;
}

export async function authorizeDrive(client, { openExternal, signal, fetchImpl = fetch, timeoutMs = 180000 }) {
  if (!client?.clientId) throw new Error('Гэта зборка яшчэ не мае падключэння Google Drive. Патрэбна абнаўленне File Garden.');
  signal?.throwIfAborted();
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const authorization = await new Promise((resolve, reject) => {
    let redirectUri, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      server.close();
      error ? reject(error) : resolve(value);
    };
    const cancel = () => finish(new Error('Падключэнне Google Drive скасавана'));
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') { response.writeHead(404).end(); return; }
      if (url.searchParams.get('state') !== state) { response.writeHead(400).end('Invalid state'); return; }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      response.writeHead(error || !code ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<h2>Вярніся ў File Garden</h2><p>Можна закрыць гэту старонку.</p>');
      finish(error || !code ? new Error(`Google: ${error || 'authorization code missing'}`) : null, { code, redirectUri });
    });
    server.on('error', error => finish(error));
    signal?.addEventListener('abort', cancel, { once: true });
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return; }
      redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const params = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'select_account consent', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state });
      Promise.resolve().then(() => openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)).catch(error => finish(error));
    });
    timer = setTimeout(() => finish(new Error('Час чакання ўваходу ў Google скончыўся')), timeoutMs);
  });
  const token = await exchangeGoogleToken(client, { code: authorization.code, redirect_uri: authorization.redirectUri, code_verifier: verifier, grant_type: 'authorization_code' }, { fetchImpl, signal });
  if (!token.refresh_token) throw new Error('Google не даў пастаянны доступ. Падключы акаўнт нанова.');
  return token;
}
