import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorizeDrive, parseDriveClient, exchangeGoogleToken } from '../src/desktop/google-drive-auth.mjs';
const client = { clientId: '123.apps.googleusercontent.com', clientSecret: 'public-desktop-secret' };

test('developer credentials accept Desktop JSON and reject Web client', () => {
  assert.deepEqual(parseDriveClient({ installed: { client_id: client.clientId, client_secret: client.clientSecret } }), client);
  assert.equal(parseDriveClient({}), null);
  assert.throws(() => parseDriveClient({ web: { client_id: client.clientId } }), /Desktop/);
  assert.throws(() => parseDriveClient({ clientId: 'invalid' }), /Invalid/);
});

test('browser OAuth uses PKCE, account chooser, restricted scope and ignores wrong state', async () => {
  let authUrl;
  const token = await authorizeDrive(client, {
    openExternal: async address => {
      authUrl = new URL(address);
      assert.equal(authUrl.searchParams.get('prompt'), 'select_account consent');
      assert.equal(authUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
      const callback = new URL(authUrl.searchParams.get('redirect_uri'));
      assert.equal(callback.hostname, '127.0.0.1');
      callback.searchParams.set('state', 'invalid');
      callback.searchParams.set('code', 'code');
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', authUrl.searchParams.get('state'));
      assert.equal((await fetch(callback)).status, 200);
    },
    fetchImpl: async (address, options) => {
      assert.equal(address, 'https://oauth2.googleapis.com/token');
      assert.equal(options.body.get('client_id'), client.clientId);
      assert.equal(options.body.get('redirect_uri'), authUrl.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authUrl.searchParams.get('code_challenge'));
      return Response.json({ access_token: 'access', refresh_token: 'refresh' });
    },
  });
  assert.equal(token.refresh_token, 'refresh');
});

test('OAuth can be canceled while browser is open', async () => {
  const controller = new AbortController();
  await assert.rejects(authorizeDrive(client, { signal: controller.signal, openExternal: async () => controller.abort() }), /скасавана/);
});

test('denied access, timeout and browser failure leave no running callback server', async () => {
  await assert.rejects(authorizeDrive(client, { openExternal: async address => {
    const auth = new URL(address), callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', auth.searchParams.get('state'));
    callback.searchParams.set('error', 'access_denied');
    await fetch(callback);
  } }), /access_denied/);
  await assert.rejects(authorizeDrive(client, { openExternal: async () => {}, timeoutMs: 15 }), /скончыўся/);
  await assert.rejects(authorizeDrive(client, { openExternal: async () => { throw new Error('browser unavailable'); } }), /browser unavailable/);
});

test('unconfigured app opens no browser; refresh errors require reconnection', async () => {
  await assert.rejects(authorizeDrive(null, { openExternal: () => assert.fail('opened browser') }), /зборка/);
  await assert.rejects(exchangeGoogleToken(client, { refresh_token: 'expired', grant_type: 'refresh_token' }, { fetchImpl: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) }), /invalid_grant/);
});
