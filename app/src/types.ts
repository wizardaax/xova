export type TaskStatus = 'complete' | 'failed' | 'paused'
export type AgentStatus = 'active' | 'idle' | 'working'
export type ToolMode = 'auto' | 'code' | 'research' | 'files' | 'schedule'
export type FilterRole = 'all' | 'user' | 'agent'
export type DateFilter = 'all' | 'today' | 'week' | 'month'
export type ExportFormat = 'markdown' | 'json' | 'text'

export interface SpawnedAgent {
  name: string
  role: string
  status: 'active' | 'complete' | 'failed'
  findings?: string[]
}

export interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
}

export interface ExecutionStep {
  id: string
  tool: string
  action: string
  result: string
  failed?: boolean
  stepNumber?: string
  spawnedAgent?: SpawnedAgent
}

export interface Task {
  id: string
  title: string
  status: TaskStatus
  timestamp: number
  steps: string[]
}

export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  timestamp: number
  processed: boolean
  analysisResult?: string
}

export interface ExportHistory {
  id: string
  timestamp: number
  format: ExportFormat
  type: 'history' | 'responses'
  itemCount: number
  success: boolean
  filename: string
}

export interface SkillEntry {
  id: string
  timestamp: number
  trigger: string[]
  agents: string[]
  pattern: string[]
  reused: number
}
