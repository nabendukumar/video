---
name: Recording behavior requirements
description: Product constraints for when voice and video recording may run and how recordings are stored.
---

- Recording starts only after an explicit user action and shows a clear active state with an always-available stop control.
- Audio may continue with the screen off through Android's foreground-service notification, which must have a stop action.
- Video must stop when the app moves to the background.
- Recordings stay on the device unless the user chooses to share them.

**Why:** The user explicitly requires recordings to be visible, stoppable, user-initiated, and local by default.

**How to apply:** Preserve these rules when changing recording lifecycles, permissions, notifications, storage, background behavior, or sharing.
