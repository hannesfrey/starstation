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
