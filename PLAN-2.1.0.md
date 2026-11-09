# Plan: Starstation 2.1.0 "Solid ground"

Planned 2026-11-09 by Claude with Hannes. Goal and scale: see `PROJECT.md` (family + friends, stabilize first).
Sources: ChatGPT's audit (`Documents\Codex\2026-11-08\…\outputs\Starstation-Claude-Code-Implementation-Brief.md`,
findings #01–#44) and the problems Hannes hit on 2026-11-08 (driver removed, PS button, GT4 lag).

Version 2.1.0, not 2.0.37: ChatGPT built an unpublished "2.0.37" installer in its own copy of the code, and the
name must not be confused with it. That copy (`Documents\Codex\…\work\audit`) is used as a **reference only**:
where it already solved a point, its idea is checked and brought over with a test, never copied wholesale.

Every fix: reproduce the bug in a test first, then fix it. Spot-checked in the real code on 2026-11-09 and
confirmed: #01, #02, #03, #06 (path handling), #13, #14, #24, #34, #39.

## Block A — Saves and data never lost (do first)

| # | What | Why it matters here |
|---|---|---|
| 01 | Check big files by content (streaming hash) before deleting the original after a move/copy, not only by size (≥ 64 MB today) | Importing/compressing games deletes originals |
| 02 | Save backups and resume history per profile | Siblings sharing a PC could overwrite each other's saves |
| 03, 04 | Profile switch: keep the safety journal until the new profile is saved as active; record what existed before each move | A crash mid-switch can put saves in the wrong profile |
| 05 | Restore a backup into a staging folder, check it, then swap; never empty the live save first | A broken backup can wipe the current save |
| 06 | Mod files may only be written/deleted inside their allowed folders (no `..`, no absolute paths, no links escaping) | Packages from friends bring mod data |
| 07 | Packages: leave out logins/tokens inside emulator settings (RetroAchievements etc.), not only `secrets.json` | Packages now go to friends |
| 08 | One shared "busy" guard: no launch, restore, profile switch, mod change or package receive at the same time on the same data | Mixed operations = mixed data |
| 14 | Don't delete a mod when switching it off failed (file locked); keep it listed as "needs cleanup" | Small, real data loss |
| 21, 22 | Same checks for the `.bak` copy as for the main JSON; change settings in memory only after they were saved | Small |
| 23 | Backups report what really happened (made / unchanged / too big / failed); a failed protective backup before a risky step asks first | No false "your save is backed up" |

## Block B — Downloads, imports, emulator updates

| # | What |
|---|---|
| 11 | Downloads: handle disk/network errors on both sides, stall timeout (no endless hang), clean up partial files, retry works |
| 12 | Emulator updates: unpack into a separate folder, check the program is there, then switch; the old version stays until the new one works |
| 13 | PS3 game installs count as done only with exit code 0 *and* the game's files present; otherwise the .pkg is kept |
| 09, 10 | Importing disc games (.cue/.bin): check all files of a game before moving any; a different `track.bin` with the same name is a conflict, not "already there" |
| 29 | New downloads folder: don't re-walk already handled folders every 4 s; a failed item retries later |

## Block C — Controllers (Hannes's top wish)

| From | What |
|---|---|
| 2026-11-08 | PS2 (PCSX2): SDL with raw input instead of XInput (done on Hannes's PC; fixes GT4 lag from slow empty XInput slots). Add a test and keep the player order when chosen on the player screen |
| 2026-11-08 | Same fix for PS1 (DuckStation) and a check of RetroArch / Dolphin / RPCS3 for the slow-slot lag |
| 2026-11-08 | Detect a PS3 pad whose driver is gone (Windows "Error", code 19) → offer "Install driver" again (today Starstation thinks it's fine) |
| 2026-11-08 | Steam / Game Bar taking the PS button: health check gets a "Fix it" button for the Game Bar (Windows setting, reversible) and clear steps for Steam |
| 25 | Each emulator gets the right buttons per controller kind: DS4/DualSense, Xbox, generic USB pads (no "PS4 controller" guess for unknown pads); RetroArch and Dolphin per player, not one choice for all |
| 26 | Pad helper: every request gets its own ID, so a late answer can't confirm the wrong action; Bluetooth scans don't block focus/close |
| 27 | PS menu: if the overlay crashes, the game is resumed, not left paused. (Showing it on the game's monitor with two screens: later) |

## Block D — Everyday bugs and weak PCs

| # | What |
|---|---|
| 34 | Right-click opens the menu of the game you clicked, not the previously selected one (dangerous with "Delete") |
| 24 | Change/remove your own PIN from the menu (asks for the old one); the main profile can still reset others' PINs |
| 35 | Every loading screen can be left with ○ and shows an error with "Try again" instead of loading forever (no full rework) |
| 28 | Library scan in the background (worker), so a big library or a slow USB drive doesn't freeze the menu; an unreachable drive doesn't remove its games |
| 31 | No blocking 900 ms waits on the main thread when antivirus locks a file |
| 33 | Stop menu animations while Starstation is hidden / a game runs; "Reduced animations" option for weak PCs |

## Block E — Updates and releases

| # | What |
|---|---|
| 37 | Check the rescue/rollback installer before using it; if the installer can't start, Starstation stays open with a message |
| 38 | `release.mjs` runs typecheck + unit + e2e tests first and stops on any failure |
| 39 | `release.mjs` never overwrites files of an existing release (`--clobber` only for the current, unreleased beta) |
| 43 | "Send logs" removes passwords/tokens/keys before exporting (friends will send logs) |

## Not in this update, and why

- **Later, in a "Packages" update:** #17 profile names on receive, #18 smart-package completeness, #19 package staging/cancel, #20 refresh after receive, #30 package size speed. Packages are used rarely; do them together.
- **Later, in a "Mods" update:** #15 crash-safe mod placement, #16 safe-mode bookkeeping. Rare (crash during mod placement).
- **Later:** #36 permanent game IDs (big redesign; only matters for games without serials with the same name), #44 storage cleanup screen, #32 copy speed tuning (measure first), #27 two-monitor overlay.
- **Covered by the test checklist instead:** #40 (install on a sibling's/friend's PC before releasing to everyone), #41 (controller × emulator table in the checklist).
- **Not doing (overkill for family + friends, see PROJECT.md):** VM test matrices, usability study with 5 strangers, code signing, formal speed targets (#42), 44-item tracker, moving the install out of `Desktop\Starstation` (W04: the one-folder layout is intended).

## Order and size

A → B → C → D → E, one commit per item with its test. Expected: 3–5 working sessions.
Then: full tests, packaged check, beta 2.1.0 to Hannes (only after he says go), a new ~45-minute test checklist,
one install on a sibling's PC, then Hannes presses "Release to everyone".
