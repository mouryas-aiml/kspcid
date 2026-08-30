/**
 * The assistant's language layer: a closed intent set over loaded fixtures.
 *
 * There is no model here, and that is deliberate. BUILD_SPEC §7.6 makes the
 * same call for `kv-explain` — "do not use an LLM at runtime here" — because a
 * deterministic template with computed slots is faster, cheaper and defensible,
 * and because an official-sounding wrong answer is worse than no answer. The
 * corpus-grounded LLM belongs in M9, gated on citations, and this is not that.
 *
 * So: match an intent, resolve it against the fixtures, fill a template. A
 * question outside the set is refused by name rather than guessed at.
 *
 * Bilingual means both directions. Kannada appears in the *input* patterns and
 * in station aliases, not only in the replies — an assistant that answers in
 * Kannada but only understands English is not bilingual, it is translated.
 */

export type Language = 'en' | 'kn'

export interface AssistantStation {
  readonly station_code: string
  readonly station_name: string
  readonly station_name_kn: string | null
  readonly police_division: string
  readonly three_things: readonly {
    readonly crime_head: string
    readonly registered: number
    readonly previous_registered: number
    readonly delta: number
  }[]
  readonly fastest_rising: {
    readonly crime_head: string
    readonly registered: number
    readonly previous_registered: number
  } | null
  readonly oldest_open_cases: readonly {
    readonly case_ref: string
    readonly crime_head: string
    readonly days_open: number
  }[]
  readonly workload: {
    readonly open_records: number
    readonly distinct_io_aliases: number
  } | null
  readonly victims: {
    readonly male: number
    readonly female: number
    readonly boy: number
    readonly girl: number
  } | null
  readonly forecast: {
    readonly next_week_start: string
    readonly low: number
    readonly expected: number
    readonly high: number
  } | null
  readonly staffing: {
    readonly open_records: number
    readonly sanctioned_strength: number
    readonly open_per_officer: number
  }
}

export interface AssistantData {
  readonly snapshotLabel: string
  readonly snapshotWeekStart: string
  readonly analysisCutoff: string
  readonly stationsAboveBand: number
  readonly stationsWithAlert: number
  readonly stationsEvaluated: number
  readonly stations: readonly AssistantStation[]
  readonly undetected: number | null
  readonly totalRecords: number | null
  readonly outlook: {
    readonly next_week_start: string
    readonly low: number
    readonly expected: number
    readonly high: number
  } | null
  readonly mostLoaded: readonly {
    readonly station_name: string
    readonly open_per_officer: number
  }[]
}

export interface AssistantAnswer {
  /** Rendered reply. Also what speech synthesis reads. */
  readonly text: string
  /** `null` for a general answer; set when the reply is about one station. */
  readonly stationCode: string | null
  /** True when the question fell outside the closed set. */
  readonly refused: boolean
}

/** Strip case, punctuation and spacing for comparison. Latin only. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9ಀ-೿]+/g, '')
}

/**
 * Kannada unit words. The stored label carries the full station name — for
 * example `ಬಾಣಸವಾಡಿ ಪೊಲೀಸ್ ಠಾಣೆ` — but a speaker naturally says only the place,
 * `ಬಾಣಸವಾಡಿ`. Matching on the full label alone therefore failed on every
 * natural Kannada question, so the bare place name is indexed as well.
 */
const KN_UNIT_WORDS = /(ಆರಕ್ಷಕ|ಪೊಲೀಸ್|ಪೋಲೀಸ್|ಪೋಲಿಸ್|ಪೊಲಿಸ್|ಠಾಣೆ|ಟಾಣೆ|ಸಂಚಾರ)/g

/** The same for English, so "Banaswadi PS" and "Banaswadi" both resolve. */
const EN_UNIT_WORDS = /\b(police station|police|station|ps)\b/gi

/**
 * Resolve a station from free text by English name, station code, or Kannada
 * label. Longest match wins so "Banaswadi Traffic" cannot be captured by a
 * shorter station whose name is a prefix of it.
 */
export function matchStation(
  input: string,
  stations: readonly AssistantStation[],
): AssistantStation | null {
  const folded = fold(input)
  let best: AssistantStation | null = null
  let bestLength = 0

  for (const station of stations) {
    const kn = station.station_name_kn ?? ''
    const candidates = [
      station.station_name,
      station.station_name.replace(EN_UNIT_WORDS, ' '),
      station.station_code,
      kn,
      kn.replace(KN_UNIT_WORDS, ' '),
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      const key = fold(candidate)
      if (key.length < 3 || !folded.includes(key)) continue
      if (key.length > bestLength) {
        best = station
        bestLength = key.length
      }
    }
  }
  return best
}

