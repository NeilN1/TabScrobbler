# addons.mozilla.org listing — draft text

Fill these into the AMO developer hub (or `web-ext sign --amo-metadata`) when submitting a listed version.

**Name:** Tab Scrobbler

**Summary** (≤ 250 characters):
Scrobbles what you play in the SiriusXM and Apple Music web players to Last.fm, including while the tab is in
the background. Connect your Last.fm account once; no API key needed.

**Description:**
Tab Scrobbler watches the SiriusXM and Apple Music web players and sends what you listen to to your Last.fm
profile.

- Works while the player tab is in the background — SiriusXM's player normally stops refreshing its display
  when hidden, and Tab Scrobbler keeps it awake.
- Apple Music tracks follow the standard Last.fm rule: half the track or four minutes, whichever comes first.
  Previews and live radio stations are not scrobbled.
- SiriusXM does not publish track lengths, so a song counts after 60 seconds of listening (adjustable).
  Promos, hashtags and phone numbers shown between songs are filtered out.
- Scrobbles queue up if Last.fm is unreachable and are sent later.
- The toolbar popup shows what each player tab is reporting and the most recent scrobbles.

Setup: install, click "Connect to Last.fm" on the settings page, approve access on Last.fm. That's all.

Known limits: SiriusXM talk and sports programmes shown as "Something - Something" will be scrobbled as if
they were songs — switch scrobbling off in the popup for those. Detection depends on the SiriusXM player's
markup and may need an update when the site changes.

Open source (MIT): https://github.com/NeilN1/TabScrobbler

**Categories:** Other (Firefox); optionally Social & Communication.

**Support site:** https://github.com/NeilN1/TabScrobbler/issues

**Homepage:** https://github.com/NeilN1/TabScrobbler

**License:** MIT

**Privacy policy:** paste the contents of `PRIVACY.md`.

**Notes to reviewer:**
Runs only on the Apple Music and SiriusXM web-player URLs listed in the manifest. `page.js` is injected in
the page world ("world": "MAIN") to read the player's own state (Apple's MusicKit instance; SiriusXM's player
bar and Media Session metadata). On the SiriusXM player only, it also reports the tab as visible and runs
animation-frame callbacks on a timer while the tab is hidden, because the SiriusXM player otherwise freezes
its now-playing display in background tabs; this is the extension's core function, not tracking. The Last.fm
application key in `config.js` is the extension's own; users authorise it through Last.fm's standard
token/approve flow. Nothing is minified; the only network destination is ws.audioscrobbler.com.
