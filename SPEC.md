# Starstation — Build Spec & Kickoff Prompt

Nov 2, 2026 · @Hannes Freymuth

**Claude Code: this entire message is the specification for Starstation.** First create the folder `Desktop\Starstation\Files\source` on the current Windows user's Desktop, save this entire message there as `SPEC.md`, and work in that folder from now on. Then follow the kickoff below.

## Kickoff (instructions for Claude Code)

1. Read this whole spec before doing anything.
2. Build the entire plan in Section 14 in one continuous run, following every rule in Section 15. Do not stop between steps; only stop for the three cases listed in Section 15.
3. First, run the start-of-run checklist in Section 14 with Hannes in one go (GitHub login, ScreenScraper and RetroAchievements credentials, controller check, OneDrive check). After that he is not available until you report the playable milestone.
4. Keep `PROGRESS.md` updated after every step so any new session can continue exactly where you stopped.
5. In every new session (Hannes will just write "Continue building Starstation"), read `SPEC.md` and `PROGRESS.md` and continue from the next unfinished step without asking.

## 1. Vision & scope

Starstation is a Windows desktop app that works as a PS3-style console menu for emulated games and replaces EmuDeck with one self-contained, organized folder.

- **Goals:** launch any game from one menu with a controller; one-button access to saves and mods; easy mod installation including in-app browsing; pass a complete setup to another PC with one package.
- **Users:** Hannes and his siblings, each on their own Windows 10 PC, plus anyone they send a package to.
- **Language:** English only.
- **Self-contained:** after setup every PC works on its own. Internet is used only for app and emulator updates, artwork, mod browsing, RetroAchievements, netplay and sending packages.
- **Window:** normal window by default; fullscreen available in settings.

## 2. Tech & architecture

Electron + React + TypeScript, packaged as a Windows installer with electron-builder.

- **Main process (Node):** file scanning, launching and watching emulator processes, reading game IDs, mod installation, package export/import, updates, logging.
- **Renderer (React):** XMB interface, controller input via the Gamepad API (plus a native HID helper only where needed, e.g. controller battery), mouse and keyboard.
- **Data:** `Files\config\` holds settings, presets and the library cache (titles, artwork paths, play time, favorites, collections, hidden-empty-console state).
- **Presets are data files, not code:** one file per console; new consoles and fixes arrive with app updates.
- **Bundled tools:** croc (package transfer), 7-Zip CLI (mod archives).
- **Updates:** electron-updater against GitHub releases.
- **Source code:** `Desktop\Starstation\Files\source` (only on Hannes's PC, never in packages or the installer; Git repo pushed to GitHub as `starstation`). The installed app lives in `Desktop\Starstation`.

## 3. Folder structure

Everything lives in one Desktop folder that shows only a shortcut and one subfolder.

```
Desktop\Starstation\
  Starstation        shortcut, double-click to start
  Files\
    app\             Starstation itself
    emulators\       one folder per emulator, portable mode
    bios\            one folder per console
    games\           one folder per console
    saves\           one folder per console
    mods\            original mod files, one folder per game
    backups\         last 5 save backups per game
    media\           artwork, screenshots
    config\          settings, presets, library cache, logs
