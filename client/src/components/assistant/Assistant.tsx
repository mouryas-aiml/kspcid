'use client'

/**
 * The assistant panel. Text is the deliverable; voice is enhancement.
 *
 * Layered so each level works without the one above it:
 *
 *   1. Text in, text out. Always available, no permissions, no device support
 *      to check. This is the thing that has to work in the demo.
 *   2. Speech out, where a voice for the language is installed.
 *   3. Speech in, where the browser implements SpeechRecognition.
 *
 * Speech recognition in Chrome and Safari sends audio to a remote service, so
 * this is not an offline capability and is not described as one. `lang` is a
 * request, not a guarantee: setting `kn-IN` does not mean the browser supports
 * Kannada, so a failed start degrades to the text field rather than leaving a
 * mic button that silently does nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Send, Volume2, X } from 'lucide-react'

import { fetchPublicArtifact, publicPath } from '@/lib/publicPath'
import {
  answerQuestion,
  detectLanguage,
  type AssistantAnswer,
  type AssistantData,
  type AssistantStation,
} from '@/lib/assistant/intents'

interface BriefFixture {
  readonly snapshot_label: string
  readonly snapshot_week_start: string
  readonly analysis_cutoff: string
  readonly overview: {
    readonly stations_evaluated: number
    readonly stations_above_expected_band: number
    readonly stations_with_alert: number
  }
  readonly stations: readonly AssistantStation[]
  readonly outlook: {
    readonly next_week_start: string
    readonly low: number
    readonly expected: number
    readonly high: number
  } | null
  readonly staffing: {
    readonly most_loaded: readonly { readonly station_name: string; readonly open_per_officer: number }[]
  }
}

interface JusticeFixture {
  readonly observed: {
    readonly total_records: number
    readonly stages: readonly { readonly stage: string; readonly count: number }[]
  }
}

/** Minimal shape of the Web Speech API; it is not in the DOM lib typings. */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

interface Turn {
  readonly question: string
  readonly answer: AssistantAnswer
}

