type Json = Record<string, unknown>

const NESTED = ['items', 'prefixItems', 'oneOf', 'anyOf'] as const

/** Paths of the properties of a JSON schema without a `description`, at any depth: under `properties`, `items`, `prefixItems`, `oneOf`, `anyOf` and `$defs`. */
export function undescribed(schema: unknown, path = ''): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item: unknown, index) => undescribed(item, `${path}[${String(index)}]`))
  }
  if (!isObject(schema)) return []
  const properties = isObject(schema.properties) ? Object.entries(schema.properties) : []
  const defs = isObject(schema.$defs) ? Object.entries(schema.$defs) : []
  return [
    ...properties.flatMap(([key, value]) => [
      ...(isObject(value) && typeof value.description === 'string' ? [] : [`${path}.${key}`]),
      ...undescribed(value, `${path}.${key}`),
    ]),
    ...NESTED.flatMap((key) => undescribed(schema[key], `${path}/${key}`)),
    ...defs.flatMap(([key, value]) => undescribed(value, `#/$defs/${key}`)),
  ]
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
