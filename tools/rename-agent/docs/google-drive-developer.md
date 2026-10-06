# Google Drive: one-time application setup

This is a File Garden developer task, never an end-user setup requirement.

Register a single OAuth application for File Garden in the developer-owned Google project. Enable Google Drive API, configure the consent screen, and create a **Desktop app** OAuth client. Download its JSON to `config/google-drive-client.json`. This local file is ignored by Git. Web credentials are rejected. A desktop client secret, if provided by Google, is bundled with the public desktop application; it must not be treated as a confidential server secret.

Run `npm run drive:check` before distributing a release with Google Drive support. `gui:build` and `gui:dev` normalize the configuration into `electron/google-drive-client.json`, included in the Electron bundle. No `.env` or user-entered client credentials are used. Without developer configuration the application builds, but the connection button is unavailable and explains that an application update is needed.

Use scope `https://www.googleapis.com/auth/drive.file`. Authorization uses the system browser, an account chooser, PKCE S256, and a random-port loopback callback bound to 127.0.0.1. The application can access its own created files, not arbitrarily browse all user Drive documents. Refresh tokens are encrypted using Electron safeStorage and bound to the bundled client ID. Changing the app client requires reconnecting.

For distribution, move the consent app to the appropriate production status and complete any Google-required brand/verification steps. External apps in Testing can have seven-day refresh token expiry. Test accounts must be permitted while testing.

Before claiming live support, test with a real account: connect, cancel, switch accounts, restart and reconnect from the saved token, copy sorted PDF/DOCX/images, check folder/category and MIME types in Drive, retry same filenames, and disconnect. Unit tests simulate OAuth and uploads and do not prove that the registered Google project is configured correctly.

Official references: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
