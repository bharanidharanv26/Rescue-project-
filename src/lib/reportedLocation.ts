import { LOCATIONS } from './locations'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const boundary = '[\\p{L}\\p{M}\\p{N}]'
// Consume grammatical endings, but never match a place inside another word.
const suffix = '(?:la|le|il|ula|இல்|ில்|யில்|வில்|யிலிருந்து|லில்|த்தில்|த்துல|த்தில|ிலிருந்து|ுக்கு|க்கு|்ல|்லே)?'
function aliasPattern(alias: string) {
  return new RegExp(`(?<!${boundary})${escape(alias)}${suffix}(?!${boundary})`, 'giu')
}
function mentions(text: string) {
  return LOCATIONS.flatMap((place) => place.aliases.flatMap((alias) => [...text.matchAll(aliasPattern(alias))].map((match) => ({ place, start: match.index, end: match.index + match[0].length }))))
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((item, index, all) => !all.slice(0, index).some((earlier) => earlier.start <= item.start && earlier.end >= item.end))
}

export function normalizePlace(text: string): string {
  let result = ''; let cursor = 0
  for (const match of mentions(text)) {
    if (match.start < cursor) continue
    result += text.slice(cursor, match.start) + match.place.name.split(',')[0]
    cursor = match.end
  }
  return (result + text.slice(cursor)).normalize('NFKC').toLowerCase()
    .replace(/\brd\b/g, 'road').replace(/\brly\b/g, 'railway')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

export function exactKnownLocation(query: string) {
  const normalized = normalizePlace(query)
  const matches = LOCATIONS.filter((place) => {
    const base = normalizePlace(place.name.split(',')[0])
    const variants = [normalizePlace(place.name), normalizePlace(`${place.name}, India`)]
    if (place.name.endsWith(', Chennai')) variants.push(`${base} chennai tamil nadu`, `${base} chennai tamil nadu india`, `chennai ${base}`, `chennai ${base} tamil nadu`)
    variants.push(base)
    return variants.includes(normalized)
  })
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  // Multiple places share the same neighbourhood name across cities; require city.
  const bases = new Set(matches.map((m) => normalizePlace(m.name.split(',')[0])))
  return bases.size === 1 ? null : matches[0]
}

export function coordinatesFrom(text: string): [number, number] | null {
  const match = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!match) return null
  const point: [number, number] = [Number(match[1]), Number(match[2])]
  return Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180 ? point : null
}

function cleanPhrase(value: string) {
  return value.replace(/\b(?:near|outside|opposite|at|in|the)\s+/gi, ', ')
    .replace(/\s+(?:la|le|pakathula|pakkathula|pagkatla|arugil|அருகில்|பக்கத்துல|பக்கத்தில்|அங்க|இங்க|எங்க)\b.*$/iu, '')
    .split(/\s+(?:(?:a|an|oru)\s+(?:accident|car|bike|bus|fire)|(?:road |bike |car |bus )?accident|collision|crash|has|have|is|are|where|there|we|my|they|and|with|after|two|three|four|five|one|\d+\s+(?:people|person|victim)|people|someone|please|விபத்து|தீ\s|மழையால்|மழை|வெள்ளம்|ரெண்டு|இரண்டு|நாலு|நான்கு|ஐந்து|ஒரு|நடந்த|ஆக்சிடென்ட்|rendu|moonu|naalu|anju|injured|flooding|flood|fire\b)/iu)[0]
    .replace(/^[\s,:;]+|[\s,:;.]+$/g, '').replace(/\s+/g, ' ').slice(0, 200)
}

/** Preserve the address phrase, including unknown landmarks and city qualifiers.
 * No coordinates or default city are invented here. */
