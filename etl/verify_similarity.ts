/** Acceptance checks for A12 graph-independent Case Similarity. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { handleSimilar } from '../functions/kv-similar/index.js'
import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'similarity_demo.json')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    readonly cases: readonly {
      readonly target: { readonly incident_id: string }
      readonly candidates: readonly unknown[]
    }[]
  }
  assert(fixture.cases.length === 12, 'Expected 12 similarity targets')
  assert(fixture.cases.every(({ candidates }) => candidates.length === 100), 'Expected 100 candidates per target')
  const incidentId = fixture.cases[0]?.target.incident_id
  assert(incidentId, 'Similarity fixture has no target')

  const started = performance.now()
  const result = await handleSimilar({ incidentId, limit: 10 })
  const elapsedMs = performance.now() - started
  assert(elapsedMs < 150, `kv-similar took ${elapsedMs.toFixed(1)}ms`)
  assert(result.graph_dependency === false, 'Case Similarity must not depend on graph service')
  assert(result.matches.length === 10, 'Expected top 10 similarity results')
  assert(
    result.matches.every((match, index) => index === 0 || match.similarity <= result.matches[index - 1]!.similarity),
    'Similarity results are not descending',
  )
  assert(
    result.matches.every((match) => match.registered_on < result.target.registered_on),
    'Every match must be prior to the target record',
  )
  assert(
    result.matches.every((match) => match.explanation.length > 0),
    'Every match needs a plain-language explanation',
  )

  const geographyOnly = await handleSimilar({
    incidentId,
    weights: {
      sections: 0,
      premise: 0,
      geography: 1,
      time: 0,
      victim: 0,
      weapon: 0,
    },
    limit: 10,
  })
  assert(
    geographyOnly.weights.geography === 1,
    'Custom weights must be normalized and applied',
  )
  const checksum = await sha256File(fixturePath)
  process.stdout.write(
    `verify:similarity — PASS\n` +
      `  fixture sha256      ${checksum}\n` +
      `  targets             ${fixture.cases.length}\n` +
      `  candidates/target   100\n` +
      `  kv-similar          ${elapsedMs.toFixed(1)} ms\n` +
      `  graph dependency    no\n`,
  )
}

await main()
