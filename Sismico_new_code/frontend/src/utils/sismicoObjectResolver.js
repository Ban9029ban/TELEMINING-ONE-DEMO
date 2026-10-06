export function normalizeSismicoObjectText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function uniqueNormalized(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeSismicoObjectText(value))
        .filter(Boolean),
    ),
  )
}

function sourceValues(source) {
  return uniqueNormalized([
    source?.code,
    source?.object_code,
    source?.name,
    source?.object_name,
  ])
}

function matchesCandidate(candidate, values) {
  return values.some((value) => value === candidate || value.includes(candidate) || candidate.includes(value))
}

export function hasSismicoObjectSupport(item, detailObjects = [], objectStates = []) {
  const sources = [...(detailObjects || []), ...(objectStates || [])]
  if (!sources.length) return true

  const candidates = uniqueNormalized([
    item?.backendObjectCode,
    item?.code,
    item?.name,
    ...(item?.keys || []),
  ])

  return candidates.some((candidate) =>
    sources.some((source) => {
      const values = sourceValues(source)
      return values.length && matchesCandidate(candidate, values)
    }),
  )
}

export function resolveSismicoObjectCode(item, detailObjects = [], objectStates = []) {
  if (item?.backendObjectCode) {
    return item.backendObjectCode
  }

  const candidates = uniqueNormalized([
    item?.code,
    item?.name,
    ...(item?.keys || []),
  ])
  const sources = [...(detailObjects || []), ...(objectStates || [])]

  for (const candidate of candidates) {
    for (const source of sources) {
      const values = sourceValues(source)
      if (!values.length || !values.includes(candidate)) continue
      return source?.code || source?.object_code || item?.code
    }
  }

  for (const candidate of candidates) {
    for (const source of sources) {
      const values = sourceValues(source)
      if (!values.length || !matchesCandidate(candidate, values)) continue
      return source?.code || source?.object_code || item?.code
    }
  }

  return item?.code
}
