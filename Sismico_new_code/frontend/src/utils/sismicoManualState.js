import { normalizeSismicoObjectText, resolveSismicoObjectCode } from './sismicoObjectResolver'

function asDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function backendCodeForItem(item, detailObjects = [], objectStates = []) {
  return resolveSismicoObjectCode(item, detailObjects, objectStates) || item?.backendObjectCode || item?.code || ''
}

function itemStateMode(item) {
  return String(item?.mode || item?.stateMode || item?.state_mode || '')
    .trim()
    .toLowerCase()
}

function itemLinkGroup(item, detailObjects = [], objectStates = []) {
  const explicitGroup = normalizeSismicoObjectText(item?.manualLinkGroup)
  if (explicitGroup) return explicitGroup

  const visualCode = normalizeSismicoObjectText(item?.code)
  if (visualCode) return visualCode

  const backendCode = normalizeSismicoObjectText(backendCodeForItem(item, detailObjects, objectStates))
  if (backendCode) return backendCode

  const stateMode = itemStateMode(item)
  if (stateMode) return stateMode

  return ''
}

function latestManualDate(entries = {}) {
  let latest = null
  for (const entry of Object.values(entries || {})) {
    const requestedAt = asDate(entry?.requestedAt)
    if (requestedAt && (!latest || requestedAt > latest)) {
      latest = requestedAt
    }
  }
  return latest
}

export function createManualEntry(item, stateCode, detailObjects = [], objectStates = [], requestedAt = new Date()) {
  const date = asDate(requestedAt) || new Date()
  return {
    stateCode,
    backendObjectCode: backendCodeForItem(item, detailObjects, objectStates),
    requestedAt: date.toISOString(),
    ...(item?.automaticSource ? { automaticSource: true } : {}),
  }
}

export function manualEntriesToStateMap(entries = {}) {
  const out = {}
  for (const [visualCode, entry] of Object.entries(entries || {})) {
    if (!entry?.stateCode) continue
    out[visualCode] = entry.stateCode
  }
  return out
}

export function findLinkedManualItemCodes(items = [], targetItem, detailObjects = [], objectStates = []) {
  const targetLinkGroup = itemLinkGroup(targetItem, detailObjects, objectStates)
  if (!targetLinkGroup) return [targetItem?.code].filter(Boolean)

  const linkedCodes = []
  for (const item of items || []) {
    const itemGroup = itemLinkGroup(item, detailObjects, objectStates)
    if (itemGroup !== targetLinkGroup || !item?.code) continue
    linkedCodes.push(item.code)
  }
  return linkedCodes.length ? Array.from(new Set(linkedCodes)) : [targetItem?.code].filter(Boolean)
}

const MANUAL_ONLY_CODES = {
  diamante: ['diamante_pipa', 'pipa', 'footprint_hw', 'diamante_footprint_hw', 'footprint_fw', 'diamante_footprint_fw'],
  andes_norte: ['an_norte_hw', 'ann_an_norte_hw', 'an_norte_fw', 'ann_an_norte_fw', 'an_sur_hw', 'ann_an_sur_hw',
    'cabecera_hw', 'ann_cab_hw', 'ann_cabecera_hw', 'cabecera_fw_norte', 'ann_cab_fw_norte', 'ann_cabecera_fw_norte',
    'monitoreo_post_evento_fw', 'ann_monitoreo_post_evento_fw'],
  andes_norte_tunel_correa: ['tc_oim', 'tc_tc_oim', 'p_4600', 'tc_p_4600'],
}

export function reconcileManualEntries(entries = {}, objectStates = [], siteCode = '') {
  let changed = false
  const next = {}

  for (const [visualCode, entry] of Object.entries(entries || {})) {
    if (!entry?.stateCode) {
      changed = true
      continue
    }

    const manualCodes = MANUAL_ONLY_CODES[String(siteCode).replace(/-/g, '_')] || []
    if (manualCodes.some(code => [entry.backendObjectCode, visualCode].some(value =>
      normalizeSismicoObjectText(value) === normalizeSismicoObjectText(code)))) {
      next[visualCode] = entry
      continue
    }
    const code = normalizeSismicoObjectText(entry.backendObjectCode)
    const remote = code && objectStates.find(row => normalizeSismicoObjectText(row.object_code) === code)
    const observedAt = asDate(remote?.observed_at)
    const requestedAt = asDate(entry.requestedAt)
    // A fresh online reading for this exact polygon is authoritative, including
    // overrides saved before automaticSource was introduced. Site connectivity
    // alone, cached readings and manual states must never release the override.
    const hasValue = [remote?.value, remote?.state_code, remote?.label, remote?.state]
      .some(value => value != null && String(value).trim() !== '')
    if (remote?.source_status === 'online' && hasValue && observedAt && requestedAt && observedAt >= requestedAt) {
      changed = true
      continue
    }
    next[visualCode] = entry
  }

  return changed ? next : entries
}

export function buildDisplayStateFromManualEntries(state, entries = {}) {
  const latestManualAt = latestManualDate(entries)
  if (!latestManualAt) return state

  return {
    ...(state || {}),
    source_status: 'manual',
    last_effective_source_status: 'manual',
    last_effective_source_name: 'operador_local',
    last_effective_record_at: latestManualAt.toISOString(),
  }
}

export function rollbackManualEntries(current, previous, codes, attempted) {
 const next={...current}
 for(const code of codes) {
  if(current[code]?.requestedAt !== attempted.requestedAt)continue
  if(previous[code])next[code]=previous[code]
  else delete next[code]
 }
 return next
}
