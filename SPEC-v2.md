# Starstation v2 — Build Spec & Kickoff

Nov 4, 2026 · @Hannes Freymuth

**Claude Code: this entire message is the v2 specification for Starstation, which you already built from `SPEC.md`.** Save this entire message as `SPEC-v2.md` in `Desktop\Starstation\Files\source`, next to `SPEC.md` and `PROGRESS.md`. Then follow the kickoff below.

## Kickoff (instructions for Claude Code)

1. Read `SPEC.md`, `PROGRESS.md` and this whole spec before doing anything. Everything in `SPEC.md` still applies unless this spec changes it.
2. **First fix every item in "Your v1 test notes"** below. Then build everything in this spec in one continuous run, following the build plan at the end.
3. All rules from `SPEC.md` Section 15 still apply, plus the extra rules at the end of this spec. Only stop for the three cases listed there.
4. Keep `PROGRESS.md` updated after every step. In every new session (Hannes will just write "Continue building Starstation v2"), read `SPEC.md`, `SPEC-v2.md` and `PROGRESS.md` and continue from the next unfinished step without asking.
5. Ship v2 through the new beta channel (Section B): Hannes gets it first, siblings only after he presses "Release to everyone".

## Your v1 test notes

Hannes fills this in after testing v1, before pasting. One line per problem: what you did, what happened, what should have happened. Leave it empty if nothing broke.

-
-
-

## Scope

v2 combines a stabilization pass ("couch-ready") with new features, built in one run.

- **In:** couch-ready core, safe updates, trophies, video previews, TV mode and power menu, themes, compression, compatibility labels, manuals, mod profiles, more mod sources, patch-file mods, smart packages, safe mode, controller-only system settings, multiple profiles, menu remapping and text size.
- **Dropped:** year-in-review screen, phone companion, Windows startup handling (auto-login, start on boot, TV audio), Starvis house, clip recording.
- **Later:** presets for more consoles (PSP, DS, GBA/GB, Sega, PS Vita, Wii U, Switch, arcade) come in a separate update, as do signed updates.

## A. Couch-ready core

Everything must work with only a controller, from the XMB into a game and back.

- **PS button menu (in-game overlay):** pressing the PS/Home button during a game opens a small XMB-style overlay: Resume · Save state · Load state · Screenshot · Controller settings · **Save and quit** (quick-resume state, then close) · **Quit** (close without saving a state). Closing the emulator window normally still works.
- **Borderless fullscreen:** all emulators run borderless fullscreen so the overlay can appear on top.
- **Controller check per emulator:** verify each emulator works with a PlayStation controller directly. For emulators that only accept Xbox controllers, install a translation driver automatically, only for those emulators.
- **Steam / Xbox Game Bar conflicts:** detect when Steam or the Game Bar grabs the PS/Home button and show a one-time guide to switch it off. Never change other apps' settings.
- **Controller assignment screen:** appears automatically when 2+ controllers are connected and a multiplayer-capable game starts ("Press ✕ for Player 1" … up to 4).
- **Focus guard:** Starstation always comes back to the front when a game closes and never steals focus while a game runs (notifications wait until the game ends).
- **Runtime check:** the installer bundles the Visual C++ runtimes and DirectX parts emulators need; the health check warns about outdated GPU drivers.
- **Conversion on import:** Xbox games to XISO, PS3 PKG games installed into RPCS3, multi-disc games get a playlist (.m3u), 3DS games checked for decryption with a clear message if encrypted.
- **Couch test:** a fixed checklist Claude Code runs per console (start, play, PS button menu, Save and quit, back to XMB, controller only) and a test helper Hannes can run once.

## B. Safe updates

A broken update must never reach the siblings, and any update can be undone in one click.

- **Beta channel:** Hannes's Starstation receives every new version first (GitHub pre-release). In Settings, a **Release to everyone** button (visible only on his PC) promotes it to a normal release for everyone else.
- **Emulator updates through the same channel:** new emulator versions are offered to Hannes first; once he confirms, they are marked as tested and offered to everyone. Presets list the tested emulator version.
- **Undo update:** the last 3 Starstation versions are kept; Settings → About → Undo update.
- **Automatic rescue:** if Starstation crashes twice in a row right after an update, it returns to the previous version by itself and shows a message.
- **What's new:** after an update, a short XMB-style summary of changes, with **Show details** for the full list.

## C. Console feel

New touches that make Starstation feel more like a real console.

- ~~**Trophies:**~~ *Removed in 2.0.13 (Hannes: simplify the program as much as possible).* a Trophies column collecting RetroAchievements plus Starstation's own trophies, with bronze / silver / gold tiers and a platinum for unlocking all Starstation trophies. Starstation trophies: play time milestones (10 / 50 / 100 / 500 hours), games played per console, first mod installed, first netplay session, every console played at least once, "Collector" for big libraries.
- **Video previews:** a short gameplay clip starts after resting on a game for about 2 seconds, sound on (quiet). Clips come from ScreenScraper, downloaded in the background together with artwork and manuals; games without a clip show their background image.
- **TV mode:** a setting for bigger text and icons when playing from the couch.
- **Power menu:** Sleep and Turn off PC in the XMB.
- **Themes:** XMB color schemes (instead of the monthly color), a wallpaper per console, the user's own image as background, and a Starvis-style theme.

