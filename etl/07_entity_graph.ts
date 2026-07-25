/**
 * 07 — seeded entity-graph compiler (BUILD_SPEC §6.4 step 07, §7.3).
 *
 * Incident nodes retain source-derived attributes. Entity identities and every
 * relationship are generated demonstration structure and remain visibly
 * labelled with a scenario id and the two-axis provenance contract.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableIndex } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const INCIDENTS_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const OUTPUT_PATH = resolve(OUTPUT.derived, 'entity_graph_raw.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a13_entity_graph.md')
const INCIDENTS_PER_SCENARIO = 720
const CLUSTER_SIZE = 20

type EntityType = 'person' | 'vehicle' | 'phone' | 'account'

interface ScenarioDefinition {
  readonly id: string
  readonly label: string
  readonly where: string
  readonly entities: Readonly<Record<EntityType, number>>
}

const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'vehicle_theft_ring',
    label: 'Generated vehicle-theft ring',
    where: `crime_group = 'THEFT' AND crime_head = 'Of Automobiles - Of Two Wheelers'`,
    entities: { person: 1, vehicle: 2, phone: 1, account: 0 },
  },
  {
    id: 'cyber_mule_network',
    label: 'Generated cyber mule-account network',
    where: `crime_group = 'CYBER CRIME'`,
    entities: { person: 0, vehicle: 0, phone: 1, account: 4 },
  },
  {
    id: 'repeat_burglary_group',
    label: 'Generated repeat burglary group',
    where: `crime_group IN ('BURGLARY - NIGHT', 'BURGLARY - DAY')`,
    entities: { person: 2, vehicle: 0, phone: 1, account: 0 },
  },
  {
    id: 'cross_jurisdiction_chain_snatching',
    label: 'Generated cross-jurisdiction chain-snatching group',
    where: `crime_group = 'ROBBERY' AND crime_head = 'Chain Snatching'`,
    entities: { person: 1, vehicle: 2, phone: 0, account: 0 },
  },
  {
    id: 'repeat_domestic_abuse',
    label: 'Generated repeat domestic-abuse accused',
    where: `crime_group = 'CRUELTY BY HUSBAND'`,
    entities: { person: 1, vehicle: 0, phone: 1, account: 0 },
  },
  {
    id: 'ndps_supply_chain',
    label: 'Generated NDPS supply chain',
    where: `crime_group = 'NARCOTIC DRUGS & PSHYCOTROPIC SUBSTANCES'`,
    entities: { person: 2, vehicle: 0, phone: 1, account: 1 },
  },
]

interface IncidentRow {
  readonly incident_id: string
  readonly case_ref: string
  readonly registered_on: string
  readonly station_code: string
  readonly unit_name: string
  readonly police_division: string
  readonly crime_group: string
  readonly crime_head: string
  readonly h3_r7: string
  readonly h3_r9: string
  readonly estimated_occurrence_hour: number | null
  readonly time_origin: string
  readonly geo_origin: string
}

interface GraphNode {
  readonly id: string
  readonly type: 'incident' | EntityType
  readonly label: string
  readonly scenario_id: string
  readonly attributes: Readonly<Record<string, unknown>>
  readonly provenance: {
    readonly source_authority: 'third_party_mirror' | 'generated_demo'
    readonly transformation: 'normalized' | 'generated'
    readonly method?: string
    readonly source_checksum: string
    readonly generation_version: string
  }
}

interface GraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly relation: string
  readonly support_type: 'generated_scenario' | 'model_similarity'
  readonly weight: number
  readonly scenario_id: string
  readonly explanation: string
  readonly provenance: {
    readonly source_authority: 'third_party_mirror' | 'generated_demo'
    readonly transformation: 'inferred' | 'generated'
    readonly method: string
    readonly source_checksum: string
    readonly generation_version: string
  }
}

function entityLabel(type: EntityType, scenario: string, cluster: number, ordinal: number): string {
  const prefix = { person: 'Person', vehicle: 'Vehicle', phone: 'Phone', account: 'Account' }[type]
  return `DEMO ${prefix} ${scenario.slice(0, 3).toUpperCase()}-${String(cluster + 1).padStart(2, '0')}-${ordinal + 1}`
}

async function loadIncidents(definition: ScenarioDefinition): Promise<IncidentRow[]> {
  return (await query(
    `SELECT incident_id, case_ref, strftime(registered_on, '%Y-%m-%d') AS registered_on,
            station_code, unit_name, police_division, crime_group, crime_head,
            h3_r7, h3_r9, estimated_occurrence_hour, time_origin, geo_origin
       FROM read_parquet('${INCIDENTS_PATH.replaceAll("'", "''")}')
      WHERE within_complete_window AND ${definition.where}
      ORDER BY station_code, h3_r7, estimated_occurrence_hour NULLS LAST,
               registered_on DESC, incident_id
      LIMIT ${INCIDENTS_PER_SCENARIO}`,
  )) as unknown as IncidentRow[]
}

async function main(): Promise<void> {
  const sourceChecksum = await sha256File(INCIDENTS_PATH)
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const scenarioSummary: Array<Record<string, unknown>> = []

  for (const definition of SCENARIOS) {
    const incidents = await loadIncidents(definition)
    if (incidents.length !== INCIDENTS_PER_SCENARIO) {
      throw new Error(`${definition.id} has ${incidents.length}, expected ${INCIDENTS_PER_SCENARIO}`)
    }
    const entityIdsByCluster = new Map<number, Record<EntityType, string[]>>()
    const clusters = Math.ceil(incidents.length / CLUSTER_SIZE)
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      const ids: Record<EntityType, string[]> = { person: [], vehicle: [], phone: [], account: [] }
      for (const type of Object.keys(definition.entities) as EntityType[]) {
        for (let ordinal = 0; ordinal < definition.entities[type]; ordinal += 1) {
          const id = `entity:${definition.id}:${cluster}:${type}:${ordinal}`
          ids[type].push(id)
          nodes.push({
            id,
            type,
            label: entityLabel(type, definition.id, cluster, ordinal),
            scenario_id: definition.id,
            attributes: { generated: true, cluster, ordinal },
            provenance: {
              source_authority: 'generated_demo',
              transformation: 'generated',
              method: 'seeded_entity_graph_v1',
              source_checksum: sourceChecksum,
              generation_version: GENERATION_VERSION,
            },
          })
        }
      }
      entityIdsByCluster.set(cluster, ids)
      const clusterEntities = (Object.values(ids) as string[][]).flat()
      for (let index = 1; index < clusterEntities.length; index += 1) {
        const source = clusterEntities[index - 1]!
        const target = clusterEntities[index]!
        edges.push({
          id: `edge:${definition.id}:${cluster}:entity:${index}`,
          source,
          target,
          relation: 'generated_association',
          support_type: 'generated_scenario',
          weight: 0.8,
          scenario_id: definition.id,
          explanation: `Generated scenario association inside ${definition.label}; not a source-recorded relationship.`,
          provenance: {
            source_authority: 'generated_demo',
            transformation: 'generated',
            method: 'seeded_entity_graph_v1',
            source_checksum: sourceChecksum,
            generation_version: GENERATION_VERSION,
          },
        })
      }
      if (cluster > 0) {
        const previousEntities = entityIdsByCluster.get(cluster - 1)
        const previousBridge = previousEntities
          ? (Object.values(previousEntities) as string[][]).flat()[0]
          : undefined
        const currentBridge = clusterEntities[0]
        if (previousBridge && currentBridge) {
          edges.push({
            id: `edge:${definition.id}:${cluster}:bridge`,
            source: previousBridge,
            target: currentBridge,
            relation: 'generated_cluster_bridge',
            support_type: 'generated_scenario',
            weight: 0.7,
            scenario_id: definition.id,
            explanation: `Generated bridge between scenario clusters; not a source-recorded relationship.`,
            provenance: {
              source_authority: 'generated_demo',
              transformation: 'generated',
              method: 'seeded_entity_graph_v1',
              source_checksum: sourceChecksum,
              generation_version: GENERATION_VERSION,
            },
          })
        }
      }
    }

    incidents.forEach((incident, index) => {
      const cluster = Math.floor(index / CLUSTER_SIZE)
      nodes.push({
        id: `incident:${incident.incident_id}`,
        type: 'incident',
        label: incident.case_ref,
        scenario_id: definition.id,
        attributes: {
          incident_id: incident.incident_id,
          case_ref: incident.case_ref,
          registered_on: incident.registered_on,
          station_code: incident.station_code,
          unit_name: incident.unit_name,
          police_division: incident.police_division,
          crime_group: incident.crime_group,
          crime_head: incident.crime_head,
          h3_r9: incident.h3_r9,
          estimated_occurrence_hour: incident.estimated_occurrence_hour,
          time_origin: incident.time_origin,
          geo_origin: incident.geo_origin,
        },
        provenance: {
          source_authority: 'third_party_mirror',
          transformation: 'normalized',
          source_checksum: sourceChecksum,
          generation_version: GENERATION_VERSION,
        },
      })
      const entityGroups = entityIdsByCluster.get(cluster)!
      const allEntities = (Object.values(entityGroups) as string[][]).flat()
      const primary =
        allEntities[
          stableIndex('entity_graph_primary', incident.incident_id, definition.id, allEntities.length)
        ]!
      edges.push({
        id: `edge:${definition.id}:incident:${incident.incident_id}:primary`,
        source: `incident:${incident.incident_id}`,
        target: primary,
        relation: 'generated_scenario_link',
        support_type: 'generated_scenario',
        weight: 1,
        scenario_id: definition.id,
        explanation: `Generated link for the ${definition.label}; the incident attributes are source-derived, the entity and relationship are demonstration structure.`,
        provenance: {
          source_authority: 'generated_demo',
          transformation: 'generated',
          method: 'seeded_entity_graph_v1',
          source_checksum: sourceChecksum,
          generation_version: GENERATION_VERSION,
        },
      })
      const previous = index % CLUSTER_SIZE === 0 ? null : incidents[index - 1]
      if (previous) {
        edges.push({
          id: `edge:${definition.id}:similarity:${previous.incident_id}:${incident.incident_id}`,
          source: `incident:${previous.incident_id}`,
          target: `incident:${incident.incident_id}`,
          relation: 'model_similarity',
          support_type: 'model_similarity',
          weight: 0.65,
          scenario_id: definition.id,
          explanation: `Modelled similarity within a generated cluster sharing crime taxonomy, H3 r7 ordering and estimated-time ordering.`,
          provenance: {
            source_authority: 'third_party_mirror',
            transformation: 'inferred',
            method: 'seeded_cluster_similarity_v1',
            source_checksum: sourceChecksum,
            generation_version: GENERATION_VERSION,
          },
        })
      }
    })
    scenarioSummary.push({
      scenario_id: definition.id,
      incidents: incidents.length,
      clusters,
      generated_entities: [...entityIdsByCluster.values()].reduce(
        (sum, ids) => sum + (Object.values(ids) as string[][]).flat().length,
        0,
      ),
    })
  }

  const graph = {
    schema_version: 1,
    directed: false,
    multi: false,
    nodes,
    edges,
    scenarios: scenarioSummary,
    provenance: {
      source_authority: 'mixed',
      transformation: 'source_nodes_plus_generated_relationships',
      method: 'seeded_entity_graph_v1',
      source_checksum: sourceChecksum,
      generation_version: GENERATION_VERSION,
    },
  }
  await mkdir(OUTPUT.derived, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
  await recordOutput(
    '07_entity_graph',
    OUTPUT_PATH,
    nodes.length,
    [{ path: INCIDENTS_PATH, sha256: sourceChecksum }],
    { nodes: nodes.length, edges: edges.length, scenarios: SCENARIOS.length },
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A13 entity graph\n\n` +
      `- Source-derived incident nodes: **${SCENARIOS.length * INCIDENTS_PER_SCENARIO}**\n` +
      `- Generated entity nodes: **${nodes.length - SCENARIOS.length * INCIDENTS_PER_SCENARIO}**\n` +
      `- Edges: **${edges.length}**\n` +
      `- Seeded scenarios: **${SCENARIOS.length}**\n\n` +
      `All entity identities and relationships are generated demonstration structure. Incident attributes retain mirror provenance.\n`,
    'utf8',
  )
  process.stdout.write(
    `07 · entity graph ${nodes.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} edges · ${SCENARIOS.length} scenarios\n`,
  )
}

await main()