```

- **Portable mode:** every emulator keeps its settings and data inside its own folder (usually enabled by a marker file such as `portable.txt`). Presets set this up automatically.
- **Saves** are redirected into `saves\` wherever the emulator allows it; otherwise folder shortcuts point into the emulator's own folder.
- **Mods:** originals stay in `mods\`; active copies or links go where the emulator expects them, so switching a mod off never loses files.
- **Default location** for everyone: `Desktop\Starstation`, changeable in setup. On Hannes's PC, Files\\source\\ also holds Starstation's code.

## 4. Interface (XMB)

A dark, clean PS3-style crossbar built only from original assets — no Sony logos, fonts or sounds.

- **Boot animation:** about 3 seconds, Starstation logo plus a short original sound, skippable with any button.
- **Background:** animated wave on a gradient whose color changes with the month, like the PS3.
- **Top right:** date and time, plus controller battery level.
- **Columns (left to right):** Settings · Photo · Collections · NES · SNES · N64 · GameCube · Wii · 3DS · PS1 · PS2 · PS3 · Xbox · Xbox 360. Consoles without games are hidden automatically and reappear when a game is added; Settings → General has a "Show empty consoles" toggle.
- **Console column:** Search, Recently played, Favorites, All games A–Z.
- **Highlighted game:** icon/box art enlarged, background artwork fades in, info panel with year, genre, players and play time.
- **Notifications:** small XMB-style pop-ups top right (save backed up, mod installed, update available, achievement unlocked, controller connected).
- **Sounds:** original navigation and confirm sounds, on by default; paused while a game runs.
- **Background music:** original, off by default.
- **Screensaver:** dims to a slow animation after 5 minutes idle.

## 5. Controls

Controller first (Western layout), with mouse and keyboard fully supported.

| Action | Controller | Keyboard | Mouse |
| --- | --- | --- | --- |
| Move | D-pad / left stick | Arrow keys | Scroll |
| Confirm / play | ✕ | Enter | Click to select, double-click to play |
| Back | ○ | Esc | — |
| Game options | △ | Space | Right-click |
| Search | □ | Ctrl+F | — |
| Jump to Settings | Start | — | — |
| Toggle favorite | Select | F | — |
| Jump between consoles | L1 / R1 | — | — |
| Screenshot (in game) | Touchpad click (PlayStation) / Share (Xbox Series) | F12 | — |

- **Button icons** match the connected controller (PlayStation, Xbox, generic); PlayStation is the default when nothing is detected.
- **Hot-plugging:** controllers can connect or disconnect any time, with a notification.
- **During a game** Starstation intercepts nothing except the screenshot button; closing the game returns to the menu.

## 6. Consoles & presets

Version 1 ships 11 presets; every other console can be added through an advanced form.

| Console | Emulator | Notes |
| --- | --- | --- |
| NES | RetroArch | Netplay supported |
| SNES | RetroArch | Netplay supported |
| N64 | RetroArch | Netplay supported; texture packs |
| PS1 | DuckStation | Multi-disc via .m3u; serial → title from DuckStation database |
| PS2 | PCSX2 | Serial → title from GameIndex; widescreen/no-interlace patches; textures |
| PS3 | RPCS3 | Folder dumps, ISOs and installed PKG games; title + icons from PARAM.SFO; firmware from Sony's site |
| GameCube | Dolphin | Game ID for mods and textures |
| Wii | Dolphin | Wii Remote mapping |
| 3DS | Azahar | Two screens, layout options; mods by title ID |
| Original Xbox | xemu | BIOS, MCPX boot ROM, hard-disk image |
| Xbox 360 | Xenia | No save states, so no quick resume |

**Each preset defines:**

- emulator, download source and portable-mode setup
- launch command with fullscreen and close-on-exit flags (e.g. `pcsx2-qt.exe -batch -fullscreen "{game}"`)
- game file types, multi-disc and installed-game handling
- required BIOS / firmware / keys and how to verify them
- how to read the game ID and where to look up the title
- folder rules: saves, mods, textures, patches, cheats
- how the Starstation controller mapping and screenshot button are written into the emulator
- available toggles: graphics levels, CRT filter, widescreen and other patches
- quick resume support and known quirks (e.g. shader-compile hint for PS3 and Xbox 360)

**Advanced form** (no preset): name, emulator path, launch command, file types, folders. Games launch, without smart features. Presets for more consoles arrive later through app updates.

## 7. Game library

Games are found automatically, shown with proper titles and artwork, and organized into lists and collections.

- **Scanning:** `games\` on startup and on demand; new games appear automatically.
- **Adding games:** drag files into the window or use "Add games". The console is detected, the file is **moved** into the right folder, and the title is looked up.
- **Titles:** from game IDs (PS3 PARAM.SFO, PS1/PS2 emulator databases, Nintendo and Xbox ID/name databases); cleaned file name as fallback.
- **Artwork:** PS3 uses its own ICON0/PIC1. Everything else: libretro thumbnails (no account), ScreenScraper as fallback. Box art = icon, in-game screenshot = background.
- **Game info:** year, genre, player count from the metadata source; play time from Starstation.
- **Collections:** user-made collections plus automatic ones: 2+ players, Mods installed, Recently added, Not played yet, Most played.
- **Search:** controller-friendly on-screen keyboard, across all consoles.
- **Cache:** `config\library` keeps startup fast with large libraries.

## 8. Playing games

Pressing play starts the emulator fullscreen; closing the game returns to the menu with no hotkeys.

- **Launch:** preset launch command, fullscreen, close-on-exit flags.
- **Return:** Starstation waits for the emulator process to end, then comes back to the front.
- **Before launch:** saves are backed up automatically (last 5 kept per game).
- **Quick resume (where supported):** save state on close; next launch offers Resume or Start fresh, with a warning if the emulator was updated since.
- **Graphics level per game:** Original / Enhanced / Max, translated into each emulator's settings.
- **CRT filter:** on/off per game for RetroArch consoles.
- **Shader hint:** first launch of a PS3 or Xbox 360 game says the first minutes may stutter while shaders compile.
- **Play time** tracked per game.
- **RetroAchievements:** unlocks in supported emulators shown as notifications.
- **Screenshots:** one button for all emulators (Section 5), collected into the Photo column.
- **Netplay:** "Play online" (host / join) in the Triangle menu for NES, SNES and N64, using RetroArch's relay servers.
- **Errors:** always a clear message with a fix (e.g. "BIOS missing → Open BIOS folder"), never a silent failure.

## 9. Triangle menu (game options)

Triangle on a game opens everything you can do with it.

- Play / Resume / Start fresh
- Play online (NES, SNES, N64)
- Add to / remove from Favorites
- Add to collection
- Graphics: Original / Enhanced / Max
- CRT filter on/off (RetroArch)
- Widescreen and other patches as toggles (where available)
- Mods → mod manager for this game
- Save backups → list by date with Restore and Open folder
- Open folder → saves / mods / textures / patches / game files
- Game info (title, ID, file size, play time)
- Refresh artwork
- Delete game, with confirmation and a choice to keep or delete saves

## 10. Mods

Every game gets a mod manager with on/off toggles, file installs and GameBanana browsing.

- **Mod manager** (Triangle → Mods): installed mods with toggle, description, delete.
- **Add from file:** zip, 7z, rar or folder; Starstation unpacks it, places it using the preset's folder rules, and asks if unsure.
- **Browse GameBanana:** search mods for the selected game with pictures and descriptions; one-click install.
- **Storage:** originals in `mods\<game>\`; switching on copies or links into the emulator folder, switching off removes only that copy.
- **Conflicts:** when two mods touch the same files, Starstation warns and the user picks which one wins.
- **Texture packs:** handled like mods (PCSX2, Dolphin, Azahar, RetroArch N64).
- **Patches and cheats:** built-in emulator patches as Triangle-menu toggles.
- **Safety:** a save backup is made before a mod is first switched on.
- **Packages:** mods are exported with their on/off state.

## 11. Settings

Settings is the far-left XMB column and covers everything without editing files by hand.

- **Consoles:** list with status (e.g. "NES · 0 games · Ready"), Add games, add from preset or advanced form, edit, remove.
- **Emulators:** installed versions, "Update available" with Update button, repair, reinstall.
- **Controllers:** map once, applied to all emulators; test screen; per-console overrides; screenshot button.
- **Library:** rescan, refresh titles and artwork, clear cache, ScreenScraper login.
- **Health check:** emulators, BIOS/firmware/keys, broken games, disk space; each issue has a Fix button or an instruction.
- **Graphics defaults:** default level and CRT filter.
- **RetroAchievements:** log in once for all supported emulators.
- **Netplay:** nickname (host/join lives in the Triangle menu).
- **Steam:** "Add Starstation to Steam" for Big Picture mode.
- **Packages:** Send package, Receive package.
- **General:** start fullscreen, start with Windows, sounds, music, screensaver time, show empty consoles.
- **Diagnostics:** Export report (logs + settings in one zip).
- **About:** version, check for updates, licenses of bundled emulators.

## 12. Setup wizard & packages

A first-start wizard sets up any PC, and packages copy a full setup to another PC by code.

### Setup wizard (first start)

1. Welcome screen in Starstation style.
2. Install location: default `Desktop\Starstation`. If an existing `Files\` folder is found → "Continue where you left off?"
3. How to start: **Receive package** (code or folder) · **Import from EmuDeck** (copies only needed emulators, BIOS, saves, games; sets portable mode; deletes nothing) · **Start fresh**.
4. Emulators downloaded or verified.
5. BIOS & firmware status per console; PS3 firmware linked from Sony's site and installed.
6. Controller test and one-time mapping.
7. Artwork: download now or later.
8. Done → boot animation → XMB.

### Packages

- **Send:** Settings → Send package → checkboxes: emulators, BIOS, games (pick which), mods, settings, saves (optional). Everything except saves is ticked by default.
- **Transfer:** by code via croc (encrypted, resumes after interruptions; both PCs online) or Save to folder.
- **Receive:** enter the code or pick the folder; everything goes where it belongs.
- **Never included:** favorites, play time, recently played.
- **Existing setup:** new games and mods are added, nothing is deleted; Starstation asks "Use settings from package / Keep mine".

## 13. Install, updates, uninstall

A normal Windows installer from GitHub releases; the app updates itself and uninstalling never loses games or saves.

- **Installer:** .exe from GitHub releases; creates `Desktop\Starstation\` with the shortcut and `Files\`. Unsigned, so Windows warns once ("More info → Run anyway").
- **Starstation updates:** automatic — checked at startup, installed in the background, active on next start.
- **Emulator updates:** "Update available" notification; the user decides in Settings → Emulators.
- **Preset updates:** delivered with Starstation updates.
- **Uninstall:** removes the shortcut and `Files\app\`; everything else in `Files\` stays.
- **Reinstall:** detects the existing `Files\` folder and continues where it left off.

## 14. Build plan (one phase)

The whole app is built in one continuous run of internal steps, with one non-blocking milestone when games become playable.

### Start-of-run checklist (with Hannes, all at once)

- [ ] GitHub login (`gh auth login`), create repo `starstation`
- [ ] ScreenScraper credentials → stored in local settings only
- [ ] RetroAchievements credentials → stored in local settings only
- [ ] Controller plugged in and detected

### Internal steps (no approval needed between them)

1. **Explore:** map `C:\Emulation` and EmuDeck's emulator installs, existing saves and BIOS, PS3 game formats; check whether the Desktop is synced with OneDrive and warn if so. Write findings to PROGRESS.md.
2. **Foundation:** Electron app, XMB interface, controls, boot animation, sounds, notifications, date/time.
3. **Library & launching:** preset system, PS1–PS3 presets, scanning, titles, launch → return, play time.
4. **Import from EmuDeck + emulator manager:** migrate Hannes's setup into `Desktop\Starstation\Files`. **Playable milestone:** tell Hannes "Playable version ready, test when you like" and keep working.
5. **Remaining presets:** RetroArch (NES, SNES, N64), Dolphin (GameCube, Wii), Azahar, xemu, Xenia.
6. **Game experience:** Triangle menu, favorites, collections, search, info panel, save backups, quick resume, delete game.
7. **Controllers & graphics:** unified mapping, screenshot button, graphics levels, CRT filter, patches, shader hint.
8. **Mods:** mod manager, add from file, GameBanana, conflicts, texture packs.
9. **Artwork & atmosphere:** PS3 icons, libretro thumbnails, ScreenScraper, Photo column, screensaver, music, controller battery.
10. **Settings complete:** health check, diagnostics, RetroAchievements, netplay, Steam.
11. **Setup wizard & packages:** wizard, send/receive by code, save to folder.
12. **Release:** installer, auto-updates, uninstall/reinstall behavior, first GitHub release; final report to Hannes with a test checklist.

## 15. Rules for Claude Code

Work autonomously, safely and verifiably; stop only for the three cases below.

**Only stop for:**

1. Deleting or moving Hannes's personal files (games, saves, BIOS, EmuDeck) — except moving games into `Files\games\` after a verified copy of everything else during the EmuDeck import.
2. Something only Hannes can physically do (logins, plugging in a controller, testing feel).
3. A problem that would change a decision in this spec.

**Always:**

- Read SPEC.md and PROGRESS.md at the start of every session; update PROGRESS.md after every step.
- Git commit after every working step; tag each internal step, so anything can be undone.
- Keep the app working at the end of every step — no half-built states.
- Test everything yourself: automated UI tests for the interface, and actually launching a game per preset to confirm it starts and returns to the menu.
- Before each preset, check the emulator's current version and launch flags; emulators change.
- Migration copies first, verifies, and only then moves games. Never touch the original EmuDeck install beyond reading it.
- Never commit BIOS, games, firmware, keys or credentials to the repo (.gitignore them).
- Original design only: no Sony logos, fonts or sounds.
- Make small technical choices yourself and note them in PROGRESS.md.
- Write logs to `Files\config\logs` for debugging and the diagnostics export.
