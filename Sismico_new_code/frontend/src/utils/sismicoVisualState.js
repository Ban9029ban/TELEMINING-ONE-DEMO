export function normalizeVisualText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveLegacyPolygonAsset(item, stateCode, options = {}) {
  const mode = item.mode || item.stateMode || item.state_mode || 'tri'
  const assets = item.assets || item.overlayAssets || item.overlay_assets || {}
  const inferiorUsesRed = options.inferiorUsesRed !== false

  if (mode === 'traffic') {
    return assets[stateCode] || assets.rojo || assets.amarillo || assets.verde || null
  }

  if (mode === 'dual') {
    return stateCode === 'alerta'
      ? assets.alerta || assets.critical || assets.alert || assets.normal || assets.safe || null
      : assets.normal || assets.safe || assets.alerta || assets.critical || assets.alert || null
  }

  if (stateCode === 'inferior') {
    return inferiorUsesRed
      ? assets.inferior || assets.superior || assets.critical || assets.alert || assets.centro || assets.normal || null
      : assets.inferior || null
  }

  if (stateCode === 'superior') {
    return assets.superior || assets.critical || assets.alert || assets.centro || assets.normal || null
  }

  if (stateCode === 'amarillo' || stateCode === 'warning') {
    return assets.amarillo || assets.warning || assets.centro || assets.normal || assets.superior || assets.critical || null
  }

  return assets.centro || assets.normal || assets.safe || assets.amarillo || assets.warning || assets.superior || assets.critical || null
}

export function buildPrioritizedOverlays(groups, effectiveStates, {
  defaultStateResolver,
  selectedCode = null,
  inferiorUsesRed = true,
} = {}) {
  let idx = 0
  const overlays = []

  for (const group of groups || []) {
    for (const item of group.items || []) {
      const fallbackState = typeof defaultStateResolver === 'function'
        ? defaultStateResolver(item)
        : item.mode === 'dual'
          ? 'normal'
          : item.mode === 'traffic'
            ? 'verde'
            : 'centro'

      const stateCode = effectiveStates?.[item.code] || fallbackState
      const src = resolveLegacyPolygonAsset(item, stateCode, { inferiorUsesRed })
      if (!src) continue
      const isSelected = selectedCode && item.code === selectedCode
      overlays.push({
        key: item.code,
        item,
        src,
        stateCode,
        selected: Boolean(isSelected),
        zIndex: isSelected ? 5000 : 20 + idx,
        blinkSlot: idx % 7,
      })
      idx += 1
    }
  }

  overlays.sort((a, b) => a.zIndex - b.zIndex)
  return overlays
}
