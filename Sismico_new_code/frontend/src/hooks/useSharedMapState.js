import { useMemo, useSyncExternalStore } from 'react'

// Same-origin Sala CIC frames share manual visual state, but never other users/maps.
// This state lasts for this open screen only; backend writes remain in the click handler.
export function getSharedMapStore(siteCode, username, field, initialValue, frame = window) {
  let host = frame
  try { if (frame.top) { void frame.top.location.href; host = frame.top } } catch {}
  const stores = host.__tmoneManualMapStores || (host.__tmoneManualMapStores = new Map())
  const key = JSON.stringify([String(username || ''), String(siteCode || '').replaceAll('-', '_'), field])
  if (!stores.has(key)) {
    let value = initialValue
    const listeners = new Set()
    stores.set(key, {
      getSnapshot: () => value,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      set: update => {
        const next = typeof update === 'function' ? update(value) : update
        if (Object.is(next, value)) return
        value = next
        for (const listener of listeners) listener()
      },
    })
  }
  return stores.get(key)
}

export function useSharedMapState(siteCode, username, field = 'manual', initialValue = {}) {
  const store = useMemo(() => getSharedMapStore(siteCode, username, field, initialValue), [siteCode, username, field])
  return [useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), store.set]
}
