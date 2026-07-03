// ─────────────────────────────────────────────────────────────────────────────
// load-env.mjs — Tiny, dependency-free .env loader
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this exists: Node's built-in `--env-file` / `--env-file-if-exists` flags
// only work on Node 20.6+ / 20.12+. To keep `npm run deploy` working on ANY Node
// version (and without adding the `dotenv` package), the deploy scripts import
// this module FIRST. It reads the project's `.env` and copies each value into
// `process.env` — but only if that variable isn't already set, so real
// environment variables and inline `KEY=value npm run deploy` still win.
//
// CLI flags (e.g. `--supply`) are handled separately by each script's readArgs()
// and always take priority over .env.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Look for .env in the project root (one level up from scripts/), then the cwd.
const candidates = [
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
]

function parseAndApply(content) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue // skip blanks + comments

    const eq = line.indexOf('=') // split on the FIRST '=' only (URLs keep theirs)
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (!key) continue

    let val = line.slice(eq + 1).trim()
    // Strip a single pair of surrounding quotes, if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }

    // Never override a value that's already in the environment.
    if (process.env[key] === undefined) process.env[key] = val
  }
}

for (const p of candidates) {
  try {
    if (fs.existsSync(p)) {
      parseAndApply(fs.readFileSync(p, 'utf8'))
      break // first .env found wins
    }
  } catch {
    // A missing/unreadable .env is fine — the scripts fall back to defaults.
  }
}
