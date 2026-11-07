/**
 * Minimal INI/TOML-ish editor that changes only the keys it is told to and keeps everything
 * else (comments, order, duplicate keys, unknown sections) exactly as it was.
 */
export function setIniValues(
  text: string,
  set: Record<string, Record<string, string | string[]>>,
  spacing = ' = '
): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  for (const [section, entries] of Object.entries(set)) {
    let start = -1
    if (section === '') start = -1
    else start = lines.findIndex((l) => l.trim() === `[${section}]`)

    if (section !== '' && start === -1) {
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
      lines.push(`[${section}]`)
      start = lines.length - 1
    }
    // end of section = next [header] or EOF
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*\[.*\]\s*$/.test(lines[i])) {
        end = i
        break
      }
    }
    for (const [key, value] of Object.entries(entries)) {
      const re = new RegExp(`^\\s*${escapeRe(key)}\\s*=`)
      if (Array.isArray(value)) {
        // a list: the key appears once per value (e.g. two buttons for one hotkey)
        const want = value.filter((x) => x !== '').map((x) => `${key}${spacing}${x}`)
        let first = -1
        for (let i = end - 1; i > start; i--) {
          if (re.test(lines[i])) {
            first = i
            lines.splice(i, 1)
            end--
          }
        }
        let at = first
        if (at < 0) {
          at = end
          while (at - 1 > start && lines[at - 1].trim() === '') at--
        }
        lines.splice(at, 0, ...want)
        end += want.length
        continue
      }
      let found = false
      for (let i = start + 1; i < end; i++) {
        if (re.test(lines[i])) {
          lines[i] = `${key}${spacing}${value}`
          found = true
          break
        }
      }
      if (!found) {
        // insert after the last non-blank line of the section
        let at = end
        while (at - 1 > start && lines[at - 1].trim() === '') at--
        lines.splice(at, 0, `${key}${spacing}${value}`)
        end++
      }
    }
  }
  return lines.join(eol) + eol
}

export function getIniValue(text: string, section: string, key: string): string | undefined {
  let inSection = section === ''
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    const h = /^\[(.*)\]$/.exec(l)
    if (h) {
      inSection = h[1] === section
      continue
    }
    if (!inSection) continue
    const m = /^([^=]+?)\s*=\s*(.*)$/.exec(l)
    if (m && m[1] === key) return m[2]
  }
  return undefined
}

/** Flat "key<sep>value" files (RPCS3 vfs.yml, RetroArch .cfg). */
export function setKvValues(text: string, set: Record<string, string>, sep: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const keySep = sep.trim()
  for (const [key, value] of Object.entries(set)) {
    const re = new RegExp(`^\\s*${escapeRe(key)}\\s*${escapeRe(keySep)}`)
    const i = lines.findIndex((l) => re.test(l))
    const line = `${key}${sep}${value}`
    // keep the indentation (YAML files like RPCS3's config.yml are nested)
    if (i >= 0) lines[i] = (/^\s*/.exec(lines[i])?.[0] ?? '') + line
    else lines.push(line)
  }
  return lines.join(eol) + eol
}

/** The text without the lines matching pattern, or null if no line matches (nothing to write). */
export function stripLines(text: string, pattern: string): string | null {
  const re = new RegExp(pattern)
  if (!new RegExp(pattern, 'm').test(text)) return null
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return text
    .split(/\r?\n/)
    .filter((l) => !re.test(l))
    .join(eol)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * RPCS3's input config: set "Handler" and "Device" under "Player N Input:" (top-level YAML blocks).
 * Same handler: only the device line changes (the user's button list stays).
 * Other handler: the block becomes just Handler + Device; RPCS3 fills in that pad type's default buttons.
 */
export function setYamlPlayers(text: string, players: { Handler: string; Device: string }[], config: Record<string, string> = {}): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  players.forEach((pl, i) => {
    const head = `Player ${i + 1} Input:`
    const start = lines.findIndex((l) => l.trimEnd() === head)
    const block = [head, `  Handler: ${pl.Handler}`, `  Device: ${pl.Device}`]
    const keys = Object.entries(config)
    if (keys.length) block.push('  Config:', ...keys.map(([k, val]) => `    ${k}: ${val}`))
    if (start < 0) {
      lines.push(...block)
      return
    }
    let end = start + 1
    while (end < lines.length && (lines[end].startsWith(' ') || lines[end] === '')) end++
    const handlerAt = lines.slice(start + 1, end).findIndex((l) => /^ {2}Handler:/.test(l))
    const sameHandler = handlerAt >= 0 && lines[start + 1 + handlerAt].replace(/^ {2}Handler:\s*/, '').trim() === pl.Handler
    if (!sameHandler) {
      lines.splice(start, end - start, ...block)
      return
    }
    const deviceAt = lines.slice(start + 1, end).findIndex((l) => /^ {2}Device:/.test(l))
    if (deviceAt >= 0) lines[start + 1 + deviceAt] = `  Device: ${pl.Device}`
    else {
      lines.splice(start + 2 + handlerAt, 0, `  Device: ${pl.Device}`)
      end++
    }
    if (!keys.length) return
    // the wanted buttons inside "  Config:" (4 spaces deep); the rest of the user's buttons stay
    let cfg = lines.slice(start + 1, end).findIndex((l) => /^ {2}Config:\s*$/.test(l))
    if (cfg < 0) {
      lines.splice(end, 0, '  Config:')
      cfg = end - start - 1
      end++
    }
    const cfgAt = start + 1 + cfg
    let cfgEnd = cfgAt + 1
    while (cfgEnd < end && lines[cfgEnd].startsWith('    ')) cfgEnd++
    for (const [k, val] of keys) {
      const re = new RegExp(`^ {4}${escapeRe(k)}:`)
      const at = lines.slice(cfgAt + 1, cfgEnd).findIndex((l) => re.test(l))
      if (at >= 0) lines[cfgAt + 1 + at] = `    ${k}: ${val}`
      else {
        lines.splice(cfgEnd, 0, `    ${k}: ${val}`)
        cfgEnd++
        end++
      }
    }
  })
  return lines.join(eol) + eol
}