export function extractReportedLocation(transcript: string): { location: string | null; knownLocationId: string | null } {
  // A clarification supersedes earlier place names instead of appending a second destination.
  const correction = [...transcript.matchAll(/\b(?:correction\s*:|actually\b|i mean\b)|திருத்தம்\s*:/gi)].at(-1)
  const text = (correction ? transcript.slice(correction.index! + correction[0].length) : transcript).trim()
  const coordinate = [...text.matchAll(/(?<![\d.])(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?!\d)/g)].at(-1)
  if (coordinate) return { location: `${coordinate[1]}, ${coordinate[2]}`, knownLocationId: null }

  // Keep abbreviations (T. Nagar) while separating sentences.
  const sentences = text.replace(/\bT\.\s*Nagar/gi, 'T Nagar').split(/[.!?;\n]+/)
  const candidates: { value: string; score: number; order: number }[] = []
  sentences.forEach((sentence, order) => {
    const cue = /\b(?:location\s*(?:is|:)|(?:accident|emergency|incident)\s+(?:is\s+|happened\s+)?(?:at|near|in)|at|near|outside|opposite|in|இல்|ில்|யில்|வில்|அங்க|இங்க|எங்க)\s+(?:the\s+)?/gi
    for (const match of sentence.matchAll(cue)) {
      if (/\b(?:not|isn't|wasn't)\s*$/i.test(sentence.slice(0, match.index))) continue
      const value = cleanPhrase(sentence.slice(match.index! + match[0].length))
      if (!value || /^(?:pain|danger|trouble|need|detail|help|a lot|an emergency|a rooftop|the water|hospital)$/i.test(value)) continue
      candidates.push({ value, score: /location|accident|emergency|incident/i.test(match[0]) ? 3 : 2, order })
    }
    // Postpositions are common in Tamil and Tanglish: "Porur pakkathula".
    const postposition = /\s+(?:la|le|pakathula|pakkathula|pagkatla|arugil|அருகில்|பக்கத்துல|பக்கத்தில்|இங்க|எங்க|அங்க)(?=\s|,|$)/iu.exec(sentence)
    if (postposition) {
      const prefix = sentence.slice(0, postposition.index).replace(/^.*?\b(?:at|near|in)\s+/i, '').replace(/^(?:நாங்க|நாங்கள்|இங்க|nanga|nangal|inga)\s+/i, '')
      const value = cleanPhrase(prefix)
      if (value && !/^(?:railway station|bus stop|hospital|ரயில்வே ஸ்டேஷன்)$/iu.test(value)) candidates.push({ value, score: 2, order })
    }
    const tamil = sentence.trim().match(/^([\p{Script=Tamil}\p{M}\s,]{2,120}?(?:யில்|வில்|த்தில்|ில்|இல்|ில்|அங்க|இங்க|எங்க))\s+(?=(?:விபத்து|சாலை|தீ|வெள்ளம்|புயல்|ஒரு|ஆக்சிடென்ட்|கட்டிடம்|நோய்|வலி|பக்கம்|பக்கத்தில்))/u)
    if (tamil) {
      const value = tamil[1].replace(/த்தில்$/, 'ம்').replace(/(?:யில்|வில்)$/, '').replace(/([கஙசஞடணதநபமயரலவழளறன])ில்$/, '$1்')
      candidates.push({ value, score: 2, order })
    }
  })
  candidates.sort((a, b) => b.score - a.score || b.order - a.order)
  let location: string | null = candidates[0]?.value ?? null
  if (!location) {
    // A locally recognised place is useful only within its spoken clause. Include
    // neighbouring city names so "Anna Nagar, Madurai" cannot become Chennai.
    const sentence = [...sentences].reverse().find((part) => mentions(part).length > 0)
    if (sentence) {
      const found = mentions(sentence).filter((item) => !/\bnot\s*$/i.test(sentence.slice(0, item.start)))
      if (found.length) {
        const first = found[0]; const last = found.at(-1)!
        const tail = sentence.slice(last.end).match(/^\s+(?:(?:railway|bus|metro)\s+(?:station|stand|stop)|(?:main\s+)?road|junction|hospital|ரயில்வே\s+ஸ்டேஷன்|பேருந்து\s+நிலையம்)/iu)?.[0] ?? ''
        location = sentence.slice(first.start, last.end) + tail
      }
    }
  }
  if (!location) return { location: null, knownLocationId: null }
  const known = exactKnownLocation(location)
  return { location: known?.name ?? location, knownLocationId: known?.id ?? null }
}
