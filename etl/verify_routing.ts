import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'

interface Region {
  readonly cells: number
  readonly response_budgets_seconds: readonly number[]
  readonly words_per_bitset: number
  readonly duration_storage: {
    readonly conditions: string
    readonly congestion_baked_in: boolean
  }
}

interface Validation {
  readonly status: string
  readonly median_duration_error_percent: number
  readonly max_duration_error_percent: number
  readonly disconnected_pairs: number
  readonly one_way_asymmetry_pairs: number
  readonly cross_boundary_pairs: number
}

async function main(): Promise<void> {
  const region = JSON.parse(
    await readFile(resolve(OUTPUT.routing, 'corridor_region.json'), 'utf8'),
  ) as Region
  const validation = JSON.parse(
    await readFile(resolve(OUTPUT.routing, 'validation.json'), 'utf8'),
  ) as Validation
  const matrixPath = resolve(OUTPUT.routing, 'duration_matrix.bin')
  const bitsetsPath = resolve(OUTPUT.routing, 'coverage_bitsets.bin')
  const matrixSize = (await stat(matrixPath)).size
  const bitsetBytes = await readFile(bitsetsPath)

  assert.equal(matrixSize, region.cells * region.cells * Float32Array.BYTES_PER_ELEMENT)
  assert.equal(
    bitsetBytes.byteLength,
    region.cells *
      region.response_budgets_seconds.length *
      region.words_per_bitset *
      Uint32Array.BYTES_PER_ELEMENT,
  )
  assert.equal(region.duration_storage.conditions, 'free_flow')
  assert.equal(region.duration_storage.congestion_baked_in, false)
  assert.equal(validation.status, 'PASS')
  assert.equal(validation.disconnected_pairs, 0)
  assert.ok(validation.median_duration_error_percent < 5)
  assert.ok(validation.max_duration_error_percent < 20)
  assert.ok(validation.one_way_asymmetry_pairs > 0)
  assert.ok(validation.cross_boundary_pairs > 0)

  const words = new Uint32Array(
    bitsetBytes.buffer,
    bitsetBytes.byteOffset,
    bitsetBytes.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  )
  for (let origin = 0; origin < region.cells; origin++) {
    for (let budget = 0; budget < region.response_budgets_seconds.length; budget++) {
      const base =
        (origin * region.response_budgets_seconds.length + budget) *
        region.words_per_bitset
      assert.ok(
        ((words[base + (origin >>> 5)] ?? 0) & (1 << (origin & 31))) !== 0,
        `origin ${origin} must cover itself at budget index ${budget}`,
      )
    }
  }

  process.stdout.write(
    `Routing verified: ${region.cells.toLocaleString()} cells, free-flow matrix, bitsets, and validation PASS.\n`,
  )
}

await main()