/**
 * Resolve up to two stations from one question, for a comparison.
 *
 * `matchStation` returns a single best match, so it cannot answer "compare
 * Banaswadi and Hennur". This splits on the joining word first and matches each
 * side, which also stops the longer of the two names from swallowing the other.
 */
export function matchTwoStations(
  input: string,
  stations: readonly AssistantStation[],
): readonly AssistantStation[] {
  const parts = input.split(/\b(?:and|versus|vs\.?|against|with)\b|,|\band\b|ಮತ್ತು/i)
  const found: AssistantStation[] = []
  for (const part of parts) {
    const match = matchStation(part, stations)
    if (match && !found.some((entry) => entry.station_code === match.station_code)) found.push(match)
  }
  return found.slice(0, 2)
}

type IntentId =
  | 'rising'
  | 'brief'
  | 'oldest'
  | 'victims'
  | 'workload'
  | 'undetected'
  | 'exceedances'
  | 'forecast'
  | 'compare'
  | 'busiest'
  | 'help'

interface IntentPattern {
  readonly id: IntentId
  /** Matched against the raw question in both scripts. */
  readonly patterns: readonly RegExp[]
}

/**
 * Kannada input patterns sit beside the English ones rather than in a separate
 * table, so an intent cannot be added in one language and silently missing in
 * the other.
 */
const INTENTS: readonly IntentPattern[] = [
  // Forward-looking and cross-station questions are matched first. "Is theft
  // going up next week" contains a `rising` keyword and a `forecast` keyword;
  // the forward-looking reading is the one the asker meant.
  {
    id: 'forecast',
    patterns: [
      /\b(next week|expect(ed|ing)?|forecast|outlook|predict(ion|ed)?|coming week|how many will)\b/i,
      /(ಮುಂದಿನ ವಾರ|ನಿರೀಕ್ಷ|ಮುನ್ಸೂಚನೆ)/,
    ],
  },
  {
    id: 'compare',
    patterns: [/\b(compare|versus|vs\.?|against|difference between)\b/i, /(ಹೋಲಿಸ|ಹೋಲಿಕೆ)/],
  },
  {
    id: 'busiest',
    patterns: [
      /\b(which stations?|worst|busiest|most loaded|highest|top \d*\s*stations?|under pressure|overloaded)\b/i,
      /(ಯಾವ ಠಾಣೆ|ಅತಿ ಹೆಚ್ಚು|ಹೆಚ್ಚು ಹೊರೆ)/,
    ],
  },
  {
    id: 'rising',
    patterns: [
      /\b(rising|going up|increase[ds]?|increasing|spik(e|ing)|trend(ing)?|what.s up)\b/i,
      /(ಹೆಚ್ಚ|ಏರಿಕೆ|ಏರುತ್ತ)/,
    ],
  },
  {
    id: 'brief',
    patterns: [
      /\b(brief|summary|summar(y|ise|ize)|report|read me|overview of)\b/i,
      /(ಸಾರಾಂಶ|ವರದಿ|ಬ್ರೀಫ್)/,
    ],
  },
  {
    id: 'oldest',
    patterns: [
      /\b(oldest|longest|pending|open case|stale|unresolved)\b/i,
      /(ಹಳೆಯ|ಬಾಕಿ|ಇತ್ಯರ್ಥವಾಗದ)/,
    ],
  },
  {
    id: 'victims',
    patterns: [/\bvictims?\b/i, /(ಸಂತ್ರಸ್ತ|ಬಲಿಪಶು)/],
  },
  {
    id: 'workload',
    patterns: [
      /\b(workload|caseload|how busy|officers?|investigating officer|io\b)/i,
      /(ಕೆಲಸದ ಹೊರೆ|ಅಧಿಕಾರಿ)/,
    ],
  },
  {
    id: 'undetected',
    patterns: [
      /\b(undetected|not detected|unsolved|detection)\b/i,
      /(ಪತ್ತೆಯಾಗದ|ಪತ್ತೆ ಆಗದ)/,
    ],
  },
  {
    id: 'exceedances',
    patterns: [
      /\b(above|exceed(ed|ing)?|expected (range|band)|out of range|how many stations)\b/i,
      /(ನಿರೀಕ್ಷಿತ|ಮೀರಿ)/,
    ],
  },
  {
    id: 'help',
    patterns: [/\b(help|what can you|how do i|commands?)\b/i, /(ಸಹಾಯ|ಏನು ಮಾಡಬಹುದು)/],
  },
]

