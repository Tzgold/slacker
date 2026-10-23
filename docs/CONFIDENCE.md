# Slacker readiness (2026-10-15)

## What passed locally

- `npm test` → **16/16**
  - Message id validation / rejection of injection-like ids
  - HTML escape for popup previews
  - Worker: `/ping`, `/privacy`, invalid pixel rejected, no IP stored, status strips legacy IP, POST 405, manifest hygiene
- Store package: `slacker-store-1.3.8.zip`
- Extension hardened: beacon/track validate message ids; polling filters invalid ids; access is limited to `app.slack.com`

## What’s blocking “sure it works”

1. **Deploy** hardened `worker/index.js` — live site still old (`/privacy` 404, bad pixel ids accepted, status may include `ip`).
2. **Two-browser Seen** — you + friend (or two Chrome profiles) after both have the extension.

## Submit path

1. Deploy Worker → confirm `https://slacker.tzgold.workers.dev/privacy` returns HTML  
2. Chrome Web Store → upload `slacker-store-1.3.8.zip`  
3. Privacy policy URL = that `/privacy` link  
4. After approval → friend installs → DM test  
5. If ticks fail → fix → bump `manifest.json` version → new zip
