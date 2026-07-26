import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUTPUT = resolve(ROOT, '.staging', 'catalyst', 'functions')
const require = createRequire(import.meta.url)

interface Definition {
  readonly name: string
  readonly type: 'bio' | 'aio' | 'cron'
}

interface Plan {
  readonly runtime_functions: readonly Definition[]
  readonly publication_functions: readonly Definition[]
}

const plan = JSON.parse(
  await readFile(resolve(ROOT, 'etl', 'cloud', 'functions.json'), 'utf8'),
) as Plan
const definitions = [...plan.runtime_functions, ...plan.publication_functions]
const directories = (await readdir(OUTPUT)).sort()
assert.deepEqual(
  directories,
  definitions.map((item) => item.name).sort(),
  'Built package set must match the checked function plan',
)

const remoteType: Readonly<Record<Definition['type'], string>> = {
  bio: 'basicio',
  aio: 'advancedio',
  cron: 'cron',
}
for (const definition of definitions) {
  const path = resolve(OUTPUT, definition.name)
  const [config, packageJson, bundle] = await Promise.all([
    readFile(resolve(path, 'catalyst-config.json'), 'utf8').then(
      (value) => JSON.parse(value) as {
        readonly deployment: {
          readonly name: string
          readonly stack: string
          readonly type: string
          readonly env_variables: Readonly<Record<string, string>>
        }
      },
    ),
    readFile(resolve(path, 'package.json'), 'utf8').then(
      (value) => JSON.parse(value) as {
        readonly dependencies: Readonly<Record<string, string>>
      },
    ),
    readFile(resolve(path, 'handler.cjs'), 'utf8'),
  ])
  assert.equal(config.deployment.name, definition.name)
  assert.equal(config.deployment.stack, 'node22')
  assert.equal(config.deployment.type, remoteType[definition.type])
  assert.equal(config.deployment.env_variables.KSPCID_DATA_ADAPTER, 'catalyst')
  assert.equal(packageJson.dependencies['zcatalyst-sdk-node'], '3.4.0')
  assert.doesNotMatch(bundle, /@duckdb|read_parquet|read_csv_auto/)
  const handler = require(resolve(path, 'index.js')) as unknown
  assert.equal(typeof handler, 'function', `${definition.name} must export one handler`)
}

process.stdout.write(
  `verify:catalyst-functions — PASS (${definitions.length} Node 22 packages, no local ETL runtime dependency)\n`,
)
