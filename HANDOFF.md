# Handoff: สมุดสรุปห้องเทรด (Discord trading-chat collector + summarizer + notebook)

## Goal
User (Thai, intraday XAU/USD trader) reads a busy Discord trading-study channel (300+ msgs/day, often days of backlog, members post chart images explaining methods). User is NOT server owner/admin and does NOT want to contact admins.
Wants: (1) collect messages + images by timestamp, (2) AI summary per day, (3) save useful messages/images to a searchable notebook, (4) images stored permanently in Google Drive with Drive links replacing expiring Discord links.

## Hard constraints (keep these)
- **No self-bot / user-token / automated scrolling.** Discord ToS forbids automating user accounts. The collector is passive: the user scrolls manually; a MutationObserver records what renders. Do not add auto-scroll, API calls with the user's token, or Playwright driving the Discord account.
- Discord virtualizes the message list (only ~50–150 msgs in DOM) → must capture continuously and dedupe by message ID (snowflake; sort with BigInt).
- Discord CDN image links expire ~24h → convert to data URLs at capture time, or push to Drive same day.
- Discord page CSP blocks sending data to other hosts → Drive upload happens in a separate page, not from discord.com.
- User's work PC: no admin rights, cannot install software/extensions. Browser-only paths preferred.
- UI/output language: Thai.

## Files in this folder
| File | Role |
|---|---|
| `trade-chat-notebook.html` | Published claude.ai artifact (https://claude.ai/artifact/MenCBbv4Eix8XDKA3McqxK). Contains the collector script (const `COLLECTOR`), JSON intake, per-day view, AI summary, ★ notebook. |
| `apps-script/Code.gs`, `apps-script/Index.html` | Google Apps Script web app (user deploys under own account, "Only myself"). Uploads images to `Drive/Discord-Trade/<channel>/<YYYY-MM-DD>/HHMM_user_msgid_n.ext`, sets file description = message text, writes `<name>-drive.json` with `drive[]` links. Skips existing filenames. |

## Data format (collector → app)
```json
{"channel":"...","exportedAt":"ISO","messages":[
  {"id":"snowflake","time":"ISO","user":"name","text":"...","reply":"quoted text",
   "imgs":["data:image/jpeg;base64,... or https://cdn.discordapp..."],
   "drive":["https://drive.google.com/file/d/..."]   // added by Apps Script, parallel to imgs
  }]}
```

## Artifact runtime specifics (only relevant if staying on claude.ai artifacts)
- Capabilities declared: `sample` (AI summary via `sample.json`, images as Blobs, ≤~20/call, ~200KB text cap applied), `db` + `user` (private collection `data/users/<uid>`; docs `kind:"note"` id `n_<msgid>`, `kind:"summary"` id `s_<hash(channel)>_<day>`), `assets` (saved note images), `downloads` (Markdown export).
- Published page CSP: no remote images, no fetch to other hosts → Drive links shown as links, not thumbnails.
- Outside claude.ai (e.g. local file / GitHub Pages) `window.claude` is absent: summary disabled, notes kept only in memory. **A Claude Code port must replace these** (see next steps).

## Known risks / unverified
- Collector DOM selectors (`li[id^="chat-messages-"]`, `[id^="message-content-"]`, `[class*="username_"]`, `[class*="imageWrapper"]`, `[class*="mediaAttachmentsContainer"]`, `time[datetime]`) are untested against the live Discord build; class names change often.
- `fetch()` of `media.discordapp.net` from discord.com for data-URL conversion may fail on CORS → falls back to raw URL (Apps Script then fetches it server-side via UrlFetchApp).
- Grouped (continuation) messages have no username; filled from previous message after sorting.
- Nothing end-to-end tested with real exports yet.

## Suggested next steps (for Claude Code)
1. Test collector on a real channel; fix selectors; add a small selector-health check (warn if 0 messages captured).
2. Decide hosting: keep the claude.ai artifact, or port to a standalone app (GitHub Pages under user's account VRYCN, or a local Python/Flask tool) using the Anthropic API directly + IndexedDB/SQLite for notes. If porting, keep API key out of client code.
3. Optionally merge the Drive step into the app flow (e.g. Apps Script also serves the notebook, or a Python script using Drive API on the user's personal PC).
4. Cross-day features: multi-day backlog summary, search across all days, tag notes by setup/timeframe.
5. Write tests for JSON merge/dedupe and day grouping (local timezone Asia/Bangkok).

## Suggested skills
- `frontend-design` — any UI changes.
- `engineering:debug` — fixing collector selectors against live Discord DOM.
- `engineering:testing-strategy` — tests for parsing/dedupe/Drive naming.
- `google-workspace` — if extending the Drive/Apps Script side.
- `kien-thai` — Thai UI copy and summary prompt wording.
- `humanizer` not needed; `docs` only if user asks for written documentation.
