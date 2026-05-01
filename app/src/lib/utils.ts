import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTimestamp(t: number): string {
  const d = Math.floor((Date.now() - t) / 60000)
  return d < 1 ? 'Just now'
    : d < 60 ? `${d}m ago`
    : d < 1440 ? `${Math.floor(d / 60)}h ago`
    : d < 10080 ? `${Math.floor(d / 1440)}d ago`
    : new Date(t).toLocaleDateString()
}

export function getSpiralPosition(n: number, a = 5): { x: number; y: number } {
  const phi = (1 + Math.sqrt(5)) / 2
  const r = a * Math.sqrt(n)
  const theta = n * phi
  return { x: 100 + r * Math.cos(theta), y: 100 + r * Math.sin(theta) }
}
