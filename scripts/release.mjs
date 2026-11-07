// Publish a new Starstation version as a GitHub PRE-RELEASE (beta channel: only the tester PC gets it).
// Everyone else gets it when Hannes presses "Release to everyone" in Settings → About.
//
//   node scripts/release.mjs            (version from package.json; tag v<version> must be pushed first)
//
// Builds with electron-builder (no upload), writes latest.yml itself, then uploads with gh — electron-builder's
// own upload of the ~130 MB installer failed once (1.9.0), gh's is reliable.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = path.resolve(import.meta.dirname, '..')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: SOURCE, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts })
const version = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8')).version
const tag = `v${version}`
const gh = path.join(SOURCE, 'tools', 'gh', 'bin', 'gh.exe')
const ghEnv = { ...process.env, GH_CONFIG_DIR: path.join(SOURCE, 'tools', 'gh-config') }
const notes = process.argv.slice(2).join(' ') || `Beta ${version}. On the tester PC first; everyone else gets it after "Release to everyone".`

run('node', ['scripts/fetch-bin.mjs'])
run('npx', ['electron-vite', 'build'])
run('npx', ['electron-builder', '--win', '--publish', 'never'])
// the packaged program must start (hidden) before anything is uploaded: a file left out of the installer
// would otherwise only show on the PCs that update
run('npx', ['playwright', 'test', 'packaged'], { env: { ...process.env, STARSTATION_REQUIRE_PACKAGED: '1' } })

const exeName = `Starstation-Setup-${version}.exe`
const exe = path.join(SOURCE, 'release', exeName)
const buf = fs.readFileSync(exe)
const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
const yml = [
  `version: ${version}`,
  'files:',
  `  - url: ${exeName}`,
  `    sha512: ${sha512}`,
  `    size: ${buf.length}`,
  `path: ${exeName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${fs.statSync(exe).mtime.toISOString()}'`,
  ''
].join('\n')
fs.writeFileSync(path.join(SOURCE, 'release', 'latest.yml'), yml)

const files = [exe, `${exe}.blockmap`, path.join(SOURCE, 'release', 'latest.yml')]
let exists = true
try {
  execFileSync(gh, ['release', 'view', tag, '-R', 'hannesfrey/starstation'], { env: ghEnv, stdio: 'ignore' })
} catch {
  exists = false
}
if (exists) execFileSync(gh, ['release', 'upload', tag, ...files, '-R', 'hannesfrey/starstation', '--clobber'], { env: ghEnv, stdio: 'inherit' })
else execFileSync(gh, ['release', 'create', tag, ...files, '-R', 'hannesfrey/starstation', '--prerelease', '--title', version, '--notes', notes], { env: ghEnv, stdio: 'inherit' })
console.log(`\n${version} is on GitHub as a pre-release (beta channel).`)
