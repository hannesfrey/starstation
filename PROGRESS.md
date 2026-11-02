# Starstation — Progress

Read SPEC.md first. This file tracks where the build stands and every small decision made.

## Current state

- **Phase:** Building. Steps 1–7 done. **Playable milestone reached 2026-11-02:** Hannes's setup is imported and Midnight Club 3 boots from Starstation (PS2).
- **Next step:** Step 8 — Mods

## How to work on it

- Open a PowerShell, `. .\env.ps1` (portable Node/gh, caches in `tools\`).
- `npm run dev` (hot reload), `npx electron-vite build`, `npx tsc --noEmit -p tsconfig.json`
- Tests: `npx vitest run` (unit), `npx playwright test` (drives the real Electron app with a throw-away Files folder and a fake emulator; see `tests/e2e/helpers.ts`). `SCREENSHOTS=1 npx playwright test screens` writes screenshots to `tools/cache/screens`.
- Env overrides: `STARSTATION_FILES` (Files folder), `STARSTATION_PRESETS` (preset folder), `STARSTATION_LOG_STDOUT=1`, `STARSTATION_HEADLESS=1` (window never shown, not in taskbar, audio muted, never brought to front — the e2e helper always sets it and the boot test asserts it).
- **Hannes uses this PC while the build runs.** Automated tests must stay invisible and silent. Anything that necessarily shows on screen (real emulator launch tests — they go fullscreen) is only done after asking Hannes first.

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

### Step 4 — Import + emulator manager (done 2026-11-02, tag `step-04-import`)

- `src/main/importer.ts`: finds `Desktop\Emulator` (portable layout) and real EmuDeck setups (`<drive>:\Emulation` + `%APPDATA%\EmuDeck\Emulators`). Plan per console preset (`import.roms/saves/storage` in the preset JSON + emulator `importNames`): copy emulators used by presets, BIOS files matching preset rules (+ companion files with the same name stem, e.g. PS2 .NVM/.MEC/.ROM1), saves, emulator storage (PS3 dev_hdd0) → verify everything (size for all, SHA-1 for files < 64 MB) → only then move games (same drive = rename; other drive = copy + verify + remove). Existing files are never overwritten (conflicts kept and reported), empty folders skipped, archives/notes (.7z, .txt) stay in the source. Versions of imported emulators come from `Downloads\download-log.txt`. History in `config\imports.json`.
- Safety: hidden test runs (`STARSTATION_HEADLESS=1`) never look at the real PC; tests use `STARSTATION_IMPORT_SOURCE` with a fake setup.
- `src/main/emulators.ts`: Settings → Emulators lists installed version / "Update available"; checks GitHub `releases/latest` (cached 1 h), installs/updates by download → extract (zip: Windows tar, 7z: bundled `7zr.exe`) → flatten single top folder → write `.starstation.json` marker → re-apply portable/config steps. Downloads go to `config\downloads` and are deleted afterwards.
- `scripts/fetch-bin.mjs`: fetches `7zr.exe` from 7-zip.org pinned by SHA-256; falls back to a local copy with the same hash (7-zip.org DNS failed on 2026-11-02, so Hannes's verified copy from `Desktop\Emulator\Tools\7zip` was used).
- PS3 firmware: "Install PS3 firmware" asks for PS3UPDAT.PUP (button opens Sony's official page) and runs `rpcs3 --installfw`.
- Tests: import e2e (copy/verify/move, config rewrite, PS3 saves link), "headless never sees the real PC", and a network test (`NETWORK=1`) that really installs PCSX2 from GitHub — passed.
- **Real import done 2026-11-02** (Hannes closed PCSX2 and OK'd visible tests): `node scripts/real-import.mjs --run` → 38 items copied + verified (8 emulators 1.9 GB, BIOS files, PS2 memcards/savestates, RPCS3 storage), 1 game moved (Midnight Club 3, SLES-53717). Stays in `Desktop\Emulator`: the .7z duplicate, Vimm's Lair.txt, `SCPH-70004_BIOS_V12_PAL_200.MEC` (stray file with a different name stem; PCSX2 doesn't need .MEC) and emulators no preset uses (Cemu, PPSSPP, Ryujinx, …).
- Real launch: `node scripts/real-launch.mjs ps2 25 shot.png` → PCSX2 found BIOS v02.00 EUR, serial SLES-53717, ELF running, Rockstar intro on screen, DS3 opened as XInput player 1. PCSX2.ini folders point to `Files\bios\ps2`, `saves\ps2\memcards|sstates`, `media\screenshots\ps2`.
- Hannes's settings: `buttonIcons: playstation`. Shortcut `Desktop\Starstation\Starstation.lnk` → dev build (`electron.exe source`) until the installer exists (step 12).

### Step 5 — Remaining presets (data done 2026-11-02, tag `step-05-presets`; real launch checks pending)

Flags checked on 2026-11-02 against current sources: Azahar `-f <file>` (citra_qt.cpp), xemu `-full-screen -dvd_path <iso>` + `xemu.toml` `[sys.files] bootrom_path/flashrom_path/hdd_path/eeprom_path`, `[general] show_welcome`, `[display.window] fullscreen_on_startup` (config_spec.yml), Xenia Canary `--fullscreen` + `portable.txt`, Dolphin `-b -e`, RetroArch `-L core --appendconfig cfg -f`.

- NES (mesen), SNES (snes9x), N64 (mupen64plus_next) on RetroArch: per-console override file `config\retroarch\<console>.cfg` (saves/states/system/screenshot dirs, `quit_on_close_content`, fullscreen) passed with `--appendconfig`. Missing core = requirement with a fix button "Install the X core" (downloads from buildbot.libretro.com nightly). Netplay flag on.
- GameCube / Wii on Dolphin: Dolphin.ini fullscreen, no stop confirm, game path, analytics/Discord off; saves via links `saves\gc\GC` → `User\GC`, `saves\wii\Wii` → `User\Wii`; game ID from disc header (.iso/.gcm).
- 3DS on Azahar: links for `user\sdmc`, `user\nand`, screenshots.
- Xbox on xemu: three BIOS requirements (MCPX 512 B, flash 256 KB/1 MB, .qcow2 HDD) written into xemu.toml with full paths via `bios.select` (now supports several entries, `rule`, `fullPath`, `quote`).
- Xbox 360 on Xenia Canary: .iso/.xex/.zar and folder games with `default.xex` (new generic `games.folderLaunch`), `content` linked into saves, shader hint, no quick resume.
- Download sources: GitHub releases for Azahar/xemu/Xenia (like PCSX2/RPCS3/DuckStation), fixed official URLs for RetroArch 1.22.2 (buildbot) and Dolphin 2609a (dl.dolphin-emu.org) with their download pages noted.
- Test: all 11 presets load in spec order and show as XMB columns.
- **Pending:** real install tests for the other emulators (`NETWORK=1`, large downloads — postponed while Hannes was streaming) and real game launches per preset (Hannes OK'd visible tests on 2026-11-02; PS2 verified; the other consoles have no games yet — verify when Hannes adds some).

### Step 6 — Game experience (done 2026-11-02, tag `step-06-game`)

- **Triangle menu:** Play, or Resume / Start fresh when a resume state exists · Favorites · Add to collection · Save backups · Open folder (game files, saves, backups, screenshots, mods) · Game info · Delete game. "No quick resume" note for consoles without it. Netplay, graphics, CRT, patches, mods and artwork entries come with steps 7–10.
- **Quick resume** (`resume` in the preset: state path + args + `at` position). Verified 2026-11-02 against current sources: PCSX2 `[EmuCore] SaveStateOnShutdown`, state `<serial> (<crc>).resume.p2s`, load with `-statefile`; DuckStation `[Main] SaveStateOnExit`, `<serial>_resume.sav`, `-resume`; RetroArch `savestate_auto_save` + `savestate_auto_load = {resume}` (written per launch), `<rom>.state.auto`. **Turned off for GameCube, Wii (Dolphin), 3DS (Azahar) and Xbox (xemu):** none of them can save a state automatically when they close (Dolphin only loads with `-s`), so the spec's "where supported" excludes them. PS3/Xbox 360 already had none.
- ✕ on a game with a resume state opens Resume / Start fresh; a warning shows if the emulator version changed since the state was saved (`resumeVersion` is recorded in stats after each session).
- **Start fresh keeps the previous resume state** (`backups\<console>\<game>\previous-resume`), and Save backups offers "Bring back the earlier resume point". Added after the real test: a fresh PCSX2 test run overwrote Hannes's Nov 1 resume state (his memory cards were untouched and backed up, and PCSX2's slot-1 state from the same moment still exists).
- **Save backups** (`backup` in the preset): before every launch, if anything changed since the last backup (fingerprint of names/sizes/times), copied to `backups\<console>\<game>\<local time>\` with a manifest; newest 5 kept; > 1 GB skipped with a log line. Restore backs up the current saves first and keeps linked folders (junctions) in place. PS1/PS2 memory cards, GC/Wii/3DS/360 save folders are `shared` (never deleted with a game); RetroArch `.srm` and PS3 `savedata\<serial>*` are per game. Xbox saves live in the HDD image → no per-game backup.
- **Search:** □ / Ctrl+F or the Search item at the top of each console column; on-screen keyboard (controller/mouse, Title case), real keyboard typing; results across all consoles (title, serial, console); → / R1 to the results, ✕ play, △ options.
- **Collections column:** Favorites, own collections (△ → rename/delete), automatic: Recently added (30 days), 2+ players, Not played yet, Most played; "New collection". Stored in `config\library\collections.json`.
- **Delete game:** confirmation, "keep saves" or "delete game and its saves" (only per-game saves); everything goes to the Recycle Bin (`shell.trashItem`), so it can be undone. Hidden test runs use `config\test-trash` instead of Hannes's Recycle Bin.
- **Add games** (spec 7): Settings → Library → Add games… or drag files onto the window. Console detected by extension, then by contents when several consoles share it: GameCube/Wii disc magic, ISO9660 `SYSTEM.CNF` BOOT2/BOOT (PS2/PS1), `PS3_GAME/PARAM.SFO`, XDVDFS (Xbox vs 360 by `default.xbe/.xex`, XGD1/2/3 offsets). Still ambiguous (.chd, .zip, …) → "Which console is this for?". Files are moved (with .cue tracks / .m3u discs); existing files are never overwritten.
- Real tests 2026-11-02 (Hannes OK'd visible tests): PS2 fresh → closed normally (CloseMainWindow) → resume state written, memory cards backed up; PS2 resume → `-statefile …resume.p2s`, PCSX2 loaded the state and continued in the intro where it was closed. `scripts/real-launch.mjs` gained `--resume` and `--close <process>`.
- Tests: `tests/e2e/game.spec.ts` (resume + backups + restore + keep 5 + previous resume; search, on-screen keys, collections, delete, add games incl. ambiguous .chd and no overwrite; disc sniffing for GC/Wii/Xbox).

### Step 7 — Controllers & graphics (done 2026-11-02, tag `step-07-controls`)

- **Unified mapping** (`controls` in the preset, applied before every launch). Player 1 = first controller, Western layout (✕/A = confirm, bottom button). The menu reports connected pads (`report-pads` → `config\controllers.json`): any XInput pad → XInput bindings (`XInput-0/…`), otherwise SDL (`SDL-0/…`); wheels/pedals are ignored. Placeholders `{pad}`, `{padshot}`, `{padshare}`, `{rajoypad}`.
  - PCSX2 `[Pad1]` DualShock2 and DuckStation `[Pad1]` AnalogController (same binding names, checked in both sources: `DPadUp`, `+LeftTrigger`, `-LeftY`, `LargeMotor` …), `[InputSources] XInput/SDL = true`.
  - RetroArch: `input_joypad_driver = xinput|sdl2`, autoconfig on, player 1 = pad 0.
  - Dolphin: `GCPadNew.ini [GCPad1]` and `WiimoteNew.ini [Wiimote1]` with `XInput/0/Gamepad` (names from Dolphin's XInput.cpp). GameCube buttons by position (A bottom, B left, X right, Y top). Wii Remote: A/B(R2)/1/2/−/+/Home, pointer on the right stick, shake on R3, Nunchuk on the left stick + L1/L2.
  - RPCS3: Hannes's `Default.yml` already used XInput; written only if missing. xemu auto-binds the first pad; Xenia uses XInput natively.
  - **Azahar (3DS) is not mapped automatically**: its SDL bindings need the controller's GUID. Noted in the preset; map once in Azahar.
- **Screenshot button**: each emulator's own screenshot hotkey is set to **F12** (PCSX2/DuckStation also bind the touchpad and Share button when an SDL pad is used; XInput can't see those buttons, so the DS3 via SCP has no controller screenshot button). Emulators already save into `media\screenshots\<console>`. Verified for real: F12 in PCSX2 → `media\screenshots\ps2\Midnight Club 3 …png`. Choice: Starstation does not grab F12 itself, because a global shortcut would take the key away from the emulator. Dolphin `Hotkeys.ini` is written with screenshot + Stop (Esc), Pause (F10) and fullscreen (Alt+Enter), because writing that file replaces Dolphin's default hotkeys.
- **Graphics levels** (`graphics` in the preset; Triangle menu per game, default in Settings → General): PCSX2 upscale 1×/3×/6×; DuckStation scale 1×/4×/8× (+PGXP from Enhanced); Dolphin internal resolution 1×/3×/6×; RPCS3 resolution scale 100/150/200 %; Azahar 1×/3×/5×; xemu surface scale 1/2/3; Xenia draw resolution scale 1/2/3; N64 (Mupen64Plus-Next GLideN64) 640×480 / 1440×1080 / 2880×2160; NES/SNES Original = integer scaling, Enhanced/Max = fill the screen height.
- **CRT filter** (RetroArch consoles): `--set-shader shaders/shaders_slang/crt/crt-geom.slangp` + `video_shader_enable`; `video_driver = d3d11` (slang shaders); `config_save_on_exit = false` so one console's settings never leak into RetroArch's main config.
- **Patches** as per-game toggles: PS2 widescreen + no-interlacing (`[EmuCore] EnableWideScreenPatches / EnableNoInterlacingPatches`; apply when PCSX2 has a patch for the game), PS1 widescreen (`WidescreenHack` + 16:9), GameCube/Wii widescreen hack (`GFX.ini wideScreenHack`).
- **Shader hint**: first start of a PS3 / Xbox 360 game shows "The first minutes may stutter…" for 3.5 s before launching.
- Fixes found while testing: placeholders only normalize real absolute paths (bindings like `SDL-0/Touchpad` keep their slash); YAML keys keep their indentation (RPCS3 `config.yml`); INI keys can have several values (bind lists); `launch.insertAt` says where resume/option arguments go; the menu no longer misses a library update that arrives during startup (could leave it on Settings).
- Tests: `tests/unit/ini.test.ts`; e2e "per-game graphics, CRT filter and patches; controller mapping follows the connected pad" (XInput → SDL switch, touchpad/share screenshot lines, shader hint notice).

### Small technical choices (steps 2–3)

- Console column layout: Recently played ▸ and Favorites ▸ folders appear at the top when they have entries, then all games A–Z directly in the column (fewer clicks than an "All games" folder). Search comes with step 6.
- The selection is remembered per list by item key, so it doesn't jump when "Recently played" appears above it.
- PS3: `dev_hdd0` stays inside `emulators\rpcs3\dev_hdd0` (RPCS3 can only move the whole virtual disk); `saves\ps3\savedata` is a junction to `dev_hdd0\home\00000001\savedata`. `/games/` is remapped to `games\ps3`.
- PCSX2 needs a named BIOS file: if none (or a missing one) is set in `PCSX2.ini`, Starstation picks one, preferring SCPH-70004 / EUR / USA.
- `--` is passed before the game path for DuckStation and PCSX2 so file names starting with `-` can't be read as options.
- Local images are served through a `starstation-media://` protocol that only allows files inside `Files\`.
- Editing pitfall: Windows PowerShell 5.1 reads UTF-8 as ANSI — edit source with the Edit tool or `-Encoding UTF8`.
