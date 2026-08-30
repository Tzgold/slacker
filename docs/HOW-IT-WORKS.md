# How Slacker works (locked)

## Product
Telegram-style checks **on the sender’s Slack** (browser + this extension).

- **One check** = you sent it (Slacker tracked the send).
- **Two checks (teal)** = the other person **also has Slacker** and opened that conversation so the message was on screen.

There is **no** guaranteed Seen if they don’t have Slacker. Slack does not provide read receipts.

## Flow
1. You send → Slacker records `channelId + message timestamp`.
2. Their Chrome + Slacker sees that message in view → their extension pings your Worker with the same id.
3. Your extension polls the Worker → ticks turn teal. Hover shows time.

## Test
Two Chrome profiles (or two people), both load this unpacked extension, same worker URL, same Slack DM. You send. They open the DM. Within ~30s your ticks go double/teal.
