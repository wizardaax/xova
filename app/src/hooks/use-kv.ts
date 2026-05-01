import { useState, useCallback } from 'react'

export function useKV<T>(key: string, defaultValue: T): [T, (updater: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key])

  const del = useCallback(() => {
    localStorage.removeItem(key)
    setValue(defaultValue)
  }, [key]) // eslint-disable-line

  return [value, set, del]
}
