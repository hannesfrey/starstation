import { dir } from './paths'
import { readJson, writeJson } from './store'
import type { Collection } from '../shared/types'

/** User-made collections (automatic ones are computed in the menu). */
const file = () => dir('config', 'library', 'collections.json')

export function listCollections(): Collection[] {
  // the file may have been edited by hand: only well-formed collections reach the menu
  const raw = readJson<unknown>(file(), [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Collection => !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({ ...c, games: Array.isArray(c.games) ? c.games.filter((g) => typeof g === 'string') : [], createdAt: Number(c.createdAt) || 0 }))
}

function save(list: Collection[]): Collection[] {
  writeJson(file(), list)
  return list
}

export function createCollection(name: string, firstGame?: string): Collection[] {
  const clean = name.trim().slice(0, 40)
  if (!clean) throw new Error('A collection needs a name.')
  const list = listCollections()
  const id = `c${Date.now().toString(36)}`
  list.push({ id, name: clean, games: firstGame ? [firstGame] : [], createdAt: Date.now() })
  return save(list)
}

export function renameCollection(id: string, name: string): Collection[] {
  const clean = name.trim().slice(0, 40)
  if (!clean) throw new Error('A collection needs a name.')
  return save(listCollections().map((c) => (c.id === id ? { ...c, name: clean } : c)))
}

export function deleteCollection(id: string): Collection[] {
  return save(listCollections().filter((c) => c.id !== id))
}

/** Add the game if it isn't in the collection, otherwise remove it. */
export function toggleInCollection(id: string, gameId: string): Collection[] {
  return save(
    listCollections().map((c) =>
      c.id !== id ? c : { ...c, games: c.games.includes(gameId) ? c.games.filter((g) => g !== gameId) : [...c.games, gameId] }
    )
  )
}

/** Forget a deleted game everywhere. */
export function removeGameFromCollections(gameId: string): Collection[] {
  return save(listCollections().map((c) => ({ ...c, games: c.games.filter((g) => g !== gameId) })))
}

/** The game's file changed (compressed / decompressed): it stays in its collections. */
export function moveGameInCollections(oldId: string, newId: string): Collection[] {
  return save(listCollections().map((c) => ({ ...c, games: c.games.map((g) => (g === oldId ? newId : g)) })))
}
