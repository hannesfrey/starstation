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
    version: '2.0.12',
    summary: ['PS3 game updates: Starstation offers them when you start a game, like the PS3'],
    details: [
      'When a PS3 game has an update on PlayStation Network, starting it asks: Update now, or Play without updating.',
      'Update now downloads every update the game is missing from Sony’s own update server, checks each one against Sony’s checksum, installs them in order and then starts the game.',
      'Updates fix bugs and crashes in the games themselves (Call of Duty: Black Ops II goes from 1.00 to 1.19, Gran Turismo 6 to 1.22).',
      'Adding a PS3 package (.pkg) yourself installs it without opening RPCS3’s window.'
    ]
  },
  {
    version: '2.0.11',
    summary: ['PS3 games really run in borderless fullscreen now'],
    details: [
      'RPCS3 ignored Starstation’s fullscreen setting and picked a mode by itself, which can switch the screen to exclusive fullscreen and trouble the PS button menu. It now gets a value it accepts.',
      'If an emulator refuses one of Starstation’s settings, that is now noted in Starstation’s log.'
    ]
  },
  {
    version: '2.0.10',
    summary: ['Player 2 works from the first start, without restarting the game'],
    details: [
      'Starting a game with ○ ("usual order") on the player screen used to set up player 1 only. Now every connected controller gets a player.',
      'PS3: a new player gets the same button settings as player 1, so every game recognises the controller.'
    ]
  },
  {
    version: '2.0.9',
    summary: ['The PS button only opens Starstation’s menu now', 'Save and quit waits for slow games instead of cutting them off'],
    details: [
      'RPCS3, PCSX2, DuckStation, RetroArch and Xenia no longer react to the PS / Guide button themselves (RPCS3 opened its own menu, PS1/PS2 switched the sticks’ analog mode). xemu’s own small menu is closed again when you resume.',
      'Save and quit: the menu shows "Closing…" until the game is really gone. A game that takes long to close gets 20 seconds before it is ended — even if you choose Save and quit twice.',
      'The ✕ you pressed to quit can no longer start the game again by itself.',
      'When an emulator closes, its log is kept (Files\\config\\logs\\emulators), and if RPCS3 reports a fatal error you see it as a notice.',
      'A game you download twice is recognised: "Already in your library", and the extra download goes to the Recycle Bin.',
      'Starstation updates only download what changed (about 2 MB instead of 230 MB).'
    ]
  },
  {
    version: '2.0.8',
    summary: ['3DS games that need a Mii start now (Mario Kart 7)'],
    details: ['Some 3DS games refuse to start without a Mii. Starstation now puts its own Mii, called Player, into the 3DS Mii list when it is empty. Miis that are already there are never changed.']
  },
  {
    version: '2.0.7',
    summary: ['3DS games work with your controller'],
    details: ['Azahar (3DS) was left on keyboard keys. Starstation now sets it up for any connected controller: right button = A, bottom = B, triggers = ZL/ZR, left stick = circle pad, right stick = C-stick.']
  },
  {
    version: '2.0.6',
    summary: ['Game sound is back: games are never left muted in Windows'],
    details: [
      'Starstation’s own controller test had muted the emulators in the Windows volume mixer, and Windows kept that mute. Every game start now makes sure the game can be heard.'
    ]
  },
  {
    version: '2.0.5',
    summary: ['PS3 games show their box covers', 'New console icons, a new controller icon and cleaner button hints'],
    details: [
      'PS3 games now show the front of their box like PS2 and Xbox games (from GameTDB, by the game code). The game’s own background stays; its small disc banner is only used until a cover is found.',
      'Every console has its own icon now, drawn after the real console: NES, SNES, N64, GameCube, Wii, 3DS, PlayStation, PS2, PS3, Xbox and Xbox 360.',
      'The controller icon is redrawn.',
      'Button hints are drawn instead of typed: ✕ ○ △ □ (or A B X Y) are all the same size, L1/R1 look like shoulder buttons and Start/Select like small pills.'
    ]
  },
  {
    version: '2.0.4',
    summary: ['Adding mods: put them into the mods folder and Starstation does the rest'],
    details: [
      'Put a mod (zip, 7z, folder or patch file) into Files\\mods — or a console folder like mods\\ps2. Starstation unpacks it, finds the game, installs it, switches it on, and moves the original to the Recycle Bin.',
      'The game is found from the mod’s name or the game codes in its readme. If it can’t tell, it asks you once which game it’s for.',
      'A patch made for a different version of a game is refused with its own instructions quoted, instead of failing quietly.',
      'Texture packs: optional extras next to the "replacements" folder (like alternate textures) are no longer switched on by mistake, and packs with a single sub-folder land in the right place.',
      'Mods with nothing the emulator can load are kept with their instructions instead of being put somewhere useless.'
    ]
  },
  {
    version: '2.0.3',
    summary: ['PS3 controllers work on any PC: Starstation brings their driver and installs it when you plug one in'],
    details: [
      'A PS3 controller needs a driver on Windows (PS4, PS5 and Xbox controllers don’t). Starstation now brings it: DsHidMini by Nefarius.',
      'Plug in a PS3 controller and choose Install driver. Windows asks for permission once; after that the controller works in Starstation and every game.',
      'Controllers set up with the old SCP driver are moved over to the new one, and SCP Server isn’t needed any more.',
      'Settings → Health check shows it when a PS3 controller still needs its driver.'
    ]
  },
  {
    version: '2.0.2',
    summary: ['PS3 controllers on the SCP driver work right after a restart: Starstation starts SCP Server for you'],
    details: [
      'A PS3 controller set up with the SCP driver only works while SCP Server runs, and that doesn’t start with Windows. Starstation now finds it and starts it (minimized) when it opens and before a game starts.',
      'Settings → Health check shows it when SCP Server isn’t running, with a button to start it.'
    ]
  },
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