function detectIntent(question: string): IntentId | null {
  for (const intent of INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(question))) return intent.id
  }
  return null
}

/** Detect the reply language from the script the question was asked in. */
export function detectLanguage(question: string): Language {
  return /[ಀ-೿]/.test(question) ? 'kn' : 'en'
}

const HELP_EN =
  'I answer from the station briefs. Try: what is rising in Banaswadi · read me the brief for Rajaji ' +
  'Nagar · how many FIRs are expected next week · which stations are busiest · compare Banaswadi and ' +
  'Hennur · oldest open cases in Hennur · victims in Jayanagar · how many cases are undetected.'

const HELP_KN =
  'ಠಾಣೆ ವರದಿಗಳಿಂದ ನಾನು ಉತ್ತರಿಸಬಲ್ಲೆ. ಉದಾಹರಣೆಗೆ: ಬಾಣಸವಾಡಿಯಲ್ಲಿ ಏನು ಹೆಚ್ಚಾಗಿದೆ · ರಾಜಾಜಿನಗರದ ಸಾರಾಂಶ · ' +
  'ಮುಂದಿನ ವಾರ ಎಷ್ಟು ಎಫ್‌ಐಆರ್ ನಿರೀಕ್ಷೆ · ಯಾವ ಠಾಣೆಗಳಲ್ಲಿ ಹೆಚ್ಚು ಹೊರೆ · ಹೆಣ್ಣೂರಿನ ಹಳೆಯ ಪ್ರಕರಣಗಳು · ' +
  'ಎಷ್ಟು ಪ್ರಕರಣಗಳು ಪತ್ತೆಯಾಗಿಲ್ಲ.'

/** Indian digit grouping, matching the brief pages. */
const group = (value: number): string => value.toLocaleString('en-IN')

function stationLabel(station: AssistantStation, language: Language): string {
  return language === 'kn' && station.station_name_kn
    ? station.station_name_kn
    : station.station_name
}

/**
 * Answer a question, or refuse it.
 *
 * Every reply names the snapshot week. The source ends in 2023 and the product
 * is used long after, so an answer that omits the date invites the listener to
 * assume it is current — which is exactly the failure the on-screen date
 * labelling elsewhere is designed to prevent.
 */
