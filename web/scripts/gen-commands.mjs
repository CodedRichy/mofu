// Regenerates web/src/components/commands/commands.json from the bot's real command files.
//   node web/scripts/gen-commands.mjs        (run from the repo root or from web/)
//
// Each src/commands/<category>/<name>.js is loaded with src/database and third-party requires (except discord.js)
// swapped for an inert stub: no database file is opened, no client, no network. The builder's
// toJSON() gives the real name, description, options and subcommands. PREFIX_ONLY and ALIASES are read from
// src/handlers/commandHandler.js as text (they are not exported), so the site always matches the handler.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const commandsDir = path.join(repo, 'src', 'commands')
const handlerFile = path.join(repo, 'src', 'handlers', 'commandHandler.js')
const outFile = path.join(repo, 'web', 'src', 'components', 'commands', 'commands.json')

const require = createRequire(handlerFile)
const Module = require('module')

// ---- inert stub for every non-discord.js dependency ----
function stub() {
  const fn = function () { return stub() }
  return new Proxy(fn, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => ''
      if (key === Symbol.iterator) return function* () {}
      if (key === 'then') return undefined
      return stub()
    },
    apply() { return stub() },
    construct() { return stub() },
  })
}
const realLoad = Module._load
Module._load = function (request, parent, isMain) {
  // only requires made by the bot's own files are stubbed; discord.js keeps its real internals
  const fromBot = parent && parent.filename && !parent.filename.includes(`${path.sep}node_modules${path.sep}`)
  // absolute paths are the command files this script asks for itself
  if (!fromBot || path.isAbsolute(request) || request === 'discord.js' || request.startsWith('node:') || Module.builtinModules.includes(request)) {
    return realLoad.call(this, request, parent, isMain)
  }
  // the bot's own helpers load for real (commands read constants like option min/max from them), except the
  // database layer, which would open data/sonder.db. Other npm packages stay stubbed. A helper that throws
  // while loading falls back to the stub.
  if (request.startsWith('.')) {
    const resolved = path.resolve(path.dirname(parent.filename), request)
    if (!resolved.startsWith(dbDir)) {
      try { return realLoad.call(this, request, parent, isMain) } catch { return stub() }
    }
  }
  return stub()
}
const dbDir = path.join(repo, 'src', 'database')

// ---- PREFIX_ONLY and ALIASES, parsed from the handler source ----
const handlerSrc = fs.readFileSync(handlerFile, 'utf-8')
const setBlock = handlerSrc.match(/const PREFIX_ONLY = new Set\(\[([\s\S]*?)\]\);/)
if (!setBlock) throw new Error('PREFIX_ONLY not found in commandHandler.js')
const prefixOnly = new Set([...setBlock[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]))

const aliasBlock = handlerSrc.match(/const ALIASES = \{([\s\S]*?)\n\};/)
if (!aliasBlock) throw new Error('ALIASES not found in commandHandler.js')
const aliases = {}
for (const m of aliasBlock[1].replace(/\/\/.*$/gm, '').matchAll(/(?:'([^']+)'|([\w]+))\s*:\s*'([^']+)'/g)) {
  const alias = m[1] || m[2]
  ;(aliases[m[3]] ||= []).push(alias)
}

// ---- option formatting ----
const OPT = { 3: 'text', 4: 'number', 5: 'yes/no', 6: 'user', 7: 'channel', 8: 'role', 9: 'mention', 10: 'number', 11: 'file' }
const fmtOpts = (opts = []) => opts
  .filter((o) => o.type > 2)
  .map((o) => ({ name: o.name, type: OPT[o.type] || 'value', required: !!o.required, desc: o.description || '' }))

function shape(json) {
  const out = {}
  const subs = []
  for (const o of json.options || []) {
    if (o.type === 1) subs.push({ name: o.name, desc: o.description || '', options: fmtOpts(o.options) })
    else if (o.type === 2) for (const s of o.options || []) subs.push({ name: `${o.name} ${s.name}`, desc: s.description || '', options: fmtOpts(s.options) })
  }
  if (subs.length) out.subcommands = subs
  else out.options = fmtOpts(json.options)
  return out
}

// ---- walk ----
const categories = fs.readdirSync(commandsDir).filter((d) => fs.statSync(path.join(commandsDir, d)).isDirectory()).sort()
const commands = []
const failed = []
for (const category of categories) {
  for (const file of fs.readdirSync(path.join(commandsDir, category)).filter((f) => f.endsWith('.js')).sort()) {
    try {
      const mod = require(path.join(commandsDir, category, file))
      if (!mod.data || !mod.execute) continue
      const json = mod.data.toJSON()
      commands.push({
        name: json.name,
        category,
        desc: json.description || '',
        slash: !prefixOnly.has(json.name),
        aliases: (aliases[json.name] || []).sort(),
        ...shape(json),
      })
    } catch (err) {
      failed.push(`${category}/${file}: ${err.message}`)
    }
  }
}
Module._load = realLoad

if (failed.length) {
  console.error('Could not load:\n  ' + failed.join('\n  '))
  process.exit(1)
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(commands) + '\n', 'utf-8')
const slash = commands.filter((c) => c.slash).length
console.log(`Wrote ${commands.length} commands (${slash} slash, ${commands.length - slash} prefix-only) across ${categories.length} categories -> ${path.relative(repo, outFile)}`)
process.exit(0)
