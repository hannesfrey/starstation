import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { dir } from './paths'
import { allConsoles, getEmulator, emulatorDir, fill, vars, type ConsolePreset, type EmulatorPreset } from './presets'
import { matchesBios } from './bios'
import { scanConsole } from './library/scan'
import { copyTree, moveFile, partsOf, verifyTree } from './fsutil'
import { writeJson, readJson } from './store'
import { logger } from './log'
import { versionFromAsset } from './formats/version'

const log = logger('import')

/**
 * Import from an EmuDeck setup or Hannes's portable Desktop\Emulator folder.
 * Order: copy + verify emulators, BIOS, saves, emulator storage → then move games.
 * Never changes or deletes anything in the source except moving game files after everything else verified.
 */
export interface ImportSource {
  kind: 'portable' | 'emudeck'
  label: string
  emulators: string
  bios: string
  saves: string
  roms: string
  storage: string
  downloadLog?: string
}

export interface ImportTask {
  kind: 'emulator' | 'bios' | 'saves' | 'storage' | 'game'
  console?: string
  label: string
  from: string
  to: string
  bytes: number
  files: number
  /** For game moves: the extra files that belong to this game (bin tracks, discs). */
  parts?: string[]
}

export interface ImportPlan {
  source: ImportSource
  tasks: ImportTask[]
  skipped: string[]
}

export interface ImportProgress {
  phase: 'copy' | 'verify' | 'move' | 'done' | 'error'
  done: number
  total: number
  current: string
  error?: string
}

// ---------------- source detection ----------------

export function findSources(): ImportSource[] {
  const out: ImportSource[] = []
  const home = os.homedir()
  // Tests point at a fake setup; hidden test runs never look at the real PC.
  const override = process.env.STARSTATION_IMPORT_SOURCE
  if (!override && process.env.STARSTATION_HEADLESS === '1') return []
  const portable = override ?? path.join(home, 'Desktop', 'Emulator')
  if (fs.existsSync(path.join(portable, 'Emulators')) && fs.existsSync(path.join(portable, 'Emulation'))) {
    const e = path.join(portable, 'Emulation')
    out.push({
      kind: 'portable',
      label: `Emulator folder (${portable})`,
      emulators: path.join(portable, 'Emulators'),
      bios: path.join(e, 'bios'),
      saves: path.join(e, 'saves'),
      roms: path.join(e, 'roms'),
      storage: path.join(e, 'storage'),
      downloadLog: path.join(portable, 'Downloads', 'download-log.txt')
    })
  }
  if (override) return out
  const appEmus = path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'EmuDeck', 'Emulators')
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const e = `${letter}:\\Emulation`
    try {
      if (!fs.existsSync(path.join(e, 'roms')) || !fs.existsSync(path.join(e, 'bios'))) continue
    } catch {
      continue
    }
    out.push({
      kind: 'emudeck',
      label: `EmuDeck (${e})`,
      emulators: fs.existsSync(appEmus) ? appEmus : path.join(e, 'tools', 'emulators'),
      bios: path.join(e, 'bios'),
      saves: path.join(e, 'saves'),
      roms: path.join(e, 'roms'),
      storage: path.join(e, 'storage')
    })
  }
  return out
}

// ---------------- planning ----------------

interface TreeInfo {
  files: number
  bytes: number
}

function treeInfo(p: string): TreeInfo {
  let files = 0
  let bytes = 0
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const f = path.join(d, e.name)
      let st: fs.Stats
      try {
        st = fs.statSync(f) // follows EmuDeck's symlinks
      } catch {
        continue
      }
      if (st.isDirectory()) walk(f, depth + 1)
      else if (st.isFile()) {
        files++
        bytes += st.size
      }
    }
  }
  try {
    if (fs.statSync(p).isFile()) return { files: 1, bytes: fs.statSync(p).size }
  } catch {
    return { files: 0, bytes: 0 }
  }
  walk(p, 0)
  return { files, bytes }
}

function findChild(parent: string, names: string[]): string | null {
  let ents: string[] = []
  try {
    ents = fs.readdirSync(parent)
  } catch {
    return null
  }
  for (const n of names) {
    const hit = ents.find((e) => e.toLowerCase() === n.toLowerCase())
    if (hit) return path.join(parent, hit)
  }
  return null
}

function findPath(base: string, rels: string[]): string | null {
  for (const rel of rels) {
    let cur: string | null = base
    for (const part of rel.split('/')) {
      cur = cur ? findChild(cur, [part]) : null
      if (!cur) break
    }
    if (cur && fs.existsSync(cur)) return cur
  }
  return null
}

