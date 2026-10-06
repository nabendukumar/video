---
name: Expo preview link domains
description: Replit Expo host behavior and checks for current phone-preview links.
---

- Replit's managed Expo workflow prints the current `exp://` URL using the injected Expo development host.
- The generated Android manifest and its `launchAsset` bundle must both be reachable from that current host before considering phone preview verified.
- Do not hard-code or reuse an old `.expo.sisko.repl.co` URL; use the current managed Preview/QR link in Expo Go.

**Why:** The current `.replit.dev` host served the browser preview, Android manifest, and bundle successfully, while the corresponding legacy `.repl.co` alias did not pass TLS validation.

**How to apply:** For a phone-link failure, restart the exact managed Expo workflow if needed, refresh the preview card, inspect the latest Metro URL, and test `/status`, the Android manifest, and its `launchAsset`. Direct native testing through Expo Go's fresh QR rather than a stale Chrome URL.
