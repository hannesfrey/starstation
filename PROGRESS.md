# Starstation — Progress

Read SPEC.md first. This file tracks where the build stands and every small decision made.

## Current state

- **Phase:** Start-of-run checklist (waiting on Hannes: GitHub login + secrets.json)
- **Next step:** Step 1 — Explore

## Start-of-run checklist

- [ ] GitHub login — Hannes double-clicks `source\github-login.cmd` (portable gh, token stored in `tools\gh-config`)
- [ ] Create repo `starstation` (public) — done by Claude after login
- [ ] ScreenScraper credentials → `Files\config\secrets.json` (filled in by Hannes)
- [ ] RetroAchievements credentials → `Files\config\secrets.json` (filled in by Hannes)
- [x] Controller detected: DualShock 3 via SCP driver (appears as "Xbox 360 Controller for Windows", XInput) + Logitech G29 wheel
- [x] OneDrive check: OneDrive Personal is signed in, but Desktop is NOT redirected/synced — no warning needed

## Decisions from Hannes (2026-11-02)

- **EmuDeck import source:** EmuDeck was already uninstalled. Hannes's real setup is the portable one at `Desktop\Emulator` (Emulators\, Emulation\bios, Emulation\saves, Emulation\roms, Emulation\storage\rpcs3, Tools\ES-DE, Tools\SRM). "Import from EmuDeck" for Hannes = import from `Desktop\Emulator`: copy emulators/BIOS/saves/firmware, verify, then move games. Leave the rest of `Desktop\Emulator` in place. The wizard should still support a real EmuDeck (`<drive>:\Emulation` + `%APPDATA%\EmuDeck`) for siblings.
- **Build tools:** portable, inside `source\tools` (Node LTS v26.13.0, gh v2.103.3, both sha256-verified). `source\env.cmd` sets PATH and keeps npm/Electron/electron-builder/gh caches and TEMP inside `source\tools`. Nothing in Program Files, PATH or registry.
- **Repo:** public (needed for installer downloads + electron-updater without tokens).
- **Logins:** local `Files\config\secrets.json` (never committed, never packaged). ScreenScraper also needs developer credentials (devid/devpassword); until those exist, artwork uses libretro thumbnails only.

## Small technical choices

- gh uses `--insecure-storage` so the token lives in `tools\gh-config` instead of Windows Credential Manager (keeps it portable). `tools\` is git-ignored.
- The controller is a DS3 through SCP, which reports as Xbox 360. Plan: button icons follow the detected type, with a Settings override "Button icons: PlayStation / Xbox / Auto" so Hannes can force PlayStation icons.
- The G29 wheel is also a gamepad to the Gamepad API — menu navigation must ignore wheel/pedal axes (filter by `mapping === "standard"` / known IDs).

## Step log

(none yet)
