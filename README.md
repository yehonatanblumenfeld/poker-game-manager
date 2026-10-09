# Felt · home poker manager

Run a home poker night from your phone. Open a table, send the invite, and everyone joins from their own phone with no sign-up. The app tracks buy-ins and cash-outs, and when the night ends it works out who pays whom.

English and Hebrew (full right-to-left), mobile first.

## How it works

- **The host's phone runs the game.** Players send it actions; it applies them and broadcasts the table over Supabase Realtime (WebSockets over TLS), one channel per table named after a 128-bit secret that only invitees have. Invite links carry the secret in the URL fragment, which never reaches a server; the 8-character code also works while the game is live.
- **Nothing on the channel is trusted.** The host signs every table it sends (ECDSA) and players check it against keys saved with the game, which only the signed-in host can write. What a player sends the host is end-to-end encrypted (ECDH + AES-GCM), so other players can't read or forge it. Devices are known by a hash of a private id.
- **Accounts on Supabase.** Hosts sign in with Google; players join as guests or sign in. The host saves the game as it goes, so it can be resumed on another device and ends up in everyone's history. Schema and row-level security are in `supabase/migrations/`. Guests read a game only through two narrow functions (by secret, or by code while live) and can't touch any table.
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

To try several phones without Supabase, `npm i && npm run mock` starts a local stand-in (database + realtime) and `?cloud=mock` points the page at it. The page's Content-Security-Policy only allows the real Supabase, so open it with CSP checks off (Playwright `bypassCSP`) for this.

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
