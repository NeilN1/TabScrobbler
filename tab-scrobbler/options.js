'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const LastFm = globalThis.LastFm;
  const store = api.storage.local;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function status(text, cls) {
    const node = $('status');
    node.textContent = text;
    node.className = 'small ' + (cls || 'muted');
  }

  async function render() {
    const s = await store.get(['apiKey', 'apiSecret', 'sessionKey', 'username', 'unknownSeconds']);
    const connected = Boolean(s.sessionKey);
    $('account').textContent = connected ? 'Connected as ' + (s.username || 'unknown') + '.' : 'Not connected.';
    $('account').className = connected ? 'ok' : 'muted';
    $('setup').hidden = connected;
    $('connect').hidden = connected;
    $('disconnect').hidden = !connected;
    if (document.activeElement !== $('apiKey')) $('apiKey').value = s.apiKey || '';
    if (document.activeElement !== $('apiSecret')) $('apiSecret').value = s.apiSecret || '';
    if (document.activeElement !== $('unknownSeconds')) $('unknownSeconds').value = s.unknownSeconds || 60;
  }

  async function connect() {
    const cfg = { apiKey: $('apiKey').value.trim(), apiSecret: $('apiSecret').value.trim() };
    if (!cfg.apiKey || !cfg.apiSecret) {
      status('Enter both the API key and the shared secret.', 'bad');
      return;
    }
    $('connect').disabled = true;
    try {
      await store.set(cfg);
      status('Contacting Last.fm…');
      const token = await LastFm.getToken(cfg);
      await api.tabs.create({ url: LastFm.authUrl(cfg, token) });
      status('Approve access in the Last.fm tab that just opened. Waiting…');

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
      $('connect').disabled = false;
    }
  }

  async function disconnect() {
    await store.remove(['sessionKey', 'username', 'lastError']);
    status('Disconnected. To revoke access entirely, remove the application under Last.fm → Settings → Applications.');
    await render();
  }

  $('connect').addEventListener('click', connect);
  $('disconnect').addEventListener('click', disconnect);
  $('unknownSeconds').addEventListener('change', (e) => {
    const n = Math.min(240, Math.max(30, Math.round(Number(e.target.value) || 60)));
    e.target.value = n;
    store.set({ unknownSeconds: n });
  });

  render();
})();
