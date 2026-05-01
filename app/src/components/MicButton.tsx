import { Microphone, SpeakerHigh, MicrophoneSlash } from '@phosphor-icons/react'

export const MicButton = ({ isListening, isSpeaking, onToggle }: {
  isListening: boolean
  isSpeaking: boolean
  onToggle: () => void
}) => (
  <button
    onClick={onToggle}
    title={isListening ? 'Listening — say "Aeon [command]"' : 'Click to enable voice'}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
      isListening
        ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse'
        : isSpeaking
        ? 'bg-blue-600 text-white'
        : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
    }`}
  >
    {isSpeaking ? <SpeakerHigh size={14} /> : isListening ? <MicrophoneSlash size={14} /> : <Microphone size={14} />}
    {isListening ? 'Listening' : isSpeaking ? 'Speaking' : 'Voice'}
  </button>
)
