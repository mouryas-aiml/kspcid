'use client'

import { BookOpenText, ExternalLink, Search, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { OpsShell } from '@/components/shell/OpsShell'
import { publicPath } from '@/lib/publicPath'

interface ReviewAnswer {
  readonly id: 'chain' | 'pocso' | 'cyber' | 'roads'
  readonly prompt: string
  readonly shortPrompt: string
  readonly answer: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly (string | number)[])[]
  readonly sourcePage: string
  readonly extractPage: number
  readonly keywords: readonly string[]
}

const ANSWERS: readonly ReviewAnswer[] = [
  {
    id: 'chain',
    prompt: 'How did chain snatching change in December 2025?',
    shortPrompt: 'Chain snatching trend',
    answer:
      'Karnataka reported 42 chain-snatching cases in December 2025, up from 31 in November 2025 and 40 in December 2024. Total robbery registrations fell to 102 from 108 in November.',
    columns: ['Period', 'Chain snatching', 'Total robbery'],
    rows: [
      ['December 2025', 42, 102],
      ['November 2025', 31, 108],
      ['December 2024', 40, 91],
    ],
    sourcePage: 'December 2025 Crime Review · printed page 3',
    extractPage: 1,
    keywords: ['chain', 'snatching', 'robbery'],
  },
  {
    id: 'pocso',
    prompt: 'What were the statewide POCSO totals in December 2025?',
    shortPrompt: 'Statewide POCSO totals',
    answer:
      'The review reports 388 POCSO cases in December 2025, compared with 371 in November 2025 and 346 in December 2024.',
    columns: ['Period', 'POCSO cases'],
    rows: [
      ['December 2025', 388],
      ['November 2025', 371],
      ['December 2024', 346],
    ],
    sourcePage: 'December 2025 Crime Review · printed page 10',
    extractPage: 2,
    keywords: ['pocso', 'children', 'child'],
  },
  {
    id: 'cyber',
    prompt: 'How did cybercrime change in December 2025?',
    shortPrompt: 'Cybercrime trend',
    answer:
      'The review reports 1,286 cybercrime cases in December 2025. That is higher than November 2025 (1,186) and lower than December 2024 (1,525).',
    columns: ['Period', 'Cybercrime cases'],
    rows: [
      ['December 2025', '1,286'],
      ['November 2025', '1,186'],
      ['December 2024', '1,525'],
    ],
    sourcePage: 'December 2025 Crime Review · printed page 13',
    extractPage: 3,
    keywords: ['cyber', 'technology', 'online'],
  },
  {
    id: 'roads',
    prompt: 'What did the December 2025 road-accident review report?',
    shortPrompt: 'Road-accident summary',
    answer:
      'For December 2025, the review reports 4,026 road-accident cases: 1,004 fatal and 3,022 non-fatal. It records 1,010 people killed and 5,252 injured; national highways account for 322 deaths.',
    columns: ['Measure', 'Reported total'],
    rows: [
      ['Fatal cases', '1,004'],
      ['Non-fatal cases', '3,022'],
      ['People killed', '1,010'],
      ['People injured', '5,252'],
    ],
    sourcePage: 'December 2025 Crime Review · printed page 38',
    extractPage: 4,
    keywords: ['road', 'accident', 'fatal', 'killed', 'injured'],
  },
] as const

const DEFAULT_ANSWER = ANSWERS[0]!

function matchAnswer(query: string): ReviewAnswer | null {
  const normalized = query.toLowerCase()
  return (
    ANSWERS.find((answer) => answer.keywords.some((keyword) => normalized.includes(keyword))) ??
    null
  )
}

