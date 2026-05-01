import { useState, useRef, useEffect, useCallback } from 'react'

interface ISpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

export const useVoiceXova = (onCommand: (text: string) => void) => {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const isListeningRef = useRef(false)

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return
    setIsSpeaking(true)
    const clean = text.replace(/[#*_~`>\-•]/g, '').replace(/\n+/g, '. ').slice(0, 300)
    const utter = new SpeechSynthesisUtterance(clean)
    utter.rate = 1.05
    utter.pitch = 1.0
    utter.onend = () => setIsSpeaking(false)
    utter.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utter)
  }, [])

  useEffect(() => {
    const win = window as unknown as Record<string, unknown>
    const SpeechRecognitionCtor = (win['SpeechRecognition'] || win['webkitSpeechRecognition']) as (new () => ISpeechRecognition) | undefined
    if (!SpeechRecognitionCtor) return

    const rec = new SpeechRecognitionCtor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('')
        .toLowerCase()
        .trim()

      const wakeMatch = transcript.match(/\b(xova|jarvis)\b/i)
      if (wakeMatch) {
        const agentName = wakeMatch[1].toLowerCase()
        const command = transcript.slice(transcript.indexOf(wakeMatch[0])).replace(/^(xova|jarvis)[,\s]*/i, '').trim()
        if (command.length > 0) onCommand(`@${agentName} ${command}`)
        else speak(agentName === 'jarvis' ? 'Yes, sir.' : 'Xova here.')
      }
    }

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== 'no-speech') console.warn('Voice error:', e.error)
    }

    rec.onend = () => {
      if (isListeningRef.current) {
        try { rec.start() } catch { /* ignore */ }
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = rec
  }, [onCommand, speak])

  const toggleListening = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) {
      alert('Speech recognition not supported. Try Microsoft Edge.')
      return
    }
    if (isListeningRef.current) {
      isListeningRef.current = false
      rec.stop()
      setIsListening(false)
    } else {
      isListeningRef.current = true
      try { rec.start() } catch { /* already started */ }
      setIsListening(true)
    }
  }, [])

  return { isListening, isSpeaking, toggleListening, speak }
}
