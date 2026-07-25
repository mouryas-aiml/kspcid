/**
 * Parquet writing via DuckDB (BUILD_SPEC §3.3).
 *
 * DuckDB is a **build-toolchain** component, like `tsc` — it shapes derived
 * data into Parquet here and into Data Store import CSVs in step 11. It is an
 * embedded analytical engine, not a hosted database service, and nothing about
 * it is deployed (§2.2). Confirming it absent from the deployed surface is a
 * §12 acceptance item.
 *
 * Rows stream through a staging CSV with an explicit DDL rather than
 * `read_json_auto`, so column types are declared rather than inferred — type
 * inference over 425k rows can silently widen an integer column to DOUBLE and
 * break the exact `GROUP BY` reconciliation §7.4 requires.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { dirname, resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

import { OUTPUT } from '../00_config.js'

export type SqlType = 'VARCHAR' | 'INTEGER' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DATE'

export interface Column {
  name: string
  type: SqlType
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Buffered CSV staging writer. Rows are appended in source order and the order
 * is preserved into the Parquet file, which is what keeps output byte-identical
 * across runs (§14.6).
 */
export class ParquetWriter {
  private readonly stream
  private buffer: string[] = []
  private rows = 0

  private constructor(
    private readonly stagingPath: string,
    private readonly columns: readonly Column[],
  ) {
    this.stream = createWriteStream(stagingPath, { encoding: 'utf8' })
    this.buffer.push(`${columns.map((c) => c.name).join(',')}\n`)
  }

  static async create(name: string, columns: readonly Column[]): Promise<ParquetWriter> {
    await mkdir(OUTPUT.staging, { recursive: true })
    return new ParquetWriter(resolve(OUTPUT.staging, `${name}.csv`), columns)
  }

  async write(row: Record<string, unknown>): Promise<void> {
    this.buffer.push(`${this.columns.map((c) => csvCell(row[c.name])).join(',')}\n`)
    this.rows++
    if (this.buffer.length >= 4096) await this.flush()
  }

  private async flush(): Promise<void> {
    const chunk = this.buffer.join('')
    this.buffer = []
    if (!this.stream.write(chunk)) await once(this.stream, 'drain')
  }

  /** Flush staging, convert to Parquet, drop the staging file. Returns row count. */
  async finish(outputPath: string): Promise<number> {
    await this.flush()
    this.stream.end()
    await once(this.stream, 'finish')

    await mkdir(dirname(outputPath), { recursive: true })
    const instance = await DuckDBInstance.create(':memory:')
    const connection = await instance.connect()
    try {
      // DuckDB may encode independent Parquet row groups on different worker
      // threads. Their completion order is semantically irrelevant but can
      // change file bytes on multi-million-row outputs, violating §14.6's
      // bit-identical regeneration requirement. One compiler thread keeps
      // row-group ordering deterministic across runs.
      await connection.run(`SET threads = 1`)
      await connection.run(`SET preserve_insertion_order = true`)
      const ddl = this.columns.map((c) => `"${c.name}" ${c.type}`).join(', ')
      await connection.run(`CREATE TABLE staged (${ddl})`)
      // AUTO_DETECT FALSE is load-bearing: with the sniffer on, DuckDB overrides
      // the declared DDL with its own inference (widening INTEGER to BIGINT,
      // re-typing VARCHAR ids as numbers). The declared types are the contract —
      // step 11 imports these into Data Store against them.
      // The dialect is declared, not sniffed. `Place of Offence` is free text
      // that really does contain doubled quotes and embedded commas — e.g.
      // `Near Bosch Company ""U"" turn` — so RFC 4180 doubling must be stated
      // explicitly or DuckDB guesses an empty escape and fails mid-file.
      await connection.run(
        `COPY staged FROM '${this.stagingPath.replace(/'/g, "''")}' ` +
          `(FORMAT CSV, HEADER, NULLSTR '', AUTO_DETECT FALSE, ` +
          `DELIMITER ',', QUOTE '"', ESCAPE '"')`,
      )
      await connection.run(
        `COPY staged TO '${outputPath.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
      )
    } finally {
      connection.closeSync()
    }
    await rm(this.stagingPath, { force: true })
    return this.rows
  }
}

/** Run a read-only query against Parquet files. Used by the audits and checks. */
export async function query(sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    const reader = await connection.runAndReadAll(sql)
    return reader.getRowObjects() as Record<string, unknown>[]
  } finally {
    connection.closeSync()
  }
}
