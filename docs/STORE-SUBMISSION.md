# Chrome Web Store — Slacker submission

## Package (what to upload)

Zip **only** these (no `worker/node_modules`, no `.git`):

```
manifest.json
background.js
content.js
page-inject.js
popup.html
popup.css
popup.js
styles.css
icons/icon16.png
icons/icon48.png
icons/icon128.png
fonts/*.woff2
```

From PowerShell (project root):

```powershell
Compress-Archive -Path manifest.json,background.js,content.js,page-inject.js,popup.html,popup.css,popup.js,styles.css,icons,fonts -DestinationPath slacker-store-1.3.8.zip -Force
```

## Store listing (copy/paste)

**Name:** Slacker — Slack Read Receipts

**Short description:**  
Telegram-style send/seen checks on your Slack messages when both people use Slacker.

**Detailed description:**

```
Slacker adds quiet send/seen ticks next to your Slack messages in Chrome.

How it works
• One check = your message was sent and tracked
• Two checks = the other person also has Slacker and opened that chat

Important
• Both people need Slacker installed for Seen to work
• Slack does not provide official read receipts; Slacker only works between Slacker users
• No message tracker is injected into the text other people see

Privacy
• We store temporary message ids + seen times on our Cloudflare Worker
• Full chat content is not uploaded to our server
• Privacy policy: https://slacker.tzgold.workers.dev/privacy
```

**Category:** Productivity  
**Language:** English  

**Privacy policy URL (required):**  
`https://slacker.tzgold.workers.dev/privacy`

## Permission justifications (review form)

| Permission | Why |
|------------|-----|
| `storage` | Save receipt history and user id locally |
| `alarms` | Poll for Seen updates in the background |
| Site access `app.slack.com` | Inject ticks, detect sends, and report Seen in Slack Web |

## Single purpose

Provide optional send/seen indicators for Slack web users who install Slacker.

## After publish

1. Friend installs from Web Store  
2. Both open Slack in Chrome  
3. You send a DM → one check  
4. Friend opens the DM → your ticks become double (teal)  
5. If broken → fix → bump version → upload new zip (same listing)

## Deploy hardened Worker first (required)

Live Worker must serve `/privacy` before you submit (store needs that URL).

```powershell
cd C:\Users\Admin\Documents\slacker\worker
npx wrangler login
npx wrangler deploy
curl.exe -sS https://slacker.tzgold.workers.dev/privacy
# expect HTML (not 404)
```

If `wrangler` says auth token 400: run `npx wrangler logout`, delete stale oauth, then `npx wrangler login` again.

## Automated tests

```powershell
cd C:\Users\Admin\Documents\slacker
npm test
```

Expect **17 passed** (validation + worker security + manifest hygiene + popup state).

## Store zip

Already built: `slacker-store-1.3.8.zip` (or `npm run pack:store`).

## Honest confidence

| Area | Status | Confidence |
|------|--------|------------|
| Unit + worker security tests | 16/16 pass | **95%** |
| Extension MV3 / narrow hosts / no IP in new code | Audited | **90%** |
| Icons store-sized | Done | **100%** |
| Privacy URL live | Needs `wrangler deploy` | **blocked until deploy** |
| Local Simulate Seen path | Code ready | **85%** |
| Real two-user Seen | Friend / 2 profiles | **~70% until proven** |

**Overall before deploy:** ~75% ready for store.  
**After deploy + `/privacy` 200:** ~85% — submit.  
**After friend Seen works:** ~95%.

You can submit once `/privacy` is live. Friend install is the final proof; if broken, bump version and re-upload.
