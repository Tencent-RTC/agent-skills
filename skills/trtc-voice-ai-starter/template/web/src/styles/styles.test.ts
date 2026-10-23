// Guards the UI rules stated at the top of styles/tokens.css.
//
// Run: pnpm --filter web test
//
// The point is to fail an AI (or human) edit that hardcodes a colour, adds a
// dark theme or drops an emoji into the UI, instead of relying on the rule
// being read. If a check fires: add a token to tokens.css and use var(--…).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const TOKENS = join(SRC, 'styles', 'tokens.css')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// UI sources: stylesheets, components, and .ts modules (which can build style
// objects). Test files are out.
const uiFiles = walk(SRC).filter(
  (f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f)
)

/**
 * Drop comments so a colour mentioned in a comment does not count. Block
 * comments keep their newlines, so reported line numbers stay correct.
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

function findings(re: RegExp, files: string[]) {
  return files.flatMap((f) =>
    stripComments(readFileSync(f, 'utf8'))
      .split('\n')
      .flatMap((line, i) => (re.test(line) ? [`${relative(SRC, f)}:${i + 1}  ${line.trim()}`] : []))
  )
}

test('there are UI files to check', () => {
  assert.ok(uiFiles.some((f) => f.endsWith('App.css')))
  assert.ok(uiFiles.includes(TOKENS))
})

test('colour literals appear only in styles/tokens.css', () => {
  const hits = findings(
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/,
    uiFiles.filter((f) => f !== TOKENS)
  )
  assert.deepEqual(hits, [], 'hardcoded colours — add a token to tokens.css and use var(--…):\n' + hits.join('\n'))
})

test('light theme only: no dark-mode media query or theme switch', () => {
  const hits = findings(/prefers-color-scheme|data-theme|\.dark\b/, uiFiles)
  assert.deepEqual(hits, [], hits.join('\n'))
})

test('no emoji in the UI', () => {
  const hits = findings(/\p{Extended_Pictographic}/u, uiFiles)
  assert.deepEqual(hits, [], hits.join('\n'))
})