function listFilesRecursive(d: string, depth = 0): string[] {
  if (depth > 4) return []
  let ents: fs.Dirent[] = []
  try {
    ents = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return []
  }
  return ents.flatMap((e) => {
    const f = path.join(d, e.name)
    if (e.isDirectory()) return listFilesRecursive(f, depth + 1)
    return e.isFile() ? [f] : []
  })
}

export function planImport(source: ImportSource): ImportPlan {
  const tasks: ImportTask[] = []
  const skipped: string[] = []
  const consoles = allConsoles()

  // 1) emulators used by our presets
  const emus = new Map<string, EmulatorPreset>()
  for (const c of consoles) {
    const e = getEmulator(c.emulator)
    if (e && !path.isAbsolute(e.folder)) emus.set(e.id, e)
  }
  for (const e of emus.values()) {
    const src = findChild(source.emulators, e.importNames)
    const dst = emulatorDir(e)
    if (!src) {
      skipped.push(`${e.name}: not found in source`)
      continue
    }
    if (fs.existsSync(path.join(dst, e.exe))) {
      skipped.push(`${e.name}: already in Starstation`)
      continue
    }
    if (!fs.existsSync(path.join(src, e.exe))) {
      skipped.push(`${e.name}: ${e.exe} missing in ${src}`)
      continue
    }
    const info = treeInfo(src)
    tasks.push({ kind: 'emulator', label: e.name, from: src, to: dst, ...info })
  }

  // 2) BIOS: every file matching a console's BIOS rules (+ companion files with the same name stem, e.g. PS2 .NVM/.MEC)
  const biosFiles = fs.existsSync(source.bios) ? listFilesRecursive(source.bios) : []
  const claimed = new Set<string>()
  for (const c of consoles) {
    const rules = (c.bios?.files ?? []).filter((r) => !r.path && r.match)
    if (!rules.length) continue
    const hits = biosFiles.filter((f) => rules.some((r) => matchesBios(r, f, fs.statSync(f).size)))
    const stems = new Set(hits.map((f) => path.join(path.dirname(f), path.parse(f).name).toLowerCase()))
    const all = biosFiles.filter((f) => stems.has(path.join(path.dirname(f), path.parse(f).name).toLowerCase()))
    for (const f of all) {
      claimed.add(f)
      const to = dir('bios', c.id, path.basename(f))
      if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(f).size) continue
      tasks.push({ kind: 'bios', console: c.id, label: `${c.short} BIOS ${path.basename(f)}`, from: f, to, bytes: fs.statSync(f).size, files: 1 })
    }
  }
  for (const f of biosFiles) if (!claimed.has(f)) skipped.push(`BIOS not needed by any console preset: ${path.basename(f)}`)

  // 3) saves and 4) emulator storage (e.g. PS3 virtual hard disk)
  for (const c of consoles) {
    for (const s of c.import?.saves ?? []) {
      const src = findPath(source.saves, s.from)
      if (!src) continue
      const info = treeInfo(src)
      if (!info.files) continue
      tasks.push({ kind: 'saves', console: c.id, label: `${c.short} saves (${s.to})`, from: src, to: dir('saves', c.id, s.to), ...info })
    }
    for (const s of c.import?.storage ?? []) {
      const src = findPath(source.storage, s.from)
      if (!src) continue
      const info = treeInfo(src)
      const to = fill(s.to, vars(c))
      tasks.push({ kind: 'storage', console: c.id, label: `${c.short} storage`, from: src, to, ...info })
    }
  }

  // 5) games (moved last)
  for (const c of consoles) {
    const romDir = findChild(source.roms, c.import?.roms ?? [c.id])
    if (!romDir) continue
    for (const e of scanConsole(c, romDir)) {
      const rel = path.relative(romDir, e.path)
      const to = dir('games', c.id, rel)
      const parts = e.kind === 'file' ? partsOf(e.path) : []
      const info = treeInfo(e.path)
      const extra = parts.reduce((n, p) => n + treeInfo(p).bytes, 0)
      tasks.push({
        kind: 'game',
        console: c.id,
        label: `${c.short}: ${path.basename(e.path)}`,
        from: e.path,
        to,
        bytes: info.bytes + extra,
        files: info.files + parts.length,
        parts
      })
    }
  }
  return { source, tasks, skipped }
}

export interface ImportResult {
  ok: boolean
  copied: number
  moved: number
  conflicts: string[]
  errors: string[]
}

