/**
 * Builds deployable, scaffold-compatible Catalyst function packages.
 *
 * The owner-generated catalyst.json should point functions.source at
 * `.staging/catalyst/functions`. Source modules remain in functions/ and are
 * never overwritten by `catalyst init` or `functions:add`.
 */
import { build, type Plugin } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUTPUT = resolve(ROOT, '.staging', 'catalyst', 'functions')

interface FunctionDefinition {
  readonly name: string
  readonly type: 'bio' | 'aio' | 'cron'
}

interface FunctionPlan {
  readonly stack: string
  readonly runtime_functions: readonly FunctionDefinition[]
  readonly publication_functions: readonly FunctionDefinition[]
}

const typeName: Readonly<Record<FunctionDefinition['type'], string>> = {
  bio: 'basicio',
  aio: 'advancedio',
  cron: 'cron',
}

const forbidLocalAdapter: Plugin = {
  name: 'forbid-local-adapter',
  setup(buildContext) {
    buildContext.onResolve(
      { filter: /local-adapter\.js$/ },
      () => ({ path: 'local-adapter-stub', namespace: 'cloud-only' }),
    )
    buildContext.onLoad(
      { filter: /.*/, namespace: 'cloud-only' },
      () => ({
        loader: 'ts',
        contents:
          `export class LocalAdapter {\n` +
          `  constructor() { throw new Error('LocalAdapter is excluded from Catalyst packages') }\n` +
          `}\n`,
      }),
    )
  },
}

async function main(): Promise<void> {
  const plan = JSON.parse(
    await readFile(resolve(ROOT, 'etl', 'cloud', 'functions.json'), 'utf8'),
  ) as FunctionPlan
  const definitions = [...plan.runtime_functions, ...plan.publication_functions]
  await rm(OUTPUT, { recursive: true, force: true })
  await mkdir(OUTPUT, { recursive: true })

  for (const definition of definitions) {
    const source = resolve(ROOT, 'functions', definition.name, 'catalyst.ts')
    const target = resolve(OUTPUT, definition.name)
    await mkdir(target, { recursive: true })
    await build({
      entryPoints: [source],
      outfile: resolve(target, 'handler.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: false,
      minify: false,
      external: ['zcatalyst-sdk-node', 'zcatalyst-sdk-node/*'],
      plugins: [forbidLocalAdapter],
      logLevel: 'silent',
    })
    await Promise.all([
      writeFile(
        resolve(target, 'index.js'),
        `'use strict'\nmodule.exports = require('./handler.cjs').default\n`,
        'utf8',
      ),
      writeFile(
        resolve(target, 'package.json'),
        `${JSON.stringify(
          {
            name: definition.name,
            version: '1.0.0',
            private: true,
            main: 'index.js',
            dependencies: { 'zcatalyst-sdk-node': '3.4.0' },
          },
          null,
          2,
        )}\n`,
        'utf8',
      ),
      writeFile(
        resolve(target, 'catalyst-config.json'),
        `${JSON.stringify(
          {
            deployment: {
              name: definition.name,
              stack: plan.stack,
              type: typeName[definition.type],
              env_variables: { KSPCID_DATA_ADAPTER: 'catalyst' },
            },
            execution: { main: 'index.js' },
          },
          null,
          2,
        )}\n`,
        'utf8',
      ),
    ])
  }
  process.stdout.write(
    `Built ${definitions.length} Catalyst function packages at ${OUTPUT}\n`,
  )
}

await main()
