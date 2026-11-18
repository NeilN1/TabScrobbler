# Tab Scrobbler

A Firefox (and Chrome/Edge) extension that scrobbles what you play in the SiriusXM, Apple Music,
AccuRadio and YouTube Music web players to Last.fm.

**Install for Firefox:** [Tab Scrobbler on addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/055f5b33a2434c7ea433/)

- **[tab-scrobbler/](tab-scrobbler/)** — the extension, with install and setup instructions in its
  [README](tab-scrobbler/README.md)
- **[tests/](tests/)** — Node tests for the Last.fm signing and scrobble-timing logic (`node tests/run.js`)
- **[release.ps1](release.ps1)** — releases a version to addons.mozilla.org and GitHub together, so the
  version numbers match: `.\release.ps1 -Notes "What changed"` (add `-DryRun` to preview)
- **[sign.ps1](sign.ps1)** — signs a build with Mozilla for private installation
- **[PRIVACY.md](PRIVACY.md)** — what the extension reads, sends and stores
- **[listing.md](listing.md)** — draft text for an addons.mozilla.org listing

MIT licensed.
