import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8')) as T
}

interface PublicationManifest {
  readonly dataset_sha256: string
  readonly files: readonly {
    readonly table: string
    readonly path: string
    readonly rows: number
    readonly bytes: number
    readonly sha256: string
  }[]
}

interface Allowlist {
  readonly allowlist_version: string
  readonly publication_dataset_sha256: string
  readonly objects: readonly { readonly object_key: string }[]
  readonly explicitly_local: readonly { readonly source?: string; readonly source_glob?: string }[]
  readonly ephemeral_publication_inputs: readonly {
    readonly source: string
    readonly object_key: string
    readonly table: string
    readonly operation: string
    readonly rows: number
    readonly bytes: number
    readonly sha256: string
  }[]
}

interface FunctionsPlan {
  readonly runtime_functions: readonly {
    readonly name: string
    readonly type: string
    readonly route?: string
  }[]
}

interface CircuitPlan {
  readonly status: string
  readonly dataset_sha256: string
  readonly excluded_local_stage: readonly string[]
  readonly states: readonly {
    readonly name: string
    readonly type: string
    readonly function?: string
  }[]
}

const [manifest, allowlist, functions, circuit] = await Promise.all([
  json<PublicationManifest>('etl/cloud/publication-manifest.json'),
  json<Allowlist>('etl/cloud/allowlist.json'),
  json<FunctionsPlan>('etl/cloud/functions.json'),
  json<CircuitPlan>('etl/cloud/circuit-publication.contract.json'),
])

assert.equal(allowlist.allowlist_version, '0.2')
assert.equal(allowlist.objects.length, 6)
assert.equal(allowlist.publication_dataset_sha256, manifest.dataset_sha256)
assert.equal(circuit.dataset_sha256, manifest.dataset_sha256)
assert.match(circuit.status, /^blocked_/)
assert.deepEqual(circuit.excluded_local_stage, [
  'DuckDB',
  'OSRM',
  'Neo4j/GDS',
  'CSV shaping',
])

const importFiles = manifest.files.filter((file) => file.table !== 'alerts')
assert.equal(allowlist.ephemeral_publication_inputs.length, importFiles.length)
for (const input of allowlist.ephemeral_publication_inputs) {
  const file = importFiles.find((candidate) => candidate.path === input.source)
  assert.ok(file, `Publication input ${input.source} is not in the committed manifest`)
  assert.equal(input.rows, file.rows)
  assert.equal(input.bytes, file.bytes)
  assert.equal(input.sha256, file.sha256)
  assert.equal(input.operation, 'upsert')
  assert.ok(input.object_key.includes(manifest.dataset_sha256))
}

const local = JSON.stringify(allowlist.explicitly_local)
assert.match(local, /mo_vectors\.jsonl/)
assert.match(local, /full\/\*\*\/duration_matrix\.bin/)

const names = functions.runtime_functions.map((item) => item.name)
assert.equal(new Set(names).size, names.length)
assert.equal(
  functions.runtime_functions.find((item) => item.name === 'kv-graph')?.type,
  'aio',
)
assert.equal(
  functions.runtime_functions.find((item) => item.name === 'kv-optimize')?.type,
  'aio',
)
const routes = functions.runtime_functions.flatMap((item) =>
  item.route ? [item.route] : [],
)
assert.equal(new Set(routes).size, routes.length)

for (const state of circuit.states.filter((item) => item.type === 'Function')) {
  assert.match(state.function ?? '', /^publish-/)
}
for (const name of ['Validate Manifest', 'Manifest Valid?', 'Publication Failed', 'Published']) {
  assert.ok(circuit.states.some((state) => state.name === name), `${name} state is required`)
}

for (const name of ['stations', 'justice', 'baselines', 'incidents']) {
  const config = await json<{ readonly operation: string }>(`etl/dsimport/${name}.json`)
  assert.equal(config.operation, 'upsert', `${name} import must be idempotent`)
}

process.stdout.write(
  `verify:cloud-plan — PASS (${allowlist.objects.length} runtime objects, ` +
    `${importFiles.length} checksummed publication inputs, ` +
    `${functions.runtime_functions.length} runtime functions)\n`,
)
