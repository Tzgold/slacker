# Slacker — Slack Read Receipts

A Chrome extension that injects read receipts into Slack, showing you when messages have been seen.

---

## How it works

1. When you send a message, `content.js` detects it via a `MutationObserver` on Slack's DOM.
2. It injects a 1×1 invisible pixel `<img>` into the message, pointing at your Cloudflare Worker.
3. When the recipient opens that conversation, their browser loads the pixel, which hits your worker and records a "seen" event in Workers KV.
4. `background.js` schedules checks while `content.js` securely requests Seen updates from the worker.
5. A **"✓✓ Seen 10:43"** pill appears under your message in Slack's UI.

---

## Project structure

```
slacker/
├── manifest.json      # Extension manifest (MV3)
├── content.js         # DOM observer + pixel injection + pill UI
├── background.js      # Service worker — polls worker, updates badge
├── popup.html         # Extension popup (settings + receipt history)
├── popup.js
├── styles.css         # Pill styles injected into slack.com
├── icons/             # Extension icons (add 16, 48, 128 px PNGs)
└── worker/
    ├── index.js       # Cloudflare Worker (pixel + status endpoints)
    └── wrangler.toml  # Wrangler deploy config
```

---

## Setup

**Full step-by-step guide:** see [SETUP.md](SETUP.md)

### Quick start (backend)

```powershell
cd worker
npm install
.\deploy.ps1
```

Or manually: `wrangler login` → create KV → paste id in `wrangler.toml` → `wrangler deploy`

Your worker URL will be something like `https://slacker.<yourname>.workers.dev`.

---

### 2. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder (`slacker/`)
4. The Slacker icon will appear in your toolbar

---

### 3. Configure the worker URL

1. Click the Slacker icon in Chrome
2. Paste your worker URL into the input field
3. Click **Save** — the green dot confirms the connection

---

## Notes

- **Privacy**: the pixel only fires once per message (first open). The worker stores a temporary message identifier and Seen timestamp, not the user's IP address or full message content.
- **DOM selectors**: Slack's React app changes frequently. If pills stop appearing, the selectors in `content.js` (`[data-qa="message_container"]`, `[data-ts]`, etc.) may need updating.
- **Alarms**: Chrome's minimum alarm interval is 1 minute in production. The 30-second poll works in dev mode (unpacked extension).
