import type {
  DataScalar,
  QueryAggregate,
  QueryFilter,
  QueryOrder,
  TableQuery,
} from './types.js'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new Error(`Unsafe data identifier: ${identifier}`)
  }
  return `"${identifier}"`
}

function quoteScalar(value: DataScalar): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Query numbers must be finite')
    return String(value)
  }
  if (typeof value === 'bigint') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

function isScalarArray(
  value: DataScalar | readonly DataScalar[] | undefined,
): value is readonly DataScalar[] {
  return Array.isArray(value)
}

function renderFilter(filter: QueryFilter): string {
  const column = quoteIdentifier(filter.column)
  switch (filter.operator) {
    case 'is_null':
      return `${column} IS NULL`
    case 'is_not_null':
      return `${column} IS NOT NULL`
    case 'in': {
      if (!isScalarArray(filter.value) || filter.value.length === 0) {
        throw new Error(`IN filter for ${filter.column} requires at least one value`)
      }
      return `${column} IN (${filter.value.map(quoteScalar).join(', ')})`
    }
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (filter.value === undefined || isScalarArray(filter.value)) {
        throw new Error(`${filter.operator} filter for ${filter.column} requires one value`)
      }
      if (filter.value === null) {
        if (filter.operator === 'eq') return `${column} IS NULL`
        if (filter.operator === 'ne') return `${column} IS NOT NULL`
        throw new Error(`NULL only supports eq/ne filters for ${filter.column}`)
      }
      const operators = {
        eq: '=',
        ne: '<>',
        lt: '<',
        lte: '<=',
        gt: '>',
        gte: '>=',
      } as const
      return `${column} ${operators[filter.operator]} ${quoteScalar(filter.value)}`
    }
  }
}

function renderAggregate(aggregate: QueryAggregate): string {
  const column = aggregate.column === '*' ? '*' : quoteIdentifier(aggregate.column)
  return `${aggregate.fn.toUpperCase()}(${column}) AS ${quoteIdentifier(aggregate.as)}`
}

function renderOrder(order: QueryOrder): string {
  return `${quoteIdentifier(order.column)} ${(order.direction ?? 'asc').toUpperCase()}`
}

export function buildTableQuery(query: TableQuery): string {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new Error('Query limit must be a positive integer')
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    throw new Error('Query offset must be a non-negative integer')
  }

  const columns = query.columns?.map(quoteIdentifier) ?? []
  const aggregates = query.aggregates?.map(renderAggregate) ?? []
  const selections = [...columns, ...aggregates]
  const sql = [`SELECT ${selections.length > 0 ? selections.join(', ') : '*'}`]
  sql.push(`FROM ${quoteIdentifier(query.table)}`)

  if (query.filters && query.filters.length > 0) {
    sql.push(`WHERE ${query.filters.map(renderFilter).join(' AND ')}`)
  }
  if (query.groupBy && query.groupBy.length > 0) {
    sql.push(`GROUP BY ${query.groupBy.map(quoteIdentifier).join(', ')}`)
  }
  if (query.orderBy && query.orderBy.length > 0) {
    sql.push(`ORDER BY ${query.orderBy.map(renderOrder).join(', ')}`)
  }
  if (query.limit !== undefined) sql.push(`LIMIT ${query.limit}`)
  if (query.offset !== undefined) sql.push(`OFFSET ${query.offset}`)
  return sql.join(' ')
}
