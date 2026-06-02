# Slacker — Setup Guide (do these in order)

## What you already have

- Chrome extension files in `C:\Users\Admin\Documents\slacker`
- Extension loaded in Chrome (Load unpacked → pick **slacker**, not `worker`)

## What you need to do next

### Step 1 — Cloudflare account (one time)

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and create a free account (if you don't have one).

### Step 2 — Deploy the backend worker

Open **PowerShell** in the project folder and run:

```powershell
cd C:\Users\Admin\Documents\slacker\worker
npm install
npx wrangler login
```

- A browser window opens → log in to Cloudflare → allow Wrangler.

Then create storage for read receipts:

```powershell
npx wrangler kv namespace create SLACKER_KV
```

Copy the **`id`** from the output (looks like `a1b2c3d4e5f6...`).

Copy the example config and add your KV id:

```powershell
copy worker\wrangler.toml.example worker\wrangler.toml
```

Open `worker\wrangler.toml` and replace `YOUR_KV_NAMESPACE_ID` with that id:

```toml
id = "paste-your-id-here"
```

Deploy:

```powershell
npx wrangler deploy
```

Copy the URL from the output, e.g.:

```
https://slacker.<your-subdomain>.workers.dev
```

### Step 3 — Connect the extension to your worker

1. Open Slack in Chrome (`https://app.slack.com` or your workspace URL).
2. Click the **Slacker** extension icon in the toolbar.
3. Paste your worker URL (no trailing slash).
4. Click **Save**.
5. The dot should turn **green** if `/ping` works.

### Step 4 — Test it

**You need two people (or two browsers) for a real test:**

| Role | What to do |
|------|------------|
| **You** | Send a DM from Slack with the extension enabled. You should see **✓ Delivered** under your message. |
| **Other person** | Open that DM in Slack (their account). Their browser loads the hidden pixel. |
| **You** | Wait ~30 seconds (or reload Slack). Pill should change to **✓✓ Seen &lt;time&gt;**. |

**Quick self-test (pixel only):**

Paste in your browser (replace with your worker URL and any test id):

```
https://slacker.YOURNAME.workers.dev/pixel?id=test123
```

Then check status:

```
https://slacker.YOURNAME.workers.dev/status?ids=test123
```

You should see JSON with `seenAt`.

### Step 5 — If pills don't appear in Slack

Slack's DOM changes often. Open Slack → **F12** → **Console** → look for `[Slacker]` errors.

Common fixes later: update selectors in `content.js`.

---

## Checklist

- [ ] Cloudflare account created
- [ ] `wrangler login` completed
- [ ] KV namespace created, id pasted in `wrangler.toml`
- [ ] `wrangler deploy` succeeded
- [ ] Worker URL saved in extension popup (green dot)
- [ ] Extension loaded from `slacker` folder (not `worker`)
- [ ] Test message sent in Slack

---

## Commands cheat sheet

```powershell
cd C:\Users\Admin\Documents\slacker\worker
npm install
npx wrangler login
npx wrangler kv namespace create SLACKER_KV
# edit wrangler.toml with the id
npx wrangler deploy
```

After code changes to the worker:

```powershell
npx wrangler deploy
```

After code changes to the extension:

1. Go to `chrome://extensions`
2. Click **Reload** on Slacker
3. Refresh your Slack tab
