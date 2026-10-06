import { useEffect, useMemo, useState } from 'react'

function safeRead(storageKey) {
  if (!storageKey || typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function safeWrite(storageKey, value) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {}
}

export function usePersistentBoxVisibility(storageKey, boxIds) {
  const joinedIds = useMemo(() => (Array.isArray(boxIds) ? boxIds.join('|') : ''), [Array.isArray(boxIds) ? boxIds.join('|') : ''])
  const stableBoxIds = useMemo(() => (joinedIds ? joinedIds.split('|').filter(Boolean) : []), [joinedIds])
  const [hiddenById, setHiddenById] = useState({})

  useEffect(() => {
    const source = safeRead(storageKey)
    const next = {}
    for (const id of stableBoxIds) {
      next[id] = Boolean(source[id])
    }
    setHiddenById(next)
  }, [storageKey, joinedIds, stableBoxIds])

  useEffect(() => {
    const toStore = {}
    for (const id of stableBoxIds) {
      if (hiddenById[id]) toStore[id] = true
    }
    safeWrite(storageKey, toStore)
  }, [storageKey, joinedIds, stableBoxIds, hiddenById])

  const isHidden = (id) => Boolean(hiddenById[id])
  const hideBox = (id) => setHiddenById((prev) => ({ ...prev, [id]: true }))
  const showBox = (id) => setHiddenById((prev) => ({ ...prev, [id]: false }))
  const hiddenIds = stableBoxIds.filter((id) => Boolean(hiddenById[id]))

  return { isHidden, hideBox, showBox, hiddenIds }
}
