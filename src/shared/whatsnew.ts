/**
 * "What's new" after an update (SPEC-v2 B). Newest first. Shown once after updating to a version;
 * a version without its own entry shows the newest entry that is older than it.
 * summary: a few short lines for the first screen; details: the full list behind "Show details".
 */

export interface WhatsNew {
  version: string
  summary: string[]
  details: string[]
}

export const WHATS_NEW: WhatsNew[] = [
  {
    version: '2.0.0',
    summary: [
      'Press the PS button in any game: resume, save states, or save and quit without a keyboard',
      'Profiles for everyone in the house, each with their own saves and trophies',
      'Mods, trophies, themes and system settings, all from the couch'
    ],
    details: [
      'PS / Guide button menu over every game: Resume, save and load states, screenshot, controller settings, Save and quit, Quit.',
      'Player order: pick which controller is player 1–4 before a game starts.',
      'Profiles: each person gets their own saves, play times, favorites and trophies, with an optional PIN. Guest leaves nothing behind.',
      'Starstation trophies for play time, your library and first times, in bronze, silver and gold, plus a platinum for all of them. RetroAchievements show up too.',
      'Mods: sets you can switch with one press (Vanilla is always there), patch files (IPS/BPS/PPF/xdelta), Nexus Mods links, checked game update patches, and mods you install by hand. Safe mode still starts without them.',
      'Storage: see what takes space per console, and compress games without losing anything (the original goes only after the copy is checked).',
      'Compatibility notes per game, and game manuals you can read with the controller.',
      'Themes (including a night sky), wallpapers, TV mode and short video previews when you rest on a game; text size and button layout under Accessibility.',
      'Settings → System: sound output, screen mode (goes back by itself after 15 s unless you keep it) and Bluetooth controllers.',
      'Sharing: packages only send what the other PC doesn’t have yet, and can carry profiles with their saves.',
      'Power: sleep or shut down the PC from the menu.'
    ]
  },
  {
    version: '1.9.0',
    summary: [
      'Safer updates: new versions reach this PC first, and any update can be undone',
      'Safe mode: start without mods and custom settings',
      'Xbox 360 covers, and your own covers and backgrounds'
    ],
    details: [
      'Beta channel: the tester PC gets every new version first; everyone else only after "Release to everyone".',
      'Settings → About → Undo update goes back to one of the last 3 versions.',
      'If Starstation closes unexpectedly twice right after an update, it goes back to the version before by itself.',
      'New emulator versions are offered to the tester first; others get them once they are marked as tested.',
      'Safe mode: hold ○ while Starstation starts, or Settings → Start in safe mode. Offered after a crash, too.',
      'Xbox 360 games get their cover and background from Microsoft’s Xbox image server.',
      'Game options → Choose cover… / Choose background… for your own pictures.',
      'Missing artwork is looked for again every time Starstation starts.'
    ]
  }
]

export function whatsNewFor(version: string, compare: (a: string, b: string) => number): WhatsNew | null {
  return WHATS_NEW.find((w) => compare(w.version, version) <= 0) ?? null
}
