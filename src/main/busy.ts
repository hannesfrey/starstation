/**
 * One "busy" list for everything that changes saves, mods or profiles (#08). Two of them at once on the same
 * data mix it up: a restore while the game starts, a profile switch while a package is received, a mod change
 * while a backup is copied.
 *
 * - A game operation (restore, backup, mod change…) waits for other operations on the same game.
 * - A whole-setup operation (profile switch, receiving a package) waits for everything, and everything waits for it.
 * - `share`: operations of the same kind that queue up by themselves (mod changes: one per game at a time in
 *   mods.ts) may overlap each other — the second one waits its turn there instead of being turned away.
 */

interface Op {
  what: string
  game?: string
  share: boolean
}
const ops = new Set<Op>()

function blocker(game: string | undefined, what?: string, share = false): Op | null {
  for (const o of ops) {
    if (game && o.game && o.game !== game) continue
    if (share && o.share && o.what === what) continue
    return o
  }
  return null
}

/** What is blocking an operation on `game` (or on everything, when no game is given), or null. */
export function busyWith(game?: string): string | null {
  return blocker(game)?.what ?? null
}

/**
 * Start an operation. Returns a function that ends it, or the message to show when something else is busy.
 * `what` is shown to others while this runs: "Its saves are being restored", "A package is being received"…
 */
export function begin(what: string, game?: string, opts: { share?: boolean } = {}): { end: () => void } | { error: string } {
  const other = blocker(game, what, !!opts.share)
  if (other) return { error: `${other.what}. Try again in a moment.` }
  const op: Op = { what, game, share: !!opts.share }
  ops.add(op)
  return { end: () => void ops.delete(op) }
}

/** Run `fn` as an operation; when something else is busy, return `{ ok: false, busy: true, error }` instead. */
export async function exclusive<T>(
  what: string,
  game: string | undefined,
  fn: () => Promise<T>,
  opts: { share?: boolean } = {}
): Promise<T | { ok: false; busy: true; error: string }> {
  const b = begin(what, game, opts)
  if ('error' in b) return { ok: false, busy: true, error: b.error }
  try {
    return await fn()
  } finally {
    b.end()
  }
}