export function CrimeReviewDemo() {
  const [query, setQuery] = useState(DEFAULT_ANSWER.prompt)
  const [answer, setAnswer] = useState<ReviewAnswer | null>(DEFAULT_ANSWER)
  const [refused, setRefused] = useState(false)

  const ask = (value: string) => {
    const match = matchAnswer(value)
    setQuery(value)
    setAnswer(match)
    setRefused(!match)
  }

  return (
    <OpsShell
      title="Ask the Crime Review"
      eyebrow="VERIFIED DEMO"
      context={
        <div className="space-y-5 text-sm leading-6 text-[--txt-2]">
          <div>
            <p className="type-micro text-[--gold-400]">QuickML knowledge base</p>
            <p className="mt-2">
              Four official review pages are indexed in Catalyst QuickML. The demonstrated
              answers are independently checked against those pages.
            </p>
          </div>
          <div>
            <p className="type-micro text-[--txt-3]">Try a question</p>
            <div className="mt-2 flex flex-col gap-2">
              {ANSWERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => ask(item.prompt)}
                  className="rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-left text-xs text-[--txt-2] hover:border-[--gold-400] hover:text-[--txt-hi]"
                >
                  {item.shortPrompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      }
      inspector={
        <Panel title="What is live" eyebrow="DEMO SCOPE">
          <div className="space-y-3 text-sm leading-6 text-[--txt-2]">
            <p>
              Four documents are connected to Catalyst QuickML. Live GLM generation is unavailable
              in the project, so this screen uses a deterministic, page-cited fallback rather than
              presenting an untested model answer.
            </p>
            <div className="flex items-start gap-2 rounded-[--r-sm] border border-[--ink-500] p-3 text-xs">
              <ShieldCheck className="mt-0.5 shrink-0 text-[--cyan-400]" size={15} />
              <span>Unsupported questions are refused rather than answered from another dataset.</span>
            </div>
          </div>
        </Panel>
      }
    >
      <div className="h-full overflow-y-auto bg-[--ink-900] p-5 sm:p-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          <header>
            <p className="type-micro text-[--gold-400]">Official review, cited by page</p>
            <h1 className="mt-2 text-2xl font-semibold text-[--txt-hi]">Ask a verified question</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[--txt-2]">
              Answers below come only from the four included pages of the December 2025 review.
            </p>
          </header>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              ask(query)
            }}
          >
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-[--r-md] border border-[--ink-500] bg-[--ink-800] px-4 py-3">
              <Search className="shrink-0 text-[--txt-3]" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-[--txt-hi] outline-none"
                aria-label="Ask the Crime Review"
              />
            </label>
            <button
              type="submit"
              className="rounded-[--r-md] bg-[--gold-400] px-5 text-sm font-semibold text-[--ink-900]"
            >
              Ask
            </button>
          </form>

          {refused ? (
            <Panel title="Not supported by this demo" eyebrow="REFUSED">
              <p className="text-sm leading-6 text-[--txt-2]">
                This curated demo answers four verified questions only. Choose chain snatching,
                POCSO, cybercrime or road accidents. It will not construct an official-sounding
                answer without a checked page citation.
              </p>
            </Panel>
          ) : answer ? (
            <article className="rounded-[--r-lg] border border-[--ink-500] bg-[--ink-800] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="type-micro text-[--cyan-400]">Verified answer</p>
                <span className="inline-flex items-center gap-2 rounded-full border border-[--ink-500] px-3 py-1 text-[10px] text-[--txt-3]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[--cyan-400]" /> Official KSP review
                </span>
              </div>
              <p className="mt-4 text-base leading-7 text-[--txt-hi]">{answer.answer}</p>

              <div className="mt-5 overflow-hidden rounded-[--r-md] border border-[--ink-500]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[--ink-850] text-[--txt-3]">
                    <tr>
                      {answer.columns.map((column) => (
                        <th key={column} className="px-3 py-2 font-medium">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {answer.rows.map((row) => (
                      <tr key={String(row[0])} className="border-t border-[--ink-500] text-[--txt-2]">
                        {row.map((cell, index) => (
                          <td key={`${String(row[0])}-${index}`} className="px-3 py-2 tabular-nums">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <a
                href={publicPath(`/review/ksp-crime-review-december-2025-extracts.pdf#page=${answer.extractPage}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 text-xs text-[--cyan-400] underline underline-offset-4"
              >
                <BookOpenText size={15} /> {answer.sourcePage} <ExternalLink size={13} />
              </a>
            </article>
          ) : null}
        </div>
      </div>
    </OpsShell>
  )
}
