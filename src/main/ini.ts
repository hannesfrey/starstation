/**
 * Minimal INI/TOML-ish editor that changes only the keys it is told to and keeps everything
 * else (comments, order, duplicate keys, unknown sections) exactly as it was.
 */
export function setIniValues(
  text: string,
  set: Record<string, Record<string, string>>,
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
    if (i >= 0) lines[i] = line
    else lines.push(line)
  }
  return lines.join(eol) + eol
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
