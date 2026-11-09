/**
 * One "busy" list for everything that changes saves, mods or profiles (#08). Two of them at once on the same
 * data mix it up: a restore while the game starts, a profile switch while a package is received, a mod change
 * while a backup is copied.
 *
 * - A game operation (restore, backup, mod change…) waits for other operations on the same game.
 * - A whole-setup operation (profile switch, receiving a package) waits for everything, and everything waits for it.
 */

interface Op {
  what: string
  game?: string
}
const ops = new Set<Op>()

/** What is blocking an operation on `game` (or on everything, when no game is given), or null. */
export function busyWith(game?: string): string | null {
  for (const o of ops) if (!game || !o.game || o.game === game) return o.what
  return null
}

/**
 * Start an operation. Returns a function that ends it, or the message to show when something else is busy.
 * `what` is shown to others while this runs: "Its saves are being restored", "A package is being received"…
 */
export function begin(what: string, game?: string): { end: () => void } | { error: string } {
  const other = busyWith(game)
  if (other) return { error: `${other}. Try again in a moment.` }
  const op: Op = { what, game }
  ops.add(op)
  return { end: () => void ops.delete(op) }
}

/** Run `fn` as an operation; when something else is busy, return `{ ok: false, error }` instead. */
export async function exclusive<T>(what: string, game: string | undefined, fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  const b = begin(what, game)
  if ('error' in b) return { ok: false, error: b.error }
  try {
    return await fn()
  } finally {
    b.end()
  }
}
