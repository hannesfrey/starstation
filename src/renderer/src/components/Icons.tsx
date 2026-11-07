import type { ReactElement } from 'react'

/** Original line icons (no console logos). 64×64 viewBox, white strokes. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const shapes: Record<string, ReactElement> = {
  settings: (
    <g {...S}>
      <circle cx="32" cy="32" r="8" />
      <path d="M32 10v7M32 47v7M10 32h7M47 32h7M16.4 16.4l5 5M42.6 42.6l5 5M16.4 47.6l5-5M42.6 21.4l5-5" />
      <circle cx="32" cy="32" r="16" />
    </g>
  ),
  photo: (
    <g {...S}>
      <rect x="10" y="16" width="44" height="32" rx="4" />
      <circle cx="24" cy="28" r="4" />
      <path d="M12 44l14-12 10 8 6-5 10 9" />
    </g>
  ),
  collections: (
    <g {...S}>
      <rect x="14" y="20" width="36" height="28" rx="3" />
      <path d="M18 15h28M22 10h20" />
    </g>
  ),
  cartridge: (
    <g {...S}>
      <path d="M16 12h32v40H16z" />
      <path d="M22 12v10h20V12M22 40h20M22 46h20" />
    </g>
  ),
  'cartridge-wide': (
    <g {...S}>
      <path d="M10 16h44v32H10z" />
      <path d="M18 16v-4h28v4M18 28h28v12H18z" />
    </g>
  ),
  'cartridge-n64': (
    <g {...S}>
      <path d="M12 14h40l-4 36H16z" />
      <path d="M20 22h24M22 30h20M26 50v-8h12v8" />
    </g>
  ),
  disc: (
    <g {...S}>
      <circle cx="32" cy="32" r="21" />
      <circle cx="32" cy="32" r="5" />
      <path d="M32 17a15 15 0 0 1 15 15" opacity=".6" />
    </g>
  ),
  'disc-mini': (
    <g {...S}>
      <circle cx="32" cy="32" r="18" />
      <circle cx="32" cy="32" r="4" />
      <path d="M44 20l6-6M14 50l6-6" opacity=".6" />
    </g>
  ),
  // ---- consoles: each one's own silhouette, line drawings in the same style (no logos) ----
  /** NES: flat grey box, cartridge door on top, power/reset left, two ports right. */
  'console-nes': (
    <g {...S}>
      <rect x="7" y="21" width="50" height="25" rx="2" />
      <path d="M17 21v8h30v-8M7 35h50" />
      <path d="M13 40h6M23 40h6" />
      <rect x="39" y="38.5" width="4" height="3.5" rx=".6" />
      <rect x="47" y="38.5" width="4" height="3.5" rx=".6" />
    </g>
  ),
  /** SNES, seen from above: rounded body, cartridge slot in the middle, power and reset left, eject right. */
  'console-snes': (
    <g {...S}>
      <rect x="6" y="15" width="52" height="34" rx="11" />
      <rect x="21" y="21" width="22" height="13" rx="2.5" />
      <path d="M25 27.5h14" />
      <rect x="10.5" y="22" width="7" height="4" rx="2" />
      <rect x="10.5" y="30" width="7" height="4" rx="2" />
      <rect x="47" y="25" width="6.5" height="5" rx="2" />
      <path d="M21 43h6M37 43h6" />
    </g>
  ),
  /** Nintendo 64, seen from above: the raised middle with its cartridge slot, switches either side, four ports in front. */
  'console-n64': (
    <g {...S}>
      <path d="M13 15h38a6 6 0 0 1 6 6v18c0 4-2 6-5 8l-3 2H15l-3-2c-3-2-5-4-5-8V21a6 6 0 0 1 6-6z" />
      <path d="M22 15v18h20V15" />
      <path d="M27 21h10" />
      <path d="M12.5 22.5h4M47.5 22.5h4" />
      <path d="M15 43v.01M24 45v.01M40 45v.01M49 43v.01" strokeWidth="3.6" />
    </g>
  ),
  /** GameCube: the cube, seen from above-front, round lid on top, handle at the back. */
  'console-gc': (
    <g {...S}>
      <path d="M12 26h28v26H12zM12 26l11-10h28l-11 10M40 52l11-10V16" />
      <ellipse cx="31.5" cy="21" rx="7" ry="2.8" />
      <path d="M28 16v-5h18v5" />
      <path d="M16 46h2.5M21.5 46h2.5M27 46h2.5M32.5 46h2.5" />
    </g>
  ),
  /** Wii: slim tower standing on its foot, disc slot down the front. */
  'console-wii': (
    <g {...S}>
      <path d="M25 8h11v42H25zM36 8l5 3v41l-5-2" />
      <path d="M30.5 13v26" />
      <path d="M21 55h24M27 50v5M38 51v4" />
    </g>
  ),
  /** 3DS: opened clamshell — wide top screen, hinge, small touch screen, circle pad and buttons. */
  '3ds': (
    <g {...S}>
      <rect x="11" y="6" width="42" height="24" rx="3" />
      <rect x="17" y="10" width="30" height="16" rx="1" />
      <rect x="11" y="33" width="42" height="25" rx="3" />
      <rect x="23" y="36.5" width="18" height="14" rx="1" />
      <circle cx="17" cy="41" r="2.6" />
      <path d="M47 39v.01M47 46v.01M44 42.5v.01M50 42.5v.01" />
    </g>
  ),
  /** PlayStation: seen from above — round disc lid, open button, power and reset, front ports. */
  'console-ps1': (
    <g {...S}>
      <rect x="7" y="13" width="50" height="38" rx="4" />
      <circle cx="27" cy="30" r="12" />
      <circle cx="47" cy="22" r="3.6" />
      <path d="M44 32h6M44 38h6M7 45h50" />
    </g>
  ),
  /** PlayStation 2: the long flat box, its stepped top, the disc tray, ports bottom left, two buttons right. */
  'console-ps2': (
    <g {...S}>
      <path d="M6 26h52v16H6z" />
      <path d="M6 26l4-5h48v5" />
      <path d="M41 26v16" />
      <path d="M10 31.5h27" />
      <rect x="10" y="36" width="5" height="3" rx=".6" />
      <rect x="19" y="36" width="5" height="3" rx=".6" />
      <circle cx="47" cy="34" r="1.8" />
      <circle cx="53" cy="34" r="1.8" />
    </g>
  ),
  /** PlayStation 3: the curved top seen from the front, slot-loading disc drive. */
  'console-ps3': (
    <g {...S}>
      <path d="M6 46V37c0-10 12-17 26-17s26 7 26 17v9z" />
      <path d="M19 33.5h26" />
      <path d="M12 41.5h3M49 41.5h3" />
    </g>
  ),
  /** Xbox: the big box with the round jewel on top, tray and ports below. */
  'console-xbox': (
    <g {...S}>
      <rect x="6" y="19" width="52" height="28" rx="3" />
      <circle cx="32" cy="26" r="5" />
      <path d="M13 36h21" />
      <path d="M12 41.5h4M19 41.5h4M41 41.5h4M48 41.5h4" />
    </g>
  ),
  /** Xbox 360: standing tower with the inward-curved sides, ring light and disc slot. */
  'console-xbox360': (
    <g {...S}>
      <path d="M21 6h22c-3 9-3 43 0 52H21c3-9 3-43 0-52z" />
      <circle cx="32" cy="14" r="3.6" />
      <path d="M32 23v24" />
    </g>
  ),
  handheld: (
    <g {...S}>
      <rect x="16" y="8" width="32" height="48" rx="4" />
      <rect x="21" y="13" width="22" height="14" rx="1" />
      <rect x="21" y="33" width="22" height="14" rx="1" />
    </g>
  ),
  box: (
    <g {...S}>
      <path d="M10 22l22-10 22 10v20L32 54 10 42z" />
      <path d="M10 22l22 10 22-10M32 32v22" />
    </g>
  ),
  'box-360': (
    <g {...S}>
      <path d="M22 8h20v48H22z" />
      <circle cx="32" cy="20" r="5" />
      <path d="M27 44h10" />
    </g>
  ),
  remote: (
    <g {...S}>
      <rect x="24" y="6" width="16" height="52" rx="7" />
      <circle cx="32" cy="18" r="4" />
      <path d="M29 30h6M29 36h6" />
    </g>
  ),
  search: (
    <g {...S}>
      <circle cx="28" cy="28" r="14" />
      <path d="M38 38l14 14" />
    </g>
  ),
  recent: (
    <g {...S}>
      <circle cx="32" cy="32" r="20" />
      <path d="M32 20v12l9 6" />
    </g>
  ),
  favorite: (
    <g {...S}>
      <path d="M32 10l6.5 14 15 1.6-11.3 10 3.3 15L32 43l-13.5 7.6 3.3-15-11.3-10 15-1.6z" />
    </g>
  ),
  folder: (
    <g {...S}>
      <path d="M10 18h16l5 5h23v25H10z" />
    </g>
  ),
  info: (
    <g {...S}>
      <circle cx="32" cy="32" r="20" />
      <path d="M32 28v14M32 21v1" />
    </g>
  ),
  display: (
    <g {...S}>
      <rect x="8" y="12" width="48" height="32" rx="3" />
      <path d="M24 52h16M32 44v8" />
    </g>
  ),
  /** A gamepad: two grips, d-pad, four face buttons and two sticks. */
  controller: (
    <g {...S}>
      <path d="M21 18h22c6 0 10 3.5 12 9l4.6 14.5c1.5 5-1.4 9.5-5.6 9.5-3 0-5-2-7-5.5L45 42H19l-2 3.5c-2 3.5-4 5.5-7 5.5-4.2 0-7.1-4.5-5.6-9.5L9 27c2-5.5 6-9 12-9z" />
      <path d="M17 26v8M13 30h8" />
      <path d="M47 25.5v.01M51 29.5v.01M47 33.5v.01M43 29.5v.01" strokeWidth="3.4" />
      <circle cx="25.5" cy="36" r="3.4" />
      <circle cx="38.5" cy="36" r="3.4" />
    </g>
  ),
  emulator: (
    <g {...S}>
      <rect x="10" y="14" width="44" height="36" rx="4" />
      <path d="M18 24l8 8-8 8M30 40h14" />
    </g>
  ),
  library: (
    <g {...S}>
      <path d="M12 12h8v40h-8zM24 12h8v40h-8zM36 14l8-2 8 38-8 2z" />
    </g>
  ),
  power: (
    <g {...S}>
      <path d="M32 10v20" />
      <path d="M20 18a18 18 0 1 0 24 0" />
    </g>
  ),
  health: (
    <g {...S}>
      <path d="M8 34h12l5-12 8 22 6-14 4 4h13" />
    </g>
  ),
  trophy: (
    <g {...S}>
      <path d="M20 10h24v14a12 12 0 0 1-24 0zM20 16h-8c0 8 4 12 8 12M44 16h8c0 8-4 12-8 12M32 36v10M22 54h20M26 46h12v8H26z" />
    </g>
  ),
  // profile pictures (our own simple drawings)
  'p-star': (
    <g {...S}>
      <path d="M32 8l6.5 15 16 1.5-12 10.5 3.6 15.8L32 42.5 17.9 50.8l3.6-15.8-12-10.5 16-1.5z" />
    </g>
  ),
  'p-planet': (
    <g {...S}>
      <circle cx="32" cy="32" r="14" />
      <ellipse cx="32" cy="32" rx="27" ry="9" transform="rotate(-20 32 32)" />
    </g>
  ),
  'p-rocket': (
    <g {...S}>
      <path d="M32 6c9 7 12 18 9 32H23c-3-14 0-25 9-32zM23 38l-7 10 9-3M41 38l7 10-9-3M28 46l4 10 4-10" />
      <circle cx="32" cy="22" r="4" />
    </g>
  ),
  'p-ghost': (
    <g {...S}>
      <path d="M16 54V28a16 16 0 0 1 32 0v26l-6-5-5 5-5-5-5 5-5-5z" />
      <circle cx="26" cy="28" r="2.5" />
      <circle cx="38" cy="28" r="2.5" />
    </g>
  ),
  'p-cat': (
    <g {...S}>
      <path d="M14 50V18l10 8h16l10-8v32a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" />
      <path d="M24 38h.01M40 38h.01M29 45q3 3 6 0" />
    </g>
  ),
  'p-heart': (
    <g {...S}>
      <path d="M32 52S10 39 10 24a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 15-22 28-22 28z" />
    </g>
  ),
  guest: (
    <g {...S}>
      <circle cx="32" cy="22" r="10" />
      <path d="M12 54c2-11 10-17 20-17s18 6 20 17" />
      <path d="M44 10l6-4M48 16h7" opacity={0.6} />
    </g>
  ),
  network: (
    <g {...S}>
      <circle cx="32" cy="32" r="20" />
      <path d="M12 32h40M32 12c8 8 8 32 0 40M32 12c-8 8-8 32 0 40" />
    </g>
  ),
  steam: (
    <g {...S}>
      <circle cx="40" cy="24" r="9" />
      <circle cx="22" cy="42" r="6" />
      <path d="M28 40l7-9" />
    </g>
  ),
  package: (
    <g {...S}>
      <path d="M10 20l22-10 22 10v24L32 54 10 44z" />
      <path d="M10 20l22 10 22-10M32 30v24M21 15l22 10" />
    </g>
  ),
  about: (
    <g {...S}>
      <path d="M32 8l5 14h15l-12 9 5 15-13-9-13 9 5-15-12-9h15z" />
    </g>
  ),
  mod: (
    <g {...S}>
      <path d="M20 12h10v8a4 4 0 0 0 8 0v-8h10v14h-8a4 4 0 0 0 0 8h8v18H20V34h-8a4 4 0 0 1 0-8h8z" />
    </g>
  ),
  empty: (
    <g {...S} opacity=".6">
      <circle cx="32" cy="32" r="18" />
      <path d="M20 44L44 20" />
    </g>
  )
}

/** All icon names (design check page). */
export function iconNames(): string[] {
  return Object.keys(shapes)
}

export function Icon({ name, size = 64 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="icon" aria-hidden>
      {shapes[name] ?? shapes.folder}
    </svg>
  )
}

/** The Starstation logo: a four-point star with an orbit. */
export function Logo({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden className="logo">
      <defs>
        <radialGradient id="lg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#cfe3ff" />
          <stop offset="100%" stopColor="#7fb0ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="44" fill="url(#lg)" opacity=".18" />
      <ellipse cx="60" cy="60" rx="52" ry="16" fill="none" stroke="#dbe8ff" strokeWidth="1.6" opacity=".55" transform="rotate(-18 60 60)" />
      <path d="M60 14 L68 52 L106 60 L68 68 L60 106 L52 68 L14 60 L52 52 Z" fill="#ffffff" />
      <circle cx="96" cy="40" r="3" fill="#ffffff" opacity=".85" />
    </svg>
  )
}
