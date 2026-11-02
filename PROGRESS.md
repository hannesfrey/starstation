# Starstation — Progress

Read SPEC.md first. This file tracks where the build stands and every small decision made.

## Current state

- **Phase:** Start-of-run checklist done except secrets.json (optional, not blocking)
- **Next step:** Step 1 — Explore

## Start-of-run checklist

- [x] GitHub login — account `hannesfrey` (id 339208969); token in `tools\gh-config\hosts.yml` (plain text, git-ignored)
- [x] Create repo `hannesfrey/starstation` (public)
- [ ] ScreenScraper credentials → `Files\config\secrets.json` (Hannes fills in; not blocking)
- [ ] RetroAchievements credentials → `Files\config\secrets.json` (Hannes fills in; not blocking)
- [x] Controller detected: DualShock 3 via SCP driver (appears as "Xbox 360 Controller for Windows", XInput) + Logitech G29 wheel
- [x] OneDrive check: OneDrive Personal is signed in, but Desktop is NOT redirected/synced — no warning needed

## Decisions from Hannes (2026-11-02)

- **EmuDeck import source:** EmuDeck was already uninstalled. Hannes's real setup is the portable one at `Desktop\Emulator` (Emulators\, Emulation\bios, Emulation\saves, Emulation\roms, Emulation\storage\rpcs3, Tools\ES-DE, Tools\SRM). "Import from EmuDeck" for Hannes = import from `Desktop\Emulator`: copy emulators/BIOS/saves/firmware, verify, then move games. Leave the rest of `Desktop\Emulator` in place. The wizard should still support a real EmuDeck (`<drive>:\Emulation` + `%APPDATA%\EmuDeck`) for siblings.
- **Build tools:** portable, inside `source\tools` (Node LTS v26.13.0, gh v2.103.3, both sha256-verified). `source\env.cmd` sets PATH and keeps npm/Electron/electron-builder/gh caches and TEMP inside `source\tools`. Nothing in Program Files, PATH or registry.
- **Repo:** public (needed for installer downloads + electron-updater without tokens).
- **Logins:** local `Files\config\secrets.json` (never committed, never packaged). ScreenScraper also needs developer credentials (devid/devpassword); until those exist, artwork uses libretro thumbnails only.

## Small technical choices

- Git identity is repo-local: `hannesfrey <339208969+hannesfrey@users.noreply.github.com>` (GitHub no-reply address, so no personal email is published). The credential helper is repo-local too and calls the portable gh with `GH_CONFIG_DIR` set. No global `~/.gitconfig` exists: `gh auth setup-git` created one, so it was deleted and removed from `github-login.cmd`.
- gh uses `--insecure-storage` so the token lives in `tools\gh-config` instead of Windows Credential Manager (keeps it portable). `tools\` is git-ignored.
- The controller is a DS3 through SCP, which reports as Xbox 360. Plan: button icons follow the detected type, with a Settings override "Button icons: PlayStation / Xbox / Auto" so Hannes can force PlayStation icons.
- The G29 wheel is also a gamepad to the Gamepad API — menu navigation must ignore wheel/pedal axes (filter by `mapping === "standard"` / known IDs).

## Step log

### Step 1 — Explore (done 2026-11-02)

Source setup = `C:\Users\Hannes\Desktop\Emulator` (portable, built earlier; EmuDeck itself was uninstalled — no `C:\Emulation`, no `%APPDATA%\EmuDeck`).

- **Emulators** (`Emulator\Emulators\`, all portable): duckstation (latest), PCSX2-Qt v2.8.2 (`portable.ini`, `inis\PCSX2.ini`), RPCS3 v0.0.43-20551 (firmware 4.93 in `dev_flash`, `config\vfs.yml` remaps dev_hdd0 + games), RetroArch 1.22.2 (21 cores incl. mesen, snes9x, mupen64plus_next, gambatte, mgba, genesis_plus_gx), Dolphin 2609a (`portable.txt`), PrimeHack 1.0.9, Cemu 2.6, azahar 2126.2 (`user\`), melonDS 1.1, Ryujinx 1.3.3, Vita3K, xemu 0.8.139 (`xemu.toml`), xenia_canary 02d2cb5 (`portable.txt`), shadPS4 0.21.0, ScummVM 2026.4.0, Supermodel. Full list with sha256s: `Emulator\Downloads\download-log.txt`.
- **BIOS** (`Emulator\Emulation\bios\`, flat): PS2 Europe set — SCPH-30003/30004R/39004/50004/70004 (+ NVM/MEC/ROM1/ROM2/EROM), SCPH-77004 (ROM0/ROM1/DIFF/INF/NVM). PCSX2 default = SCPH-70004_BIOS_V12_EUR_200.BIN. No PS1, Xbox (MCPX/BIOS/HDD), 3DS or other BIOS yet.
- **Saves**: `Emulation\saves\pcsx2\memcards\Mcd001.ps2, Mcd002.ps2`; savestates `SLES-53717 (208183AF).01.p2s` + `.resume.p2s` (Midnight Club 3). DuckStation/RetroArch save folders exist but are empty. RPCS3 `dev_hdd0` is empty apart from a `TEST12345` test folder created during setup (do not import).
- **Games**: PS2 only — `Midnight Club 3 - DUB Edition Remix (Europe, Australia) (En,Fr,De,Es,It).iso` (8.1 GB) plus the same game as `.7z` (3.0 GB archive) and `Vimm's Lair.txt`. Import moves the .iso; the .7z is a duplicate archive and is left in place (not a playable format), and the .txt is ignored. ps3\ has only ES-DE's `shortcuts\` folder.
- **PS3 game formats to support**: folder dumps (`<Game>\PS3_GAME\USRDIR\EBOOT.BIN`), ISO, and installed PKG games in `dev_hdd0\game\<TITLEID>\` (PARAM.SFO + ICON0.PNG/PIC1.PNG).
- **Controllers**: DS3 via SCP (XInput "Xbox 360 Controller for Windows", VID_045E PID_028E) + Logitech G29 (SDL/DirectInput, must be ignored for menu navigation and never be "Pad 1").
- **OneDrive**: signed in, Desktop not redirected → no warning.
- **Disk**: 458 GB free on C:.
- **Other tools in Emulator folder** (not imported, stay usable): ES-DE 3.5.0, Steam ROM Manager 2.6.0 (Steam shortcuts point into `Desktop\Emulator`).
