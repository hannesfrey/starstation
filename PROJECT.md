# Starstation — what this project is (read this first)

Written with Hannes on 2026-11-09. Any AI or person working on Starstation: read this before planning, reviewing
or changing anything. It sets the scale of the project, and with it how much process a change needs.

## In one sentence

A console-style menu for emulated games that Hannes builds **for himself, his siblings and friends**, so that
anyone he gives it to can plug in a controller and play, without knowing anything about emulators.

## Who it is for

- **Users:** Hannes, his siblings and friends he gives the installer or a package to. Not the general public.
  The GitHub repo is public only so updates can download without logins. Nobody finds it there by accident.
- **Their PCs:** all kinds: gaming PCs, but also older laptops and weak PCs, Windows 10 and 11, 64-bit.
  On a weak PC the menu and the older consoles must still work. A heavy console (PS3, Xbox 360) on a weak PC is
  allowed to say "this PC is too slow for this" instead of trying.
- **Who works on the code:** Hannes with AI tools (Claude Code, ChatGPT/Codex). Others might contribute later,
  so keep the code readable and the docs current, but no contributor process is needed.
- **Hannes is not a programmer.** Explain results in plain words: what happened, what he needs to do.

## What matters most (in this order)

1. **Never lose saves, games or settings.** Anything that moves, deletes or replaces user data must be safe
   against crashes, full disks and bad files. This is not negotiable even at family scale.
2. **It just works.** Day-to-day use is smooth: start, pick a game, play, PS button, back to the menu.
   Fixing a problem people actually hit beats handling rare edge cases.
3. **Controllers.** These must work in the menu *and* in every emulator: PS3 (DualShock 3 via DsHidMini),
   PS4/PS5 (DualShock 4 / DualSense, cable and Bluetooth), Xbox pads, and cheap generic USB pads
   ("Amazon-type"). Others (Switch Pro, 8BitDo…) are a bonus. Wheels never drive the menu.
4. **Works on weak PCs.** The menu must stay responsive on an old laptop: no long freezes, low idle CPU.
5. New features come *after* the above. **Current phase: stabilize first, then features again.**

## The right amount of process (family + friends scale)

Do:
- A regression test for every bug fixed (reproduce it first, then fix).
- Automated tests run before every release (`npx tsc`, `npx vitest run`, `npx playwright test`, packaged check).
- One beta at a time: Hannes gets it first, tests with a **~45-minute checklist**
  (`Desktop\Starstation\Test checklist.txt`), and only he presses "Release to everyone".
- Before a big release: one install on a sibling's or friend's PC (that is the "clean PC" test).
- Plain-language release notes ("What's new") and a test checklist for Hannes.

Don't (overkill at this scale, unless Hannes asks):
- Virtual-machine test matrices, usability studies, formal performance targets, signed installers,
  44-item trackers, company-style release gates or certification paperwork.
- Rewrites. Improve the existing code in small, tested steps.

## Ground rules

- **Ask Hannes before publishing anything:** GitHub releases, betas, "Release to everyone".
- Changes outside `Files\` (drivers, Windows settings, other apps' settings) are fine when Starstation needs
  them to work: log them, keep them reversible and tell Hannes what was changed.
- Don't experiment on Hannes's real saves: test with throw-away copies. Before touching real user data, make
  a backup.
- **One codebase:** `Desktop\Starstation\Files\source` (git, pushed to `hannesfrey/starstation`). If you work
  in a copy somewhere else, say so clearly and bring the changes back as commits here. Never ship a build from
  a copy.
- BIOS, firmware and games are never included or downloaded (except PS3 firmware from Sony's official page).

## Where things are

- `SPEC.md`, `SPEC-v2.md`: what was built and why (the original build specs).
- `PROGRESS.md`: current state, handoff notes, decisions, release routine. Start of every session.
- `Desktop\Starstation\Test checklist.txt`: Hannes's current test round.
- Logs: `Files\config\logs\` (Starstation, emulators, driver setup).