export async function runImport(plan: ImportPlan, progress: (p: ImportProgress) => void): Promise<ImportResult> {
  const copyTasks = plan.tasks.filter((t) => t.kind !== 'game')
  const gameTasks = plan.tasks.filter((t) => t.kind === 'game')
  const totalFiles = copyTasks.reduce((n, t) => n + t.files, 0)
  const result: ImportResult = { ok: true, copied: 0, moved: 0, conflicts: [], errors: [] }
  let done = 0
  log.info(`import from ${plan.source.label}: ${copyTasks.length} copy tasks (${totalFiles} files), ${gameTasks.length} games`)

  // ---- copy ----
  for (const t of copyTasks) {
    progress({ phase: 'copy', done, total: totalFiles, current: t.label })
    try {
      await copyTree(t.from, t.to, () => {
        done++
        if (done % 200 === 0) progress({ phase: 'copy', done, total: totalFiles, current: t.label })
      }, result.conflicts)
      result.copied++
    } catch (e) {
      result.errors.push(`${t.label}: ${(e as Error).message}`)
      log.error(`copy failed: ${t.label}`, e)
    }
  }
  // ---- verify everything before any game is moved ----
  let v = 0
  for (const t of copyTasks) {
    progress({ phase: 'verify', done: v++, total: copyTasks.length, current: t.label })
    const bad = (await verifyTree(t.from, t.to)).filter((b) => !result.conflicts.includes(b))
    if (bad.length) result.errors.push(`${t.label}: ${bad.length} file(s) did not verify (e.g. ${bad[0]})`)
  }
  if (result.errors.length) {
    result.ok = false
    log.error('import stopped before moving games', result.errors)
    progress({ phase: 'error', done: 0, total: 0, current: '', error: result.errors[0] })
    return result
  }
  // ---- move games ----
  let g = 0
  for (const t of gameTasks) {
    progress({ phase: 'move', done: g++, total: gameTasks.length, current: t.label })
    try {
      for (const part of t.parts ?? []) {
        const rel = path.relative(path.dirname(t.from), part)
        await moveFile(part, path.join(path.dirname(t.to), rel))
      }
      await moveFile(t.from, t.to)
      result.moved++
    } catch (e) {
      result.errors.push(`${t.label}: ${(e as Error).message}`)
      log.error(`move failed: ${t.label}`, e)
    }
  }
  result.ok = result.errors.length === 0
  recordImport(plan, result)
  progress({ phase: 'done', done: gameTasks.length, total: gameTasks.length, current: '' })
  log.info(`import finished: ${JSON.stringify({ ...result, conflicts: result.conflicts.length })}`)
  return result
}

/** Remember versions of imported emulators (from Desktop\Emulator\Downloads\download-log.txt if present). */
function recordImport(plan: ImportPlan, result: ImportResult): void {
  const versions = parseDownloadLog(plan.source.downloadLog)
  for (const t of plan.tasks.filter((x) => x.kind === 'emulator')) {
    const e = [...new Set(allConsoles().map((c) => getEmulator(c.emulator)))].find((x) => x && emulatorDir(x) === t.to)
    if (!e) continue
    const v = versions[e.id] ?? versions[path.basename(t.from).toLowerCase()]
    writeJson(path.join(t.to, '.starstation.json'), {
      version: v?.version || 'imported',
      asset: v?.asset,
      source: plan.source.label,
      installedAt: new Date().toISOString()
    })
  }
  const histFile = dir('config', 'imports.json')
  const hist = readJson<unknown[]>(histFile, [])
  hist.push({ at: new Date().toISOString(), source: plan.source.label, result: { ...result, conflicts: result.conflicts.slice(0, 50) } })
  writeJson(histFile, hist)
}

function parseDownloadLog(file?: string): Record<string, { version: string; asset: string }> {
  const out: Record<string, { version: string; asset: string }> = {}
  if (!file || !fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parts = line.split('|').map((s) => s.trim())
    if (parts.length < 3) continue
    const [name, tag, asset] = parts
    let version = tag
    if (!version || version === 'latest' || version.startsWith('build-')) {
      version = versionFromAsset(asset) ?? (tag || 'imported')
    }
    out[name.toLowerCase()] = { version: version.replace(/^v\.?/, ''), asset }
  }
  return out
}

export function summarize(plan: ImportPlan): { kind: ImportTask['kind']; count: number; bytes: number }[] {
  const kinds: ImportTask['kind'][] = ['emulator', 'bios', 'saves', 'storage', 'game']
  return kinds.map((k) => {
    const ts = plan.tasks.filter((t) => t.kind === k)
    return { kind: k, count: ts.length, bytes: ts.reduce((n, t) => n + t.bytes, 0) }
  })
}

export type { ConsolePreset }
