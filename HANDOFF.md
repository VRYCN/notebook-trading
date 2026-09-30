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

## Files in this repo
| File | Role |
|---|---|
| `trade-chat-notebook.html` | The notebook page (UI only). Published earlier as claude.ai artifact https://claude.ai/artifact/MenCBbv4Eix8XDKA3McqxK — Republished with the new version (v3); `core.js` and `collector.js` are published as supporting `files`, so republish all three together. |
| `core.js` | Pure logic (UMD: `window.TCN` / `require`): Bangkok day keys, snowflake sort, export merge/dedupe, health check, search, AI digest + prompts, Drive naming, tags, Markdown export. |
| `collector.js` | `tcnCollector()` — the console script. The page shows `'(' + tcnCollector.toString() + ')();'`, so it must stay self-contained. |
| `apps-script/Code.gs`, `apps-script/Index.html` | Google Apps Script web app (user deploys under own account, "Only myself"). Uploads images to `Drive/Discord-Trade/<channel>/<YYYY-MM-DD>/HHMM_user_msgid_n.ext` (Bangkok time), sets file description = message text, writes `<name>-drive.json` with `drive[]` links. Skips existing filenames. Its naming block mirrors `core.js`; `test/drive-naming.test.js` enforces that. |
| `test/` | `npm install && npm test` (node:test + jsdom). core logic, Drive naming parity, collector against a Discord-shaped DOM fixture, page smoke test incl. mocked `window.claude`. |

## Data format (collector → app)
```json
{"channel":"...","exportedAt":"ISO","messages":[
  {"id":"snowflake","time":"ISO","user":"name","text":"...","reply":"quoted text",
   "imgs":["data:image/jpeg;base64,... or https://cdn.discordapp..."],
   "drive":["https://drive.google.com/file/d/..."]   // added by Apps Script, parallel to imgs
  }]}
```

## Runtime / storage
- Inside claude.ai: capabilities `sample` (AI summary via `sample.json`, images as Blobs, ≤20/call, ~200KB text cap), `db` + `user` (private collection `data/users/<uid>`; docs `kind:"note"` id `n_<msgid>`, `kind:"summary"` id `T.sumKey(channel, day)`; the multi-day overview uses day `*`), `assets` (note images), `downloads`.
- Outside claude.ai (local file, GitHub Pages): notes + summaries persist in IndexedDB (`trade-chat-notebook`/`docs`), downloads use a Blob link, AI summary is disabled (no `window.claude`).
- Backup: library → “สำรองสมุด” writes `{kind:"tcn-backup", notes, summaries}` with images inlined as data URLs; dropping that file on the intake restores it (works in both modes, so it also migrates notes between them).

## Done in this round
- Collector: selectors keyed on the message's own id (`#message-content-<id>` etc.) — the old prefix selector picked up the reply preview's text, which reuses `message-content-<repliedId>`. Accessories-scoped images, emoji/avatars/reply thumbnails excluded, `data-list-item-id` row fallback, late-rendered fields filled on later passes, red badge + `__tcn.diag()` when nothing/partial data is captured, robust channel name from `document.title`.
- App: merge keeps Drive links and data-URL images when a raw export is loaded after a `-drive.json`; day grouping fixed to Asia/Bangkok; continuation authors filled after merging files; per-file health warnings.
- Cross-day: “ค้นทุกวัน” search (multi-term AND), “สรุปวันที่ค้าง” (sequential per-day summaries), “ภาพรวมทุกวัน” (overview built from per-day summaries, text only), note tags with filter chips, tags in Markdown export.

## Known risks / unverified
- Collector DOM selectors are tested only against a hand-built fixture (`test/collector.test.js`), not the live Discord build. First real run: check the badge colour and `__tcn.diag()`; if wrong, fix `read()` in `collector.js` and update the fixture to the real markup.
- `fetch()` of `media.discordapp.net` from discord.com for data-URL conversion may fail on CORS → falls back to raw URL (Apps Script then fetches it server-side via UrlFetchApp, same day only).
- Summary/backlog flow tested only with a mocked `sample`; real prompt quality unverified.

## Next steps
1. Run the collector on the real channel; adjust selectors + fixture.
2. Hosting: decided to stay on the claude.ai artifact (keeps AI summary and cloud notes). GitHub Pages remains a fallback; the page works there without AI.
3. Optionally merge the Drive step into the app flow (Apps Script serving the notebook, or a Python script with the Drive API on the user's personal PC).
4. Apps Script: batch several images per `google.script.run` call and cache folder lookups if 300+ images/day is slow.

## Suggested skills
- `frontend-design` — any UI changes.
- `engineering:debug` — fixing collector selectors against live Discord DOM.
- `engineering:testing-strategy` — tests for parsing/dedupe/Drive naming.
- `google-workspace` — if extending the Drive/Apps Script side.
- `kien-thai` — Thai UI copy and summary prompt wording.
- `humanizer` not needed; `docs` only if user asks for written documentation.
