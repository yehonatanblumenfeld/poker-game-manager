# Felt · home poker manager

Run a home poker night from your phone. Open a table, send the invite, and everyone joins from their own phone with no sign-up. The app tracks buy-ins and cash-outs, and when the night ends it works out who pays whom.

English and Hebrew (full right-to-left), mobile first.

## How it works

- **No server, no database.** The host's browser holds the game and saves it in `localStorage`. Phones talk through two free public MQTT relays at once (EMQX and HiveMQ, over secure WebSockets), so it works on any network, including mobile data. The relays only pass messages along; there's no account and nothing to set up.
- **End-to-end encrypted.** Messages are AES-GCM encrypted with a key derived from the game code, on a topic derived from it too, so the relays only ever see ciphertext.
- **The host's screen should stay open.** The relay keeps the latest table, so if the host's phone locks, players still see it; buy-ins wait until the host is back. The app asks the phone to keep the screen awake during a game.
- **Players rejoin as themselves.** Each phone gets a random id in `localStorage`, so reopening the invite puts you back in your seat with your buy-ins. Use the same browser all night (opening the link in WhatsApp's built-in browser and then in Safari counts as two phones).

## Features

- Fixed buy-in or cash game (any amount), any currency.
- Chip value as a ratio (`₪1 = 5 chips`) or as chips per buy-in (`₪100 = 500 chips`).
- Invite by QR code, link or 6-letter code. Up to 10 seats; tap a seat to sit or move.
- Players buy in and cash out themselves; the host can do it for anyone, add players who have no phone, undo a buy-in, move seats and rename.
- Live notifications when someone joins, buys in or leaves, and an activity log.
- Leaving early: the player enters their stack and sees right away whether they're up or down. The host can mark them as already settled, and the final settle-up routes their money through the host.
- End of game: count stacks, see whether the count matches the chips bought, optionally spread a small difference proportionally, then settle up with the fewest payments or everything through the host. Tick payments off as they happen. Share the results to WhatsApp.
- "Run it back" starts a new round with the same players, seats and link.
- Past games and an all-time leaderboard, kept on each phone.
- Installable (web app manifest + offline shell).

## Run locally

No build step.

```sh
python3 -m http.server 8080   # then open http://localhost:8080
npm test                      # settle-up and game-rule tests (Node 20+)
```

To test against local brokers instead of the public ones, run an MQTT broker with a WebSocket listener and add `?broker=ws://127.0.0.1:8888` (repeatable) to the URL.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root. The site is plain static files.

## Layout

| Path | What |
| --- | --- |
| `js/app.js` | Router and all screens |
| `js/store.js` | Game state, the host-side action rules, `localStorage` |
| `js/settle.js` | Pure money math: results, rounding, who-pays-whom |
| `js/net.js` | Host and player links over the encrypted MQTT relay |
| `js/i18n.js` | English and Hebrew strings, number and currency formatting |
| `js/ui.js` | Toasts, bottom sheets, small motion helpers |
| `vendor/` | MQTT.js 5.10.1 and qrcode-generator 1.4.4 (both MIT) |