export function answerQuestion(question: string, data: AssistantData): AssistantAnswer {
  const language = detectLanguage(question)
  const trimmed = question.trim()

  if (!trimmed) {
    return { text: language === 'kn' ? HELP_KN : HELP_EN, stationCode: null, refused: false }
  }

  const intent = detectIntent(trimmed)
  const station = matchStation(trimmed, data.stations)
  const week = data.snapshotLabel

  if (intent === 'help' || (!intent && !station)) {
    // Refuse by name rather than guess. §7.9's guardrail: never extrapolate an
    // official-sounding claim the data does not support.
    const refusal =
      language === 'kn'
        ? `ಕ್ಷಮಿಸಿ, ಆ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಲು ನನ್ನ ಬಳಿ ದತ್ತಾಂಶವಿಲ್ಲ. ${HELP_KN}`
        : `I cannot answer that from the station briefs. ${HELP_EN}`
    return { text: intent === 'help' ? (language === 'kn' ? HELP_KN : HELP_EN) : refusal, stationCode: null, refused: intent !== 'help' }
  }

  // ---- questions that need no station -------------------------------------
  if (intent === 'undetected') {
    if (data.undetected === null || data.totalRecords === null) {
      return {
        text:
          language === 'kn'
            ? 'ಪತ್ತೆಯಾಗದ ಪ್ರಕರಣಗಳ ಸಂಖ್ಯೆ ಲಭ್ಯವಿಲ್ಲ.'
            : 'The undetected figure is not available.',
        stationCode: null,
        refused: false,
      }
    }
    const share = ((data.undetected / data.totalRecords) * 100).toFixed(1)
    return {
      text:
        language === 'kn'
          ? `${data.analysisCutoff} ರವರೆಗೆ ${group(data.undetected)} ಪ್ರಕರಣಗಳು ಪತ್ತೆಯಾಗಿಲ್ಲ — ಒಟ್ಟು ${group(data.totalRecords)} ದಾಖಲೆಗಳ ಶೇಕಡಾ ${share}.`
          : `${group(data.undetected)} records are undetected, ${share} per cent of ${group(data.totalRecords)} records registered up to ${data.analysisCutoff}.`,
      stationCode: null,
      refused: false,
    }
  }

  // Which stations are carrying the most. Needs no station named.
  if (intent === 'busiest' && !station) {
    const top = data.mostLoaded.slice(0, 5)
    if (top.length === 0) {
      return {
        text: language === 'kn' ? 'ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ.' : 'That is not available.',
        stationCode: null,
        refused: false,
      }
    }
    const list = top.map((row) => `${row.station_name} (${row.open_per_officer})`).join(', ')
    return {
      text:
        language === 'kn'
          ? `ಪ್ರತಿ ಅಧಿಕಾರಿಗೆ ಅತಿ ಹೆಚ್ಚು ಬಾಕಿ ಪ್ರಕರಣಗಳಿರುವ ಠಾಣೆಗಳು: ${list}. ಅಧಿಕಾರಿಗಳ ಸಂಖ್ಯೆ ಪ್ರಾತ್ಯಕ್ಷಿಕೆಗಾಗಿ ರಚಿಸಲಾಗಿದೆ.`
          : `Open cases per officer are highest at: ${list}. Officer strength is illustrative, so read this as a worked example rather than a staffing measure.`,
      stationCode: null,
      refused: false,
    }
  }

  // City-wide outlook when no station is named.
  if (intent === 'forecast' && !station) {
    if (!data.outlook) {
      return {
        text:
          language === 'kn' ? 'ಮುಂದಿನ ವಾರದ ಅಂದಾಜು ಲಭ್ಯವಿಲ್ಲ.' : 'No outlook is available.',
        stationCode: null,
        refused: false,
      }
    }
    return {
      text:
        language === 'kn'
          ? `${data.outlook.next_week_start} ವಾರದಲ್ಲಿ 106 ಠಾಣೆಗಳಲ್ಲಿ ಸುಮಾರು ${group(Math.round(data.outlook.expected))} ಎಫ್‌ಐಆರ್ ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ — ${group(data.outlook.low)} ರಿಂದ ${group(data.outlook.high)} ರ ನಡುವೆ. ಇದು ಕೆಲಸದ ಪ್ರಮಾಣದ ಅಂದಾಜು, ಅಪರಾಧದ ಭವಿಷ್ಯವಾಣಿ ಅಲ್ಲ.`
          : `Across the 106 stations, about ${group(Math.round(data.outlook.expected))} FIRs are likely to be registered in the week beginning ${data.outlook.next_week_start} — somewhere between ${group(data.outlook.low)} and ${group(data.outlook.high)}. That is expected workload, not a prediction of crime.`,
      stationCode: null,
      refused: false,
    }
  }

  // Comparison needs two stations, so it is resolved before the single-station
  // fallback below claims the one station it happened to find.
  if (intent === 'compare') {
    const pair = matchTwoStations(trimmed, data.stations)
    if (pair.length < 2) {
      return {
        text:
          language === 'kn'
            ? 'ಹೋಲಿಸಲು ಎರಡು ಠಾಣೆಗಳ ಹೆಸರು ಹೇಳಿ.'
            : 'Name two stations to compare, for example “compare Banaswadi and Hennur”.',
        stationCode: null,
        refused: true,
      }
    }
    const [left, right] = pair as [AssistantStation, AssistantStation]
    const load = (entry: AssistantStation) => entry.staffing.open_per_officer
    const open = (entry: AssistantStation) => entry.staffing.open_records
    const busier = load(left) >= load(right) ? left : right
    return {
      text:
        language === 'kn'
          ? `${stationLabel(left, language)}: ${group(open(left))} ಬಾಕಿ ಪ್ರಕರಣಗಳು, ಪ್ರತಿ ಅಧಿಕಾರಿಗೆ ${load(left)}. ${stationLabel(right, language)}: ${group(open(right))}, ಪ್ರತಿ ಅಧಿಕಾರಿಗೆ ${load(right)}. ${stationLabel(busier, language)} ಹೆಚ್ಚು ಹೊರೆ ಹೊಂದಿದೆ.`
          : `${left.station_name} has ${group(open(left))} open cases, ${load(left)} per officer. ${right.station_name} has ${group(open(right))}, ${load(right)} per officer. ${busier.station_name} is carrying more. Officer strength is illustrative.`,
      stationCode: busier.station_code,
      refused: false,
    }
  }

  if (intent === 'exceedances' && !station) {
    return {
      text:
        language === 'kn'
          ? `${week} ರಂದು ${data.stationsEvaluated} ಠಾಣೆಗಳಲ್ಲಿ ${data.stationsAboveBand} ಠಾಣೆಗಳು ನಿರೀಕ್ಷಿತ ವ್ಯಾಪ್ತಿಯನ್ನು ಮೀರಿವೆ.`
          : `${data.stationsAboveBand} of ${data.stationsEvaluated} stations exceeded their historical expected range in the snapshot week, ${week}.`,
      stationCode: null,
      refused: false,
    }
  }

  if (!station) {
    return {
      text:
        language === 'kn'
          ? `ಯಾವ ಠಾಣೆ ಎಂದು ತಿಳಿಯಲಿಲ್ಲ. ಠಾಣೆಯ ಹೆಸರನ್ನು ಹೇಳಿ.`
          : 'I could not tell which station you mean. Name the station, for example “what is rising in Banaswadi”.',
      stationCode: null,
      refused: true,
    }
  }

  const name = stationLabel(station, language)

  switch (intent) {
    case 'rising': {
      if (!station.fastest_rising) {
        return {
          text:
            language === 'kn'
              ? `${week} ರಂದು ${name} ನಲ್ಲಿ ಯಾವುದೇ ವರ್ಗ ಏರಿಕೆ ಕಂಡಿಲ್ಲ.`
              : `No crime head rose at ${name} in the snapshot week, ${week}.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      const rise = station.fastest_rising
      return {
        text:
          language === 'kn'
            ? `${week} ರಂದು ${name} ನಲ್ಲಿ ${rise.crime_head} ಅತಿ ಹೆಚ್ಚು ಏರಿಕೆ ಕಂಡಿದೆ — ${group(rise.registered)} ಎಫ್‌ಐಆರ್ ದಾಖಲಾಗಿವೆ, ಹಿಂದಿನ ವಾರ ${group(rise.previous_registered)}.`
            : `At ${name}, the fastest-rising category in the snapshot week, ${week}, was ${rise.crime_head}: ${group(rise.registered)} FIRs registered against ${group(rise.previous_registered)} the week before.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'brief': {
      const items = station.three_things
      if (items.length === 0) {
        return {
          text:
            language === 'kn'
              ? `${week} ರಂದು ${name} ನಲ್ಲಿ ಯಾವುದೇ ಬದಲಾವಣೆ ದಾಖಲಾಗಿಲ್ಲ.`
              : `Nothing changed at ${name} in the snapshot week, ${week}.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      const sentences = items.map(
        (item) =>
          `${item.crime_head}: ${group(item.registered)} against ${group(item.previous_registered)}`,
      )
      return {
        text:
          language === 'kn'
            ? `${name} — ${week}. ${items.map((item) => `${item.crime_head}: ${group(item.registered)}, ಹಿಂದಿನ ವಾರ ${group(item.previous_registered)}`).join('. ')}.`
            : `${name}, snapshot week ${week}. The three largest changes in FIRs registered were ${sentences.join('; ')}.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'oldest': {
      const oldest = station.oldest_open_cases[0]
      if (!oldest) {
        return {
          text:
            language === 'kn'
              ? `${name} ನಲ್ಲಿ ಬಾಕಿ ಪ್ರಕರಣಗಳಿಲ್ಲ.`
              : `${name} has no records in an open stage.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      return {
        text:
          language === 'kn'
            ? `${name} ನ ಅತ್ಯಂತ ಹಳೆಯ ಬಾಕಿ ಪ್ರಕರಣ ${oldest.crime_head} — ${group(oldest.days_open)} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ. ಒಟ್ಟು ${station.oldest_open_cases.length} ತೋರಿಸಲಾಗಿದೆ.`
            : `The oldest open record at ${name} is a ${oldest.crime_head} case, open ${group(oldest.days_open)} days as at ${data.analysisCutoff}.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'victims': {
      if (!station.victims) {
        return {
          text:
            language === 'kn'
              ? `${week} ರಂದು ${name} ನಲ್ಲಿ ಸಂತ್ರಸ್ತರ ಸಂಖ್ಯೆ ದಾಖಲಾಗಿಲ್ಲ.`
              : `No victim counts were recorded at ${name} in the snapshot week.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      const { male, female, boy, girl } = station.victims
      return {
        text:
          language === 'kn'
            ? `${name}, ${week}: ಪುರುಷ ${group(male)}, ಮಹಿಳೆ ${group(female)}, ಬಾಲಕ ${group(boy)}, ಬಾಲಕಿ ${group(girl)}.`
            : `At ${name} in the snapshot week, ${week}: ${group(male)} male, ${group(female)} female, ${group(boy)} boy and ${group(girl)} girl victims. The source carries these four categories only.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'workload': {
      if (!station.workload) {
        return {
          text:
            language === 'kn'
              ? `${name} ನಲ್ಲಿ ಬಾಕಿ ದಾಖಲೆಗಳಿಲ್ಲ.`
              : `${name} has no records in an open stage.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      const { open_records, distinct_io_aliases } = station.workload
      return {
        text:
          language === 'kn'
            ? `${name} ನಲ್ಲಿ ${group(open_records)} ಬಾಕಿ ದಾಖಲೆಗಳು ಮತ್ತು ${group(distinct_io_aliases)} ತನಿಖಾಧಿಕಾರಿ ಗುರುತುಗಳಿವೆ. ಇದು ಕೆಲಸದ ಹೊರೆಯ ಅಂದಾಜು ಮಾತ್ರ, ನಿಯೋಜನೆಯ ಪುರಾವೆ ಅಲ್ಲ.`
            : `${name} has ${group(open_records)} open records with ${group(distinct_io_aliases)} distinct investigating-officer aliases appearing on them, as at ${data.analysisCutoff}. That is a workload proxy, not evidence of posting or of sanctioned strength.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'forecast': {
      if (!station.forecast) {
        return {
          text:
            language === 'kn'
              ? `${name} ಗೆ ಮುಂದಿನ ವಾರದ ಅಂದಾಜು ನೀಡಲು ಸಾಕಷ್ಟು ಹಿಂದಿನ ದತ್ತಾಂಶವಿಲ್ಲ.`
              : `There is not enough history at ${name} to give an outlook.`,
          stationCode: station.station_code,
          refused: false,
        }
      }
      const outlook = station.forecast
      return {
        text:
          language === 'kn'
            ? `${name} ನಲ್ಲಿ ${outlook.next_week_start} ವಾರದಲ್ಲಿ ಸುಮಾರು ${outlook.expected} ಎಫ್‌ಐಆರ್ ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ — ${outlook.low} ರಿಂದ ${outlook.high} ರ ನಡುವೆ. ಇದು ಕೆಲಸದ ಅಂದಾಜು, ಅಪರಾಧದ ಭವಿಷ್ಯವಾಣಿ ಅಲ್ಲ.`
            : `At ${name}, about ${outlook.expected} FIRs are likely in the week beginning ${outlook.next_week_start} — between ${outlook.low} and ${outlook.high}. That is expected workload, not a prediction of crime.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'busiest': {
      // A station was named alongside a "which is worst" phrasing, so answer
      // for that station's position rather than the city list.
      return {
        text:
          language === 'kn'
            ? `${name} ನಲ್ಲಿ ${group(station.staffing.open_records)} ಬಾಕಿ ಪ್ರಕರಣಗಳಿವೆ, ಪ್ರತಿ ಅಧಿಕಾರಿಗೆ ${station.staffing.open_per_officer}.`
            : `${name} has ${group(station.staffing.open_records)} open cases, ${station.staffing.open_per_officer} per officer. Officer strength is illustrative.`,
        stationCode: station.station_code,
        refused: false,
      }
    }

    case 'exceedances':
    default: {
      // A station was named but the intent was not in the set.
      return {
        text:
          language === 'kn'
            ? `${name} ಬಗ್ಗೆ ಆ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಲಾಗುವುದಿಲ್ಲ. ${HELP_KN}`
            : `I cannot answer that about ${name} from the station briefs. ${HELP_EN}`,
        stationCode: station.station_code,
        refused: true,
      }
    }
  }
}