## D. Library & storage

Save disk space, set expectations per game, and add manuals.

- **Storage manager:** disk usage per console in Settings.
- **Compress (manual only):** a Compress button converts PS1/PS2 to CHD and GameCube/Wii to RVZ (lossless, games run identically). After the converted file is verified, the original is deleted. A Decompress option restores a bit-identical original.
- **Compatibility labels** for PS3 and Xbox 360 games: Runs well / Playable / Issues / Doesn't start, from the emulators' public compatibility lists, with known per-game fixes applied automatically. Games marked "Doesn't start" stay visible with a warning.
- **Manuals:** scanned original game booklets from ScreenScraper, downloaded with artwork and videos, viewed page by page with the controller from the Triangle menu.

## E. Mods

More ways to get mods and switch between setups.

- **Mod profiles:** every game has a Vanilla profile (no mods) plus any user-made profiles ("HD", "Chaos run"…). Switch with one click in the Triangle menu while the game isn't running.
- **Nexus Mods:** free account; the user clicks "Download with mod manager" on the Nexus website and Starstation catches the link and installs the mod.
- **Patch-file mods** (xdelta, ppf, ips, bps): Starstation unpacks a temporary copy if the game is compressed, applies the patch, and stores the patched copy. On the normal game entry it appears as a mod toggle that switches which copy launches — no separate list entry.
- **Manual mods:** when a mod can't be installed automatically, Starstation shows its instructions on screen with an Open target folder button.
- **Community patch and cheat collections** (widescreen, 60 fps, cheats for PCSX2, RPCS3, Dolphin): updated only when the user presses Update patches.

## F. Sharing

Packages send only what the other PC is missing.

- **Smart packages:** before sending, the receiving Starstation reports what it already has (games, mods, emulator versions, settings, profiles); only the difference is sent.
- **Send only new since last time:** a quick option that packs everything added or changed since the last package sent to that PC.
- **Profiles in packages:** an optional checkbox sends one or more profiles with their saves, play time, trophies and favorites, so a profile can move to another PC. If a profile with the same name exists there, Starstation asks: merge, replace, or keep both. Without that checkbox, favorites, play time and recently played stay local as before.
- Everything else about packages stays as in `SPEC.md` Section 12.

## G. Reliability & system

The things that keep Starstation safe and fixable, and keep Windows out of sight.

- **Safe mode:** hold ○ during the boot animation, or choose Settings → Start in safe mode, to start without mods, themes and custom settings. Also offered automatically after a crash. Leaving safe mode restores everything.
- **Controller-only system settings** inside Starstation: Bluetooth controller pairing, audio output (speakers / headset / TV), display resolution and refresh rate. No Windows menus needed.
- **Profiles:** a Users entry in the XMB (like the PS3) on every PC. Any number of profiles can be created, renamed or deleted, plus a built-in Guest profile. Each profile has its own saves, play time, trophies, favorites and recently played. On startup Starstation asks "Who's playing?" like the PS3. Profile pictures: built-in icons or the user's own image. Optional PIN per profile; the PC's main profile (the first one created) can reset any other profile's PIN. The Guest profile is cleared automatically (saves, play time, trophies, favorites) when the guest session ends, i.e. on switching profile or closing Starstation.
- **Accessibility basics:** remap the menu buttons, and set text size independently of TV mode.

## Build plan and extra rules

One continuous run; fixes first, couch-readiness second, features after.

### Internal steps

1. **Fix v1 test notes** (section above), each with a commit.
2. **Safe updates** (Section B) plus safe mode (Section G) — built first so every later step ships safely through the beta channel.
3. **Couch-ready core** (Section A), ending with the couch test passing on every console. **Couch-ready milestone:** tell Hannes "Couch-ready version on beta, test when you like" and keep working.
4. **Library & storage** (Section D).
5. **Mods** (Section E).
6. **Console feel** (Section C).
7. **Sharing** (Section F), then the rest of Section G (system settings, profiles, accessibility).
8. **Release:** publish v2 to the beta channel, final report to Hannes with a test checklist. Siblings get it only after he presses Release to everyone.

### Extra rules (on top of `SPEC.md` Section 15)

- Rerun the couch test after every step that touches launching, controllers or the overlay.
- Never ship to the stable channel yourself; only Hannes releases to everyone.
- Compression deletes originals only after verifying the converted file opens and its data matches.
- The translation driver is installed only for emulators that fail the controller check, and logged.
- Never change Steam, Game Bar or other apps' settings; guide the user instead.
