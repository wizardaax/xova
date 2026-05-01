import { useRef } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { getSpiralPosition } from '@/lib/utils'
import type { ExecutionStep } from '@/types'

interface TopologyViewProps {
  executionSteps: ExecutionStep[]
  streamCollapsed: boolean
  onToggle: () => void
  getStepColor: (s: ExecutionStep) => string
}

export function TopologyView({ executionSteps, streamCollapsed, onToggle, getStepColor }: TopologyViewProps) {
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const streamEndRef = useRef<HTMLDivElement>(null)

  if (executionSteps.length === 0) return null

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <button
        className="w-full px-4 py-3 flex items-center justify-between bg-slate-100 hover:bg-slate-200 transition-colors"
        onClick={onToggle}
        aria-label="Toggle execution stream"
      >
        <h3 className="text-xs font-semibold text-slate-900">Task Execution Stream & Mesh Topology</h3>
        {streamCollapsed ? <CaretDown size={16} className="text-slate-600" /> : <CaretUp size={16} className="text-slate-600" />}
      </button>

      {!streamCollapsed && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Vogel spiral */}
          <div className="md:col-span-1 relative h-48 bg-white rounded border border-slate-200 overflow-hidden">
            <svg viewBox="0 0 200 200" className="w-full h-full">
              <polyline
                points={executionSteps.map((_, i) => {
                  const p = getSpiralPosition(i + 1)
                  return `${p.x},${p.y}`
                }).join(' ')}
                fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="4 2"
              />
              {executionSteps.map((step, i) => {
                const pos = getSpiralPosition(i + 1)
                const color = step.failed ? '#ef4444' : step.spawnedAgent ? '#06b6d4' : '#3b82f6'
                return (
                  <g
                    key={step.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => stepRefs.current[step.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  >
                    <circle cx={pos.x} cy={pos.y} r="4" fill={color} />
                    <circle cx={pos.x} cy={pos.y} r="4" fill="none" stroke={color} strokeWidth="2" opacity="0.4">
                      <animate attributeName="r" from="4" to="9" dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.4" to="0" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                    <text x={pos.x} y={pos.y - 8} textAnchor="middle" fontSize="6" fill="#64748b">{i + 1}</text>
                  </g>
                )
              })}
            </svg>
            <div className="absolute bottom-1 left-0 right-0 text-[10px] text-center text-slate-500 bg-white/90 rounded-b">
              r=a√n · θ=nφ
            </div>
          </div>

          {/* Execution log */}
          <div className="md:col-span-2 space-y-1 font-mono text-xs max-h-48 overflow-y-auto" role="log">
            {executionSteps.map(s => (
              <div
                key={s.id}
                ref={el => { stepRefs.current[s.id] = el }}
                className="leading-relaxed border-b border-slate-100 pb-1 last:border-0"
              >
                <span className="text-blue-600">[{s.tool}]</span>
                {s.stepNumber && <span className="text-purple-600 ml-2">[{s.stepNumber}]</span>}
                <span className={`ml-2 ${getStepColor(s)}`}>{s.action} → {s.result}</span>
                {s.spawnedAgent?.findings && (
                  <div className="ml-6 mt-1 space-y-0.5">
                    {s.spawnedAgent.findings.map((f, idx) => (
                      <div key={idx} className="text-xs text-slate-600">
                        <span className="text-cyan-600">↳</span> {f}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={streamEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
