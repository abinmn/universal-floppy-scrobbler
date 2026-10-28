# Floppy Browser Scrobbler

A focused Chrome/Chromium extension based on the Netflix and JioHotstar playback detection work in [Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler). It sends playback directly to Floppy. No Trakt account, API key, or server is involved.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `floppy-extension` directory.
3. Open the extension popup. Enter your Floppy base URL and the API token from **Settings → Integrations**. Select **Save and test**.
4. Watch a movie or episode in a Netflix or JioHotstar browser tab. The popup reports completed scrobbles or matching errors.

After reloading or updating the extension, refresh any Netflix and JioHotstar tabs that were already open. Chrome invalidates their old content scripts during an extension reload.

If a show has several TMDB matches or Floppy cannot fetch episode metadata, the popup offers a title selector. Check the TMDB links, select the correct show, and choose **Use this match**. The extension saves your selection for future episodes and retries playback without the failing metadata lookup.

The extension requests access to the Floppy origin you enter. The token is held in Chrome's local extension storage and sent only to that origin. It is never sent to Trakt. Use HTTPS for a remote Floppy instance.

## Behavior and limits

- Live browser playback only. It cannot see playback in TV or phone apps. It does not backfill Netflix history.
- Movies use exact TMDB title matching first. For longer titles, a single extra or missing character is accepted only when the release year matches and there is one qualifying result. Episodes require an exact show title and season/episode number. When several shows share a title, the episode title and season/episode numbers must identify one show uniquely. Remaining ambiguous matches are skipped and reported in the popup.
- Floppy records a completed watch when playback ends at 80% or later. Shorter sessions save a resume position without adding a completed watch.
- Streaming sites change their page and player internals. The Netflix metadata API and JioHotstar overlay extraction are based on upstream code as of this fork and may need updates.
- The extension needs Floppy's `/api/v1/search/{movie|tv}/` and `/api/v1/scrobble/` endpoints. It was built against the schema served by `https://floppy.abinmn.dev/api/schema/` on 2026-10-09.

## Attribution

Netflix metadata extraction and JioHotstar DOM parsing were adapted from Universal Trakt Scrobbler's MIT-licensed source. The original copyright and license appear in [LICENSE](LICENSE).
