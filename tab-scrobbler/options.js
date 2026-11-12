'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const LastFm = globalThis.LastFm;
  const CONFIG = globalThis.TabScrobblerConfig || {};
  const configured = Boolean(CONFIG.apiKey && CONFIG.apiSecret && !/PASTE_/.test(CONFIG.apiKey + CONFIG.apiSecret));
  const store = api.storage.local;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function status(text, cls) {
    const node = $('status');
    node.textContent = text;
    node.className = 'small ' + (cls || 'muted');
  }

  async function render() {
    const s = await store.get(['sessionKey', 'username', 'unknownSeconds']);
    const connected = Boolean(s.sessionKey);
    const account = $('account');
    if (!configured) {
      account.textContent = 'This build has no Last.fm application key (see config.js), so it cannot connect.';
      account.className = 'bad';
    } else {
      account.textContent = connected ? 'Connected as ' + (s.username || 'unknown') + '.' : 'Not connected.';
      account.className = connected ? 'ok' : 'muted';
    }
    $('setup').hidden = connected || !configured;
    $('connect').hidden = connected;
    $('connect').disabled = !configured;
    $('disconnect').hidden = !connected;
    if (document.activeElement !== $('unknownSeconds')) $('unknownSeconds').value = s.unknownSeconds || 60;
  }

  async function connect() {
    const cfg = { apiKey: CONFIG.apiKey, apiSecret: CONFIG.apiSecret };
    $('connect').disabled = true;
    try {
      status('Contacting Last.fm\u2026');
      const token = await LastFm.getToken(cfg);
      await api.tabs.create({ url: LastFm.authUrl(cfg, token) });
      status('Approve access in the Last.fm tab that just opened. Waiting\u2026');

      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        await sleep(3000);
        try {
          const session = await LastFm.getSession(cfg, token);
          await store.set({ sessionKey: session.key, username: session.name });
          await store.remove(['lastError']);
          api.runtime.sendMessage({ type: 'flush' }).catch(() => {});
          status('Connected.', 'ok');
          await render();
          return;
        } catch (err) {
          if (err.code !== 14) throw err; // 14 = not approved yet
        }
      }
      status('Timed out waiting for approval. Click Connect to try again.', 'bad');
    } catch (err) {
      status(err.message, 'bad');
    } finally {
      $('connect').disabled = !configured;
    }
  }

  async function disconnect() {
    await store.remove(['sessionKey', 'username', 'lastError']);
    status('Disconnected. To revoke access entirely, remove the application under Last.fm \u2192 Settings \u2192 Applications.');
    await render();
  }

  $('connect').addEventListener('click', connect);
  $('disconnect').addEventListener('click', disconnect);
  $('unknownSeconds').addEventListener('change', (e) => {
    const n = Math.min(240, Math.max(30, Math.round(Number(e.target.value) || 60)));
    e.target.value = n;
    store.set({ unknownSeconds: n });
  });

  $('version').textContent = 'v' + api.runtime.getManifest().version;
  render();
})();
