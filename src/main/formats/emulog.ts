/** The fatal error lines of a log (RPCS3 marks them "·F"), newest last, without the timestamp. */
export function fatalLines(text: string, pattern: string): string[] {
  const re = new RegExp(pattern)
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) out.push((m[1] ?? line).trim())
  }
  return out
}
