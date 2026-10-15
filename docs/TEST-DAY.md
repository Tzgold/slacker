# Finish & Test Day — Slacker

## Where we are (ready)

| Piece | Status |
|--------|--------|
| Chrome extension (popup + ticks) | Ready — v1.2.1 |
| Cloudflare Worker | Live — `https://slacker.tzgold.workers.dev` |
| Product model | Slacker ↔ Slacker only for real Seen |
| Repo | Clean on `main` |

**What “done” means today**

1. Extension loads and shows **Connected**
2. Sending a Slack message shows **one grey check** (Sent)
3. Second account with Slacker opens that DM → **two teal checks** (Seen)
4. Popup lists Sent / Seen correctly

---

## Part A — Load & smoke (5 minutes, one profile)

Do this on your **main** Chrome profile.

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. If Slacker is already there → click **Reload**
4. If not → **Load unpacked** → `C:\Users\Admin\Documents\slacker`
5. Open Slack in Chrome → **Ctrl+Shift+R**
6. Click Slacker icon
7. Confirm:
   - UI looks clean
   - Status = **Connected**
   - Worker URL = `https://slacker.tzgold.workers.dev`

**Pass:** Connected green pill.

---

## Part B — Sent works (one email)

1. Open a DM or channel
2. Send: `finish day sent 1`
3. Look under **your** message for a **single grey check**
4. Open Slacker popup → Sent count ≥ 1, row says **Sent**
5. Slack tab → F12 → Console → look for `[Slacker] tracked` or `[Slacker] API send`

**Pass:** one check + popup row.

**Fail?** Paste console lines starting with `[Slacker]`.

---

## Part C — Solo Seen simulation (no second person)

Use this if you want to prove the Worker → poll → ticks path alone.

1. Send a new message (so you have a Sent row)
2. Slacker popup → open **Connection settings**
3. Click **Simulate Seen on latest**
4. Click **Check now**
5. Expect:
   - Popup badge → **Seen**
   - In Slack → **two teal checks** (may need a few seconds / refresh Slack)

**Pass:** ticks turn teal after simulate.

This proves backend + polling. It does **not** prove the second user’s browser.

---

## Part D — Real Seen (two emails, solo)

You need two Slack emails and two Chrome profiles.

### Setup profile A (sender — your main email)

1. Chrome profile 1 → Slack as you
2. Extension loaded + Reloaded
3. Connected

### Setup profile B (viewer — second email)

1. Chrome → profile icon → **Add**
2. In that profile only: Slack login with **second email**
3. `chrome://extensions` → Load unpacked → same `slacker` folder
4. Reload Slacker, hard-refresh Slack, Connected

### Run the test

1. In **B**: open DM with **A** (stay on that chat)
2. In **A**: send `finish day seen 1`
3. **A** should show **one grey check**
4. In **B**: make sure that message is **visible on screen**
5. Wait up to 30s, or on **A** click **Check now**
6. **A** should show **two teal checks**

Optional console:

- **A:** `[Slacker] tracked …`
- **B:** `[Slacker] seen ping …`

**Pass:** teal double checks without using Simulate.

---

## Checklist

- [ ] Worker `/ping` returns `ok` (already verified live)
- [ ] Extension Connected
- [ ] Sent → one grey check
- [ ] Simulate Seen → teal checks (Part C)
- [ ] Real two-profile Seen → teal checks (Part D)
- [ ] Popup counts match
- [ ] Extension off → no new ticks (optional)

---

## If something fails

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Offline in popup | Worker URL wrong / network | Save `https://slacker.tzgold.workers.dev` |
| No grey check | Send not detected | Reload extension + Ctrl+Shift+R Slack; check console |
| Grey forever (real test) | Profile B missing Slacker / message not in view | Confirm B has extension; scroll message into view |
| Teal immediately on send | Self-seen bug | Report — should not happen |
| Simulate works, real doesn’t | Viewer beacon issue | Check B console for `seen ping` |

---

## Quick worker self-check (PowerShell)

```powershell
curl.exe https://slacker.tzgold.workers.dev/ping
curl.exe "https://slacker.tzgold.workers.dev/status?ids=finishday_test_001"
```

---

## Today’s order

1. Part A — load  
2. Part B — Sent  
3. Part C — simulate Seen  
4. Part D — two profiles real Seen  

When Part D passes, finish day is done for v1.
