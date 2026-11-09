# Tab Scrobbler

Scrobbles what you play in the SiriusXM and Apple Music web players to Last.fm.
The same folder loads in Firefox (140+) and in Chrome or Edge.

Source: <https://github.com/NeilN1/TabScrobbler>

## Install

### Firefox

Firefox only keeps unsigned extensions until it restarts, so there are two routes.

**Try it now (lasts until Firefox closes)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` in this folder.

**Keep it installed** — have Mozilla sign it for private use (free, automated, takes a minute or two):

1. Sign in at <https://addons.mozilla.org/developers/addon/api/key/> and generate API credentials
   (a *JWT issuer* that looks like `user:12345678:987`, and a *JWT secret*).
2. Store them once, encrypted to your Windows account (username = issuer, password = secret):

   ```powershell
   Get-Credential -Message "Mozilla add-ons API" | Export-Clixml "$env:USERPROFILE\.web-ext-amo.xml"
   ```

3. Bump `"version"` in `manifest.json` (Mozilla will not sign the same version twice), then from the
   repository root run `.\sign.ps1`. It hands the credentials to `web-ext` only for that command.
   On other platforms, put them in the `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` environment variables
   and run `npx web-ext sign --channel=unlisted` from this folder; avoid passing the secret on the command
   line, where shell history keeps it.
4. Open the `.xpi` it writes to `web-ext-artifacts/` in Firefox.

If nothing is detected after installing, check `about:addons` → Tab Scrobbler → **Permissions** and make sure
access to the Apple Music and SiriusXM sites is switched on.

### Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`) and switch on **Developer mode**.
2. Click **Load unpacked** and pick this folder. It stays installed across restarts.

Chrome shows a harmless warning about the `browser_specific_settings` key, which is Firefox-only.

## Connect Last.fm

The settings page opens on first install (later: toolbar icon → **Settings**).

1. Create a free API account at <https://www.last.fm/api/account/create>. Any name works; leave the callback URL empty.
2. Paste the **API key** and **shared secret** into the settings page.
3. Click **Connect to Last.fm** and approve access in the tab that opens.

Reload any SiriusXM or Apple Music tab that was already open, then play something. The toolbar popup shows what
each player tab is reporting, how close the current track is to being scrobbled, and the most recent scrobbles.

## How it decides

- **Apple Music** — reads the page's MusicKit player for title, artist, album, length and play state. A track
  scrobbles after half its length or four minutes of listening, whichever comes first. Tracks under 30 seconds,
  30/90-second previews and live radio stations are not scrobbled.
- **SiriusXM** — reads the "Artist - Title" line in the player bar, falling back to the browser's Media Session
  metadata. SiriusXM gives no track length, so a track scrobbles after 60 seconds of listening (adjustable in
  settings). Lines that look like promos, social handles or phone numbers are skipped.
- Paused time never counts. If Last.fm is unreachable, scrobbles wait in a queue and are retried every five minutes
  for up to two weeks.
- The SiriusXM player stops refreshing its now-playing display while its tab is hidden, so on SiriusXM pages the
  extension makes the page believe the tab is always visible (it reports `document.hidden` as false, keeps
  `visibilitychange` from reaching the page, and runs animation-frame callbacks on a timer while hidden).

## Known limits

- SiriusXM talk, sports and podcast content shown as "Something - Something" will be scrobbled as if it were a
  song. Use the **Scrobbling on** switch in the popup when listening to those.
- If SiriusXM changes its player markup, detection will stop. The popup's **What the page reports** section shows
  the raw text the extension sees, which is what is needed to fix it.

## Files

| File | Role |
| --- | --- |
| `page.js` | Runs inside the page; reads the player once a second |
| `tracker.js` | Works out when a track has been played enough |
| `content.js` | Connects the two above to the background script |
| `background.js` | Sends now-playing and scrobbles to Last.fm; owns the retry queue |
| `lastfm.js`, `md5.js` | Last.fm API client and the MD5 it needs for request signing |
| `popup.*`, `options.*`, `ui.css` | Toolbar popup and settings page |

Tests for the signing and timing logic live in `../tests/run.js` (`node tests/run.js` from the parent folder).

## License

MIT — see `../LICENSE`.