export function Assistant() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<AssistantData | null>(null)
  const [term, setTerm] = useState('')
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [listening, setListening] = useState(false)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const speechSupported = useMemo(() => recognitionCtor() !== null, [])

  useEffect(() => {
    if (!open || data) return
    const load = async <T,>(path: string): Promise<T> => {
      const response = await fetchPublicArtifact(path)
      if (!response.ok) throw new Error(`${path} failed (${response.status})`)
      return response.json() as Promise<T>
    }
    Promise.all([
      load<BriefFixture>('/data/scenarios/station_brief.json'),
      load<JusticeFixture>('/data/scenarios/justice_pipeline.json'),
    ])
      .then(([brief, justice]) => {
        const undetected = justice.observed.stages.find((stage) => stage.stage === 'undetected')
        setData({
          snapshotLabel: brief.snapshot_label,
          snapshotWeekStart: brief.snapshot_week_start,
          analysisCutoff: brief.analysis_cutoff,
          stationsAboveBand: brief.overview.stations_above_expected_band,
          stationsWithAlert: brief.overview.stations_with_alert,
          stationsEvaluated: brief.overview.stations_evaluated,
          stations: brief.stations,
          undetected: undetected?.count ?? null,
          totalRecords: justice.observed.total_records,
          outlook: brief.outlook,
          mostLoaded: brief.staffing.most_loaded,
        })
      })
      .catch(() => setVoiceNote('The station briefs could not be loaded.'))
  }, [open, data])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // ⌘/ opens the assistant. ⌘K is already the command palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Best-effort speech out. Silent when no voice for the language exists. */
  const speak = useCallback((text: string, language: 'en' | 'kn') => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const target = language === 'kn' ? 'kn' : 'en'
    const voice = window.speechSynthesis
      .getVoices()
      .find((candidate) => candidate.lang.toLowerCase().startsWith(target))
    if (!voice) {
      setVoiceNote(
        language === 'kn'
          ? 'No Kannada voice is installed on this device, so the reply is shown but not spoken.'
          : 'No speech voice is available on this device.',
      )
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = voice.lang
    window.speechSynthesis.speak(utterance)
  }, [])

  const ask = useCallback(
    (question: string, spoken: boolean) => {
      if (!data || !question.trim()) return
      const answer = answerQuestion(question, data)
      setTurns((previous) => [...previous, { question, answer }])
      setTerm('')
      if (spoken) speak(answer.text, detectLanguage(question))
    },
    [data, speak],
  )

  const startListening = useCallback(
    (language: 'en' | 'kn') => {
      const Ctor = recognitionCtor()
      if (!Ctor) {
        setVoiceNote('This browser does not support speech recognition. Type your question instead.')
        return
      }
      try {
        const instance = new Ctor()
        // A request, not a guarantee — the browser may ignore an unsupported
        // language and transcribe as something else, or fail to start at all.
        instance.lang = language === 'kn' ? 'kn-IN' : 'en-IN'
        instance.continuous = false
        instance.interimResults = false
        instance.onresult = (event) => {
          const transcript = event.results[0]?.[0]?.transcript ?? ''
          if (transcript) ask(transcript, true)
        }
        instance.onerror = () => {
          setListening(false)
          setVoiceNote(
            language === 'kn'
              ? 'Kannada speech recognition is not available on this device. Type your question instead.'
              : 'Speech recognition failed. Type your question instead.',
          )
        }
        instance.onend = () => setListening(false)
        recognition.current = instance
        setVoiceNote(null)
        setListening(true)
        instance.start()
      } catch {
        setListening(false)
        setVoiceNote('Speech recognition could not start. Type your question instead.')
      }
    },
    [ask],
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-5 right-5 z-[60] grid h-11 w-11 place-items-center rounded-full border shadow-lg"
        style={{ borderColor: 'var(--ink-500)', background: 'var(--ink-800)', color: 'var(--gold-400)' }}
        aria-label="Open the assistant"
        title="Assistant (⌘/)"
      >
        <Mic size={18} />
      </button>
    )
  }

  return (
    <aside
      className="no-print fixed bottom-5 right-5 z-[60] flex w-[min(420px,calc(100vw-40px))] flex-col rounded-[--r-lg] border shadow-2xl"
      style={{ borderColor: 'var(--ink-500)', background: 'var(--ink-800)', color: 'var(--txt)' }}
      aria-label="Assistant"
    >
      <header
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--ink-600)' }}
      >
        <div>
          <p className="type-micro" style={{ color: 'var(--gold-400)' }}>
            Assistant
          </p>
          <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {data ? `Answers from the station briefs · ${data.snapshotLabel}` : 'Loading…'}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="icon-button" aria-label="Close">
          <X size={14} />
        </button>
      </header>

      <div className="flex max-h-[320px] flex-col gap-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <p className="text-[12px] leading-5" style={{ color: 'var(--txt-3)' }}>
            Ask about a station — what is rising, the brief, oldest open cases, victims, or workload.
            Or across the city — what is expected next week, which stations are busiest, or compare two
            stations. Kannada questions are answered in Kannada. I answer only from the station briefs;
            anything outside them I will say I cannot answer.
          </p>
        ) : (
          turns.map((turn, index) => (
            <div key={index} className="flex flex-col gap-1">
              <p className="text-[12px]" style={{ color: 'var(--txt-3)' }}>
                {turn.question}
              </p>
              <div className="flex items-start gap-2">
                <p
                  className="flex-1 text-[13px] leading-5"
                  style={{ color: turn.answer.refused ? 'var(--txt-2)' : 'var(--txt-hi)' }}
                >
                  {turn.answer.text}
                </p>
                <button
                  type="button"
                  className="icon-button shrink-0"
                  aria-label="Read this answer aloud"
                  onClick={() => speak(turn.answer.text, detectLanguage(turn.question))}
                >
                  <Volume2 size={13} />
                </button>
              </div>
              {turn.answer.stationCode ? (
                <a
                  href={publicPath(`/station/?code=${encodeURIComponent(turn.answer.stationCode)}`)}
                  className="text-[11px] underline underline-offset-2"
                  style={{ color: 'var(--cyan-400)' }}
                >
                  Open the full brief
                </a>
              ) : null}
            </div>
          ))
        )}
        {voiceNote ? (
          <p className="text-[11px] leading-4" style={{ color: 'var(--warn)' }}>
            {voiceNote}
          </p>
        ) : null}
      </div>

      <form
        className="flex items-center gap-2 border-t p-2"
        style={{ borderColor: 'var(--ink-600)' }}
        onSubmit={(event) => {
          event.preventDefault()
          ask(term, false)
        }}
      >
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Ask about a station…"
          className="min-w-0 flex-1 rounded-[--r-sm] border bg-transparent px-2 py-1.5 text-[13px] outline-none"
          style={{ borderColor: 'var(--ink-600)', color: 'var(--txt)' }}
          disabled={!data}
        />
        {/*
          Only offered where the API exists. Where it does not, the field above
          is the whole feature rather than a mic that does nothing.
        */}
        {speechSupported ? (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={listening ? 'Stop listening' : 'Ask in English by voice'}
              title="Ask in English"
              onClick={() => (listening ? recognition.current?.stop() : startListening('en'))}
              disabled={!data}
              style={listening ? { borderColor: 'var(--critical)', color: 'var(--critical)' } : undefined}
            >
              {listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button
              type="button"
              className="icon-button font-kn"
              aria-label="Ask in Kannada by voice"
              title="ಕನ್ನಡದಲ್ಲಿ ಕೇಳಿ"
              onClick={() => startListening('kn')}
              disabled={!data || listening}
            >
              ಕ
            </button>
          </>
        ) : null}
        <button type="submit" className="icon-button" aria-label="Ask" disabled={!data}>
          <Send size={14} />
        </button>
      </form>
    </aside>
  )
}
