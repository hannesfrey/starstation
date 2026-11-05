import type { ReactElement } from 'react'

/** Original line icons (no console logos). 64×64 viewBox, white strokes. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** A trophy cup filled with its tier's colour (our own drawing). */
function TrophyCup({ fill, glow }: { fill: string; glow?: boolean }) {
  return (
    <g>
      {glow && <circle cx="32" cy="24" r="22" fill={fill} opacity={0.18} />}
      <path d="M20 10h24v14a12 12 0 0 1-24 0z" fill={fill} stroke={fill} strokeWidth={2} strokeLinejoin="round" />
      <path d="M20 16h-8c0 8 4 12 8 12M44 16h8c0 8-4 12-8 12M32 36v10M22 54h20" fill="none" stroke={fill} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M26 46h12v8H26z" fill={fill} />
    </g>
  )
}

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
  controller: (
    <g {...S}>
      <path d="M18 22h28c6 0 10 6 11 14s-3 14-8 12-7-8-11-8H26c-4 0-6 6-11 8s-9-4-8-12 5-14 11-14z" />
      <path d="M20 32h8M24 28v8" />
      <circle cx="42" cy="30" r="1.5" />
      <circle cx="46" cy="34" r="1.5" />
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
  // trophies by tier: the same cup, filled in its own metal colour (locked: outline only, faint)
  'trophy-bronze': <TrophyCup fill="#c98a52" />,
  'trophy-silver': <TrophyCup fill="#cfd6df" />,
  'trophy-gold': <TrophyCup fill="#f2c94c" />,
  'trophy-platinum': <TrophyCup fill="#bfe6ff" glow />,
  'trophy-locked': (
    <g {...S} opacity={0.35}>
      <path d="M20 10h24v14a12 12 0 0 1-24 0zM20 16h-8c0 8 4 12 8 12M44 16h8c0 8-4 12-8 12M32 36v10M22 54h20M26 46h12v8H26z" />
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
