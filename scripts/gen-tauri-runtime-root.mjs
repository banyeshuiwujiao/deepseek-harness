#!/usr/bin/env node
/**
 * Generate the deploy root for the Tauri desktop runtime.
 *
 * `pnpm deploy` only ships what a package *declares*. Deploying
 * `apps/desktop-host` directly therefore produced an incomplete tree: several
 * cordis plugins and optional feature packages are resolved from the workspace
 * root at development time and never appear in that manifest — 30 packages were
 * missing, 630 MB worth.
 *
 * DSH already solves this for its Python runtime with
 * `python/sdk-runtime/package.json`: a dependency-only deploy root that lists
 * the whole closure explicitly. This script derives the desktop equivalent from
 * that root, keeping every declaration and adding what only the desktop product
 * needs: the web app bundles, the stdio host, and the host's non-workspace
 * dependencies.
 *
 * Usage: node scripts/gen-tauri-runtime-root.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const pythonRoot = readJson(join(rootDir, 'python', 'sdk-runtime', 'package.json'))
const hostPackage = readJson(join(rootDir, 'apps', 'desktop-host', 'package.json'))

/** Desktop-only packages that the hosted web client needs in addition. */
const DESKTOP_BUNDLES = {
  '@deepseek-ai/dsh-web-app': 'workspace:*',
  '@deepseek-ai/dsh-web-frontend': 'workspace:*',
  '@deepseek-ai/dsh-desktop-host': 'workspace:*',
}

const dependencies = { ...pythonRoot.dependencies, ...DESKTOP_BUNDLES }

// Non-workspace dependencies the host itself declares (native office kit, koffi).
for (const [name, range] of Object.entries(hostPackage.dependencies ?? {})) {
  if (!String(range).startsWith('workspace:')) dependencies[name] = range
}

const manifest = {
  name: 'dsh-tauri-desktop-runtime',
  description: 'Dependency-only deploy root for the Tauri desktop product: the web client, its bundles, and the stdio host.',
  version: '0.0.1',
  private: true,
  type: 'module',
  dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
}

const target = join(rootDir, 'apps', 'tauri-desktop-runtime')
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const count = Object.keys(dependencies).length
console.log(`wrote ${join(target, 'package.json')} with ${count} declared dependencies`)
const workspaceCount = Object.values(dependencies).filter(range => String(range).startsWith('workspace:')).length
console.log(`  workspace: ${workspaceCount}  registry: ${count - workspaceCount}`)