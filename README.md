# Starstation

A console-style menu for emulated games on Windows: every console in one crossbar menu, controller first.
One folder holds everything — emulators, games, saves, mods — and nothing else on the PC is touched.

**Consoles:** NES, SNES, N64 (RetroArch) · GameCube, Wii (Dolphin) · 3DS (Azahar) · PS1 (DuckStation) · PS2 (PCSX2) · PS3 (RPCS3) · Xbox (xemu) · Xbox 360 (Xenia) · plus any other emulator through "Add a console".

## Install

1. Download `Starstation-Setup-<version>.exe` from [Releases](https://github.com/hannesfrey/starstation/releases).
2. The installer isn't signed, so Windows warns once: **More info → Run anyway**.
3. It creates `Desktop\Starstation` with the **Starstation** shortcut and a `Files` folder.

Updates install themselves (active on the next start). Uninstalling removes only the program and the shortcut — games, saves and settings in `Files` stay, and a reinstall continues where you left off.

## What's inside

- Emulators downloaded from their official releases, set up in portable mode.
- Import from EmuDeck: copies emulators, BIOS and saves, checks the copies, then moves the games. Deletes nothing.
- Quick resume, save backups (last 5 per game), favorites, collections, search.
- One controller mapping for all emulators, F12 screenshots, graphics levels, CRT filter, widescreen patches.
- Mod manager with GameBanana, texture packs, conflict handling.
- Artwork from libretro thumbnails, RetroAchievements, online play (NES/SNES/N64), Add to Steam.
- Packages: copy a whole setup to another PC by code (croc) or by folder.

BIOS files, firmware and games are not included and never downloaded by Starstation — use dumps of your own consoles and games. PS3 firmware comes from Sony's official page.

Starstation uses only its own artwork and sounds. The emulators belong to their authors under their own licenses (Settings → About → Licenses). Bundled helpers: 7-Zip (`7zr.exe`, LGPL) and croc (MIT).

## Development

Portable toolchain in `tools\` (`. .\env.ps1`), then `npm run dev`, `npm test`, `npx playwright test` (runs the real app hidden and muted), `npm run dist`. See `SPEC.md` and `PROGRESS.md`.
