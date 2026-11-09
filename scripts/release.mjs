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

// #39 first of all: a version that is already out (released to everyone) is never touched again
let existing = null
try {
  existing = JSON.parse(execFileSync(gh, ['release', 'view', tag, '-R', 'hannesfrey/starstation', '--json', 'isPrerelease,isDraft'], { env: ghEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
} catch {
  existing = null // not on GitHub yet
}
if (existing && !existing.isPrerelease && !existing.isDraft) {
  console.error(`\n${tag} is already released to everyone. Its files are never replaced: raise the version in package.json.`)
  process.exit(1)
}

// #38 every test before anything is built or uploaded: a failing test stops the release
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['vitest', 'run'])
run('node', ['scripts/fetch-bin.mjs'])
run('npx', ['electron-vite', 'build'])
run('npx', ['playwright', 'test'])
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
// replacing files is only allowed on the current beta (a pre-release nobody but the tester PC has)
if (existing) execFileSync(gh, ['release', 'upload', tag, ...files, '-R', 'hannesfrey/starstation', '--clobber'], { env: ghEnv, stdio: 'inherit' })
else execFileSync(gh, ['release', 'create', tag, ...files, '-R', 'hannesfrey/starstation', '--prerelease', '--title', version, '--notes', notes], { env: ghEnv, stdio: 'inherit' })
console.log(`\n${version} is on GitHub as a pre-release (beta channel).`)
