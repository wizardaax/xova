import { useState, useEffect, useCallback } from 'react'
import { openDB, type IDBPDatabase } from 'idb'

interface VectorEntry {
  id: string
  text: string
  embedding: number[]
  timestamp: number
}

interface VectorDB {
  vectors: {
    key: string
    value: VectorEntry
    indexes: Record<string, never>
  }
}

const mockEmbed = (text: string): number[] => {
  const vec = new Array(128).fill(0) as number[]
  for (let i = 0; i < text.length; i++) vec[i % 128] += text.charCodeAt(i)
  return vec.map(v => v / text.length)
}

export function useVectorMemory() {
  const [db, setDb] = useState<IDBPDatabase<VectorDB> | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    openDB<VectorDB>('aeon-memory', 1, {
      upgrade(d) { d.createObjectStore('vectors', { keyPath: 'id' }) }
    }).then(d => { setDb(d); setIsReady(true) })
  }, [])

  const addMemory = useCallback(async (id: string, text: string) => {
    if (!db) return
    const embedding = mockEmbed(text)
    await db.put('vectors', { id, text, embedding, timestamp: Date.now() })
  }, [db])

  const search = useCallback(async (query: string, threshold = 0.7): Promise<{ id: string; text: string }[]> => {
    if (!db) return []
    const queryVec = mockEmbed(query)
    const all = await db.getAll('vectors')
    return all
      .map(item => {
        const dot = item.embedding.reduce((sum: number, v: number, i: number) => sum + v * queryVec[i], 0)
        return { id: item.id, text: item.text, score: dot }
      })
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  }, [db])

  // Keyword search — finds chunks that literally contain query words
  const keywordSearch = useCallback(async (query: string, maxResults = 6): Promise<{ id: string; text: string; score: number }[]> => {
    if (!db) return []
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    if (!words.length) return []
    const all = await db.getAll('vectors')
    return all
      .map(item => {
        const lower = item.text.toLowerCase()
        const hits = words.filter(w => lower.includes(w)).length
        return { id: item.id, text: item.text, score: hits / words.length }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
  }, [db])

  return { isReady, addMemory, search, keywordSearch }
}
