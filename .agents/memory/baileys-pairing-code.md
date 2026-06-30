---
name: Baileys pairing code timing
description: How to correctly request a WhatsApp pairing code via Baileys — timing and auth state check are critical
---

To use WhatsApp pairing code login (instead of QR), call `sock.requestPairingCode(phoneDigitsOnly)` **right after** `makeWASocket()` and **before** any QR event fires.

**Rule:** Check `sock.authState?.creds?.registered` first. If `true`, creds are already registered and pairing is not needed (skip the call).

**Phone format:** Digits only, no `+` sign, include country code (e.g. `2348012345678` for Nigeria).

**Response format:** Baileys returns an 8-char string. Format as `XXXX-XXXX` for display.

**Timeout:** WhatsApp sends the code within a few seconds. Wait up to 20s before giving up.

**Why:** If you call `requestPairingCode` too late (after QR event fires), WhatsApp has already committed to QR mode and the call fails or is ignored. The call suppresses QR generation and switches the flow to pairing code mode instead.

**How to apply:** In the `_connect()` method, call `requestPairingCode` immediately after socket creation, wrapped in a `try/catch` so a failure falls back to QR mode gracefully.
