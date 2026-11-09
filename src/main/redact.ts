/**
 * #43 "Send logs": friends send their report to Hannes — passwords, tokens and keys never go along.
 * Works on any text: log lines, settings files, JSON.
 */

const KEY = '(?:password|passwd|pass|token|api[_-]?key|apikey|secret|session[_-]?id|auth|key|expires)'

const RULES: [RegExp, string][] = [
  // Authorization headers
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [removed]'],
  // GitHub / Nexus-style long tokens wherever they stand
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[removed]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[removed]'],
  // link parameters: ?key=…&expires=… / &token=…
  [new RegExp(`([?&]${KEY}=)[^&\\s"']+`, 'gi'), '$1[removed]'],
  // "token": "…" in JSON
  [new RegExp(`("[\\w.-]*${KEY}[\\w.-]*"\\s*:\\s*")[^"]*(")`, 'gi'), '$1[removed]$2'],
  // token = …, Password: … (settings files, log lines)
  [new RegExp(`(\\b[\\w.-]*${KEY}[\\w.-]*\\s*[=:]\\s*)("?)[^\\s",;&[]+\\2`, 'gi'), '$1$2[removed]$2']
]

export function redact(text: string): string {
  let out = text
  for (const [re, by] of RULES) out = out.replace(re, by)
  // a value that was already empty stays empty; "[removed]" twice is harmless
  return out
}
