# Starstation — Progress

Read SPEC.md first. This file tracks where the build stands and every small decision made.

## Current state

- **Phase:** Building. Steps 1–3 done (step 3's real-emulator launch check happens in step 4 once emulators are imported).
- **Next step:** Step 4 — Import from `Desktop\Emulator` + emulator manager → playable milestone

## How to work on it

- Open a PowerShell, `. .\env.ps1` (portable Node/gh, caches in `tools\`).
- `npm run dev` (hot reload), `npx electron-vite build`, `npx tsc --noEmit -p tsconfig.json`
- Tests: `npx vitest run` (unit), `npx playwright test` (drives the real Electron app with a throw-away Files folder and a fake emulator; see `tests/e2e/helpers.ts`). `SCREENSHOTS=1 npx playwright test screens` writes screenshots to `tools/cache/screens`.
- Env overrides: `STARSTATION_FILES` (Files folder), `STARSTATION_PRESETS` (preset folder), `STARSTATION_LOG_STDOUT=1`.

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

### Step 2 — Foundation (done 2026-11-02, tag `step-02-foundation`)

Electron 45 + React 19 + TypeScript 7 + electron-vite 6 (Vite 8). Main process in `src/main`, preload `src/preload`, renderer `src/renderer`, shared types `src/shared/types.ts`.

- XMB: category row (Settings · Photo · Collections · consoles by preset `order`), items above/below the row like the PS3, selected item enlarged, game info panel (year · genre · players · play time), background artwork fade-in (PS3 PIC1 etc.).
- Background: canvas wave ribbons on a gradient; colour per month (own palette, `Background.tsx`), darker at night.
- Boot animation ~3 s, original star logo + synthesized chime, skippable by any key/button/click; can be turned off in General.
- Sounds: all synthesized with Web Audio (`sound.ts`) — no sound files. Paused while a game runs. Music setting exists (off); the music itself comes in step 9.
- Controls (`input.ts`): keyboard per spec table, Gamepad API standard mapping, mouse wheel/click/double-click/right-click. L1/R1 jump between consoles, Start → Settings, Select/F → favorite. Wheels/pedals/flight sticks are filtered by name and never move the menu. Input is ignored while a game runs or the window isn't focused.
- Notifications top-right (own timer each), clock top-right, controller connect/disconnect notices, battery icon placeholder (real level in step 9).
- Screensaver: dims after N minutes idle (setting, default 5).
- Options panel (right side) used for Settings pages, △ game menu and error messages.
- Electron's own data (`userData`, caches, crash dumps, temp) is redirected into `Files\config\electron` — nothing in %APPDATA%. Logs: `Files\config\logs\starstation-YYYY-MM-DD.log` (14 days kept).

### Step 3 — Library & launching (done 2026-11-02, tag `step-03-library`)

- Presets are JSON data: `presets/consoles/<id>.json` (one per console) + `presets/emulators/<id>.json` (shared by consoles, e.g. RetroArch). Placeholders: `{emu} {bios} {games} {saves} {media} {screenshots} {config} {launch} {game} {core}`; `{name:/}` gives forward slashes. Config step types: `ini`, `kv`, `touch`, `mkdir`, `write`, `link` (junction). Steps are re-applied before every launch, so paths stay right even if the folder moves.
- PS1 (DuckStation), PS2 (PCSX2), PS3 (RPCS3) presets written.
- Scanning `Files\games\<console>` (depth 4); files referenced by .cue/.m3u are hidden; PS3 folder dumps (PS3_GAME/PARAM.SFO), ISOs, and installed PKG games (`emulators\rpcs3\dev_hdd0\game`, category HG; GD = update data is skipped, and an installed copy with the same serial as a disc game is hidden).
- Titles: PS1/PS2 serial from SYSTEM.CNF (own ISO9660 reader handles .iso and raw .bin/.cue), looked up in DuckStation `gamedb.yaml` (also gives year/genre/players) and PCSX2 `GameIndex.yaml`. PS3 title/ID/ICON0/PIC1 from PARAM.SFO (folders, installed, and inside ISOs — extracted to `media\artwork\ps3\<ID>`). Fallback: cleaned file name (tags removed, "Zelda, The" → "The Zelda"). CHD/CSO can't be read without a decompressor → file name.
- Cache `config\library\library.json` (unchanged files keep their cached identity); stats separate in `config\library\stats.json` (play time, play count, last played, favorite) — kept separate so packages can exclude them.
- Launch: preset command line, cwd = emulator folder, TEMP inside Files. Starstation waits for the process to exit, adds play time, and comes back to the front. Clear errors with a fix button: emulator missing → Install, BIOS missing → Open BIOS folder, PS3 firmware missing → Install PS3 firmware, file gone → Rescan; "closed right away" notice if the emulator exits within 4 s with an error code.
- Tests: 11 unit tests (SFO, ISO9660 incl. the real Midnight Club 3 ISO → SLES-53717, serials, title cleaning, ini/kv editing, title DB) and 3 Playwright tests (boot/skip, scan + launch + return + play time + favorite, settings toggle + △ menu + launch error with fix).

### Small technical choices (steps 2–3)

- Console column layout: Recently played ▸ and Favorites ▸ folders appear at the top when they have entries, then all games A–Z directly in the column (fewer clicks than an "All games" folder). Search comes with step 6.
- The selection is remembered per list by item key, so it doesn't jump when "Recently played" appears above it.
- PS3: `dev_hdd0` stays inside `emulators\rpcs3\dev_hdd0` (RPCS3 can only move the whole virtual disk); `saves\ps3\savedata` is a junction to `dev_hdd0\home\00000001\savedata`. `/games/` is remapped to `games\ps3`.
- PCSX2 needs a named BIOS file: if none (or a missing one) is set in `PCSX2.ini`, Starstation picks one, preferring SCPH-70004 / EUR / USA.
- `--` is passed before the game path for DuckStation and PCSX2 so file names starting with `-` can't be read as options.
- Local images are served through a `starstation-media://` protocol that only allows files inside `Files\`.
- Editing pitfall: Windows PowerShell 5.1 reads UTF-8 as ANSI — edit source with the Edit tool or `-Encoding UTF8`.
