/** Acceptance checks for the completed A0b full routing build. */
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<void> {
  const root = resolve(OUTPUT.routing, 'full')
  const planPath = resolve(root, 'build_plan.json')
  const validationPath = resolve(root, 'validation.json')
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as {
    mode: string
    validation_pairs_per_region: number
    tiers: { regional: number; local: number; superzone: number }
    all_106_station_polygons_covered: boolean
    definitions: Array<{ id: string; tier: string; stationCodes: string[] }>
  }
  const validation = JSON.parse(await readFile(validationPath, 'utf8')) as {
    status: string
    regions_total: number
    regions_passed: number
    regions_failed: number
    validation_pairs_per_region: number
    results: Array<{
      id: string
      tier: string
      status: string
      validation?: {
        status: string
        samples: number
        median_duration_error_percent: number
        max_duration_error_percent: number
        disconnected_pairs: number
      }
    }>
  }
  assert(plan.mode === 'full', 'Full routing plan mode drift')
  assert(plan.definitions.length === 106, 'Expected 106 routing definitions')
  assert(plan.all_106_station_polygons_covered, 'Routing plan must cover all station polygons')
  assert(plan.tiers.regional === 10, 'Expected 10 regional scenario zones')
  assert(plan.tiers.superzone === 3, 'Expected 3 superzones')
  assert(plan.tiers.local === 93, 'Expected 93 locals after 13 distinct regional anchors')
  assert(validation.status === 'PASS', 'Aggregate full routing validation is not PASS')
  assert(validation.regions_total === 106, 'Aggregate routing total drift')
  assert(validation.regions_passed === 106 && validation.regions_failed === 0, 'Not every region passed')
  assert(validation.validation_pairs_per_region === 500, 'Expected 500 validation pairs per region')

  let actualPairs = 0
  for (const result of validation.results) {
    assert(result.status === 'PASS' && result.validation?.status === 'PASS', `${result.id} failed`)
    const outputDir = resolve(root, result.tier, result.id)
    const region = JSON.parse(
      await readFile(resolve(outputDir, 'region.json'), 'utf8'),
    ) as { cells: number }
    const expectedSamples = Math.min(500, region.cells * (region.cells - 1))
    assert(result.validation.samples === expectedSamples, `${result.id} sample count drift`)
    actualPairs += result.validation.samples
    assert(result.validation.disconnected_pairs === 0, `${result.id} has disconnected pairs`)
    assert(result.validation.median_duration_error_percent < 5, `${result.id} median error >= 5%`)
    assert(result.validation.max_duration_error_percent < 20, `${result.id} max error >= 20%`)
    await Promise.all(
      ['region.json', 'hex_index.json', 'duration_matrix.bin', 'coverage_bitsets.bin', 'validation.json'].map(
        (file) => access(resolve(outputDir, file)),
      ),
    )
  }
  const checksum = await sha256File(validationPath)
  process.stdout.write(
    `verify:full-routing — PASS\n` +
      `  regions             106 / 106\n` +
      `  live pairs          ${actualPairs.toLocaleString()} (500 cap/region)\n` +
      `  regional/local/sz   ${plan.tiers.regional}/${plan.tiers.local}/${plan.tiers.superzone}\n` +
      `  validation sha256   ${checksum}\n`,
  )
}

await main()
