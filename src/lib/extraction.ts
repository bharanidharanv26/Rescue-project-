import { extractReportedLocation } from './reportedLocation'
import type { Category, EmergencyDetails, Language } from './types'

const categories: { category: Category; pattern: RegExp }[] = [
  { category: 'Cyclone', pattern: /cyclone|hurricane|tornado|typhoon|புயல்|puyal|sooravali/i },
  { category: 'Flood', pattern: /flood|drown|waterlogged|rising water|வெள்ள|மூழ்க|vellam|thanni.+(?:suzh|nirai|veet)|thanneer.+(?:suzh|nirai)/i },
  { category: 'Fire', pattern: /\bfire\b|burning|blaze|smoke|explosion|தீ\s|தீப்ப|எரிகி|புகை|நெருப்பு|neruppu|thee\s|eriyuthu|pugai/i },
  { category: 'Road accident', pattern: /accident|collision|crash|hit.+(?:car|bike|bus|truck)|(?:car|bike|bus|truck).+hit|விபத்து|ஆக்சிடென்ட்|மோத|vipathu|modhi|mothi/i },
  { category: 'Other disaster', pattern: /earthquake|landslide|building.+collaps|roof.+collaps|disaster|chemical leak|gas leak|நிலநடுக்க|இடிந்து|நிலச்சரிவு|idinthu|idinj|collapse/i },
  { category: 'Medical emergency', pattern: /heart|chest|breath|unconscious|faint|seizure|stroke|pregnan|bleed|pain|injur|sick|medical|allerg|overdose|poison|மயக்க|மூச்சு|நெஞ்சு|வலி|ரத்த|இரத்த|வலிப்பு|கர்ப்ப|mooch|mayakk|nenju|vali|rath[at]m/i },
]

const conditions: { label: string; pattern: RegExp; negative?: RegExp; critical?: boolean }[] = [
  { label: 'Not breathing', pattern: /not breathing|isn.t breathing|stopped breathing|no breath|மூச்சு இல்லை|மூச்சு விடவில்லை|moochu (?:illa|varala)/i, critical: true },
  { label: 'Unconscious', pattern: /unconscious|unresponsive|passed out|மயக்க|சுயநினைவின்றி|mayakk/i, negative: /not unconscious|no one (?:is )?unconscious|nobody (?:is )?unconscious/i, critical: true },
  { label: 'Heavy bleeding', pattern: /heavy bleeding|bleeding (?:heavily|badly|a lot)|severe bleeding|losing.+blood|அதிக.+(?:ரத்த|இரத்த)|(?:ரத்த|இரத்த).+அதிக|(?:ratham|raththam|blood).+(?:n[ae]r[ai]ya|adhig)|(?:n[ae]r[ai]ya|adhig).+(?:ratham|raththam|blood)/i, critical: true },
  { label: 'Bleeding', pattern: /bleed|ரத்த|இரத்த|ratham|raththam/i, negative: /(?:no|not|isn.t) bleeding|without bleeding|ரத்தம் இல்லை|ratham illa/i },
  { label: 'Breathing difficulty', pattern: /(?:difficulty|trouble|struggling|hard).+breath|breath.+(?:difficulty|problem)|shortness of breath|மூச்சு.+(?:திணற|சிரம)|மூச்சுத்திணற|mooch.+(?:kasht|kast|thinar)/i, critical: true },
  { label: 'Chest pain', pattern: /chest pain|heart attack|cardiac|நெஞ்சு வலி|நெஞ்சுவலி|மாரடைப்பு|nenju\s?vali/i, negative: /no chest pain|without chest pain/i, critical: true },
  { label: 'Possible fracture', pattern: /fracture|broken (?:leg|arm|bone|hip)|எலும்பு|கால் முறி|kai odanj|kaal odanj/i },
  { label: 'Burn injuries', pattern: /burn(?:s|t|ed| injuries)|தீக்காய|thee\s?kaayam/i },
  { label: 'Trapped', pattern: /trapped|stuck|சிக்கி|மாட்டி|sikki|maati|matti/i },
  { label: 'Smoke inhalation', pattern: /smoke inhalation|inhal.+smoke|புகை.+சுவாச|pugai.+mooch/i },
  { label: 'Seizure', pattern: /seizure|convulsion|வலிப்பு|valippu/i, critical: true },
  { label: 'Possible stroke', pattern: /stroke|face.+droop|பக்கவாத/i, critical: true },
  { label: 'Conscious', pattern: /\bconscious\b|awake|விழிப்புடன்|ninaivu irukku/i, negative: /not conscious|isn.t conscious/i },
  { label: 'Minor injuries', pattern: /minor injur|small (?:cut|scrape)|சிறிய காய|chinna kaayam/i },
  { label: 'Oxygen required', pattern: /oxygen|ஆக்சிஜன்|ஆக்சிசன்|aaksijan|oksijan/i, negative: /(?:no|not need|doesn.t need) oxygen|oxygen (?:not needed|venam|vendam)/i },
  { label: 'Injured', pattern: /\binjur(?:ed|ies|y)\b|\bhurt\b|காயமடை|காயம்|அடி|செம அடி|kaayam/i, negative: /no (?:one (?:is )?(?:hurt|injured)|injuries)|nobody (?:is )?(?:hurt|injured)|not injured|காயம் இல்லை|kaayam illa/i },
]

const numbers: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
  ஒரு: 1, ஒருவர்: 1, ஒன்று: 1, இரண்டு: 2, இரு: 2, இருவர்: 2, மூன்று: 3, மூவர்: 3, நான்கு: 4, ஐந்து: 5,
  ஆறு: 6, ஏழு: 7, எட்டு: 8, ஒன்பது: 9, பத்து: 10, இருபது: 20, நாலு: 4,
  oru: 1, onnu: 1, rendu: 2, irandu: 2, moonu: 3, moondru: 3, naalu: 4, anju: 5, aindhu: 5, aaru: 6, pathu: 10,
}
const numberPattern = Object.keys(numbers).sort((a, b) => b.length - a.length).join('|')
const peoplePattern = 'people|persons?|victims?|patients?|passengers?|injured|hurt|children|kids|men|women|adults?|person|man|woman|பேர்|பேரு|நபர்|பேருக்கு|பேர்கள்|peru|per|people|p[ae]er(?:u)?'

function extractVictims(text: string): number | null {
  const normalized = text.replace(/[௦-௯]/g, (digit) => String(digit.charCodeAt(0) - '௦'.charCodeAt(0)))
  const explicit = new RegExp(`(?:^|[\\s,:;])(${numberPattern}|\\d+)\\s+(?:of us\\s+(?:are\\s+)?)?(?:${peoplePattern})`, 'gi')
  const found = [...normalized.matchAll(explicit)].map((match) => numbers[match[1].toLowerCase()] ?? Number(match[1]))
  if (found.length) return Math.min(10000, Math.max(...found.filter(Number.isFinite)))
  if (/no (?:one (?:is )?(?:hurt|injured)|injuries|victims)|யாருக்கும் காயம் இல்லை/i.test(normalized)) return 0
  const tamilPeople = normalized.match(/(ஒருவர்|இருவர்|மூவர்)(?:\s|க்கு|காய|சிக்க)/)
  if (tamilPeople) return numbers[tamilPeople[1]]
  const spokenTamilPeople = normalized.match(/(ஒரு|ரெண்டு|மூணு|நாலு|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து)\s*பேர(?:்|ு|க்கு|்க்கு)?/i)
  if (spokenTamilPeople) {
    const value = numbers[spokenTamilPeople[1]]
    if (value) return value
  }
  if (/my (?:father|mother|dad|mom|wife|husband|son|daughter|friend)|i (?:am|'m) (?:hurt|injured|having)|என் (?:அப்பா|அம்மா|மகன்|மகள்)|enga (?:appa|amma)|en (?:appa|amma)/i.test(text)) return 1
  return null
}

export function extractContact(transcript: string): string | null {
  let text = transcript.toLowerCase().replace(/[௦-௯]/g, (digit) => String(digit.charCodeAt(0) - '௦'.charCodeAt(0)))
  const spoken: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', பூஜ்ஜியம்: '0', ஒன்று: '1', இரண்டு: '2', மூன்று: '3', நான்கு: '4', ஐந்து: '5', ஆறு: '6', ஏழு: '7', எட்டு: '8', ஒன்பது: '9', onnu: '1', rendu: '2', moonu: '3', naalu: '4', anju: '5', aaru: '6', ezhu: '7', ettu: '8', onbadhu: '9' }
  // Convert spoken digits only after a caller/contact cue, not victim counts.
  const cue = /(?:my (?:phone|mobile|contact|number)|call me (?:at|on)|phone number|contact number|mobile number|என் (?:தொலைபேசி|கைபேசி|நம்பர்)|தொடர்பு எண்|en (?:phone|number|mobile)|ennoda (?:number|phone)|contact)\s*(?:number|எண்|is|:)?\s*/i.exec(text)
  if (cue) {
    const start = cue.index + cue[0].length
    const tail = text.slice(start, start + 240).split(/[.!?\n]/)[0]
    const converted = tail.split(/[\s,-]+/).map((word) => spoken[word] ?? word).join(' ')
    text = text.slice(0, start) + converted + text.slice(start + tail.length)
  }
  for (const match of text.matchAll(/(?<!\d)(?:\+\s*)?\d(?:[\s()-]*\d){9,14}(?!\d)/g)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length === 10) return digits
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
    if (match[0].trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`
  }
  return null
}

function extractUnconscious(text: string, present: boolean, victims: number | null): number | null {
  if (!present) return /no one.{0,12}unconscious|nobody.{0,8}unconscious|all (?:are )?conscious|யாரும் மயக்கத்தில் இல்லை/i.test(text) ? 0 : null
  const pattern = new RegExp(`(?:^|[\\s,.])(${numberPattern}|\\d+)\\s*(?:(?:${peoplePattern})\\s*)?(?:is\\s+|are\\s+|person\\s+|பேர்\\s*|பேரு\\s*)?(?:unconscious|unresponsive|passed out|மயக்க|mayakk)`, 'i')
  const match = text.match(pattern)
  if (match) return numbers[match[1]] ?? Number(match[1])
  if (victims === 1 || /(?:one of them|one person|ஒருவர்|oru person).{0,20}(?:unconscious|மயக்க|mayakk)/i.test(text)) return 1
  return null
}

function isNegated(text: string, pattern: RegExp) {
  const match = pattern.exec(text)
  if (!match || match.index === undefined) return false
  return /(?:no|not|without|isn.t|wasn.t)\s+(?:a\s+|any\s+)?$/i.test(text.slice(Math.max(0, match.index - 22), match.index))
}

export function extractEmergency(transcript: string): EmergencyDetails {
  const text = transcript.toLowerCase().replace(/\s+/g, ' ').trim()
  const { location, knownLocationId } = extractReportedLocation(transcript)
  const category = categories.find((item) => item.pattern.test(text) && !isNegated(text, item.pattern))?.category ?? 'Unclassified'
  const matchedConditions = conditions.filter((item) => item.pattern.test(text) && !item.negative?.test(text) && !isNegated(text, item.pattern))
  let conditionLabels = matchedConditions.map((item) => item.label)
  if (conditionLabels.includes('Heavy bleeding')) conditionLabels = conditionLabels.filter((label) => label !== 'Bleeding')
  if (conditionLabels.includes('Unconscious')) conditionLabels = conditionLabels.filter((label) => label !== 'Conscious')
  const victims = extractVictims(text)
  const unconscious = extractUnconscious(text, conditionLabels.includes('Unconscious'), victims)
  const critical = matchedConditions.some((item) => item.critical) || /(?:very serious|life threatening|critical condition|உயிருக்கு ஆபத்து)/i.test(text)
  const dangerous = ['Flood', 'Cyclone', 'Fire', 'Other disaster'].includes(category) || conditionLabels.includes('Trapped') || (victims ?? 0) >= 5
  const severity = critical ? 'Critical' : dangerous ? 'High' : category !== 'Unclassified' || conditionLabels.length ? 'Moderate' : 'Undetermined'
  const notes: string[] = []
  if (/child|children|kid|baby|குழந்தை|kuzhanthai|kulanthai/i.test(text)) notes.push('Children involved')
  if (/elderly|senior|old (?:man|woman)|வயதான|முதிய|vayasaana/i.test(text)) notes.push('Older adult involved')
  if (/pregnan|கர்ப்ப|garbam/i.test(text)) notes.push('Pregnant patient')
  if (/petrol|fuel|gas leak|chemical|பெட்ரோல்|எரிவாயு/i.test(text)) notes.push('Hazardous material reported')
  if (/blocked|heavy traffic|traffic jam|சாலை மறி|traffic neraya/i.test(text)) notes.push('Road access may be restricted')
  if (/rain|மழை|mazhai/i.test(text)) notes.push('Rain reported')
  if (/roof|rooftop|மாடி|maadi/i.test(text)) notes.push('Rooftop access may be needed')
  if (/bus|பேருந்து|lorry|truck/i.test(text)) notes.push('Large vehicle involved')
  const medicalConditions = conditionLabels.filter((condition) => !['Trapped', 'Conscious'].includes(condition))
  const explicitlyUninjured = /no (?:one (?:is )?(?:hurt|injured)|injuries)|everyone (?:is )?(?:safe|uninjured)|யாருக்கும் காயம் இல்லை|kaayam illa/i.test(text)
  const ambulanceRequested = /(?:send|need|want|venum|anupp).{0,25}ambulance|ambulance.{0,25}(?:venum|anupp|needed)|ஆம்புலன்ஸ்/i.test(text)
  const medicalRequired = medicalConditions.length > 0 || category === 'Medical emergency' || ambulanceRequested || (category === 'Road accident' && !explicitlyUninjured)
  if (explicitlyUninjured) notes.push('No injuries reported')
  return { transcript, location, knownLocationId, category, victims, unconscious, callerContact: extractContact(transcript), conditions: conditionLabels, severity, notes, medicalRequired, understanding: 'local' }
}

export const GREETING = 'Emergency call. What happened? Please tell me the details.'

export const SAMPLES: Record<Language, string[]> = {
  'en-IN': [
    'There has been a road accident near Tambaram Railway Station, Chennai. A car hit a bike and three people are injured. One person is unconscious and needs oxygen. Another has a broken leg with heavy bleeding. My contact number is 90000 00001.',
    'There is flooding in Velachery, Chennai after heavy rain. Five people are trapped on a rooftop, including two children. The water is still rising and they need rescue.',
    'My father is having severe chest pain at T. Nagar, Chennai. He is conscious but is struggling to breathe. Please send an ambulance.',
    'A building is on fire near Guindy, Chennai. Three people are trapped, with burns and smoke inhalation. There may be a gas leak.',
    'A cyclone has damaged homes near Marina Beach, Chennai. Six people are injured and trapped under a collapsed roof. Heavy rain is blocking the road.',
    'A building has collapsed in Madurai. Four people are trapped under the debris, one person is unconscious and another is bleeding.',
    'A shed is on fire near Anna Nagar, Chennai. Everyone is outside and safe. No injuries. Please send a fire team. My contact number is 90000 00002.',
  ],
  'ta-IN': [
    'சென்னை அண்ணா நகரில் சாலை விபத்து நடந்துள்ளது. கார் பைக் மீது மோதியது. இரண்டு பேர் காயமடைந்துள்ளனர். ஒருவர் மயக்கத்தில் இருக்கிறார். மற்றவருக்கு காலில் எலும்பு முறிவு மற்றும் அதிக ரத்தம் வருகிறது.',
    'சென்னை வேளச்சேரியில் மழையால் வெள்ளம் வந்துள்ளது. ஐந்து பேர் மாடியில் சிக்கி உள்ளனர். குழந்தைகளும் உள்ளனர். உடனே உதவி வேண்டும்.',
    'சென்னை தி நகரில் என் அப்பாவுக்கு நெஞ்சு வலி. மூச்சு விட சிரமமாக உள்ளது. ஆம்புலன்ஸ் அனுப்புங்கள்.',
    'சென்னை கிண்டியில் தீ விபத்து. மூன்று பேர் சிக்கி உள்ளனர். ஒருவருக்கு தீக்காயம். என் தொலைபேசி எண் 90000 00003.',
    'சென்னை மெரினாவில் புயல். ஆறு பேர் சிக்கி உள்ளனர். குழந்தைகளும் உள்ளனர். உடனே மீட்பு உதவி வேண்டும்.',
    'மதுரையில் கட்டிடம் இடிந்து நான்கு பேர் சிக்கி உள்ளனர். ஒருவர் மயக்கத்தில் உள்ளார்.',
    'சென்னை அண்ணா நகரில் நெருப்பு எரிகிறது. எல்லோரும் வெளியே உள்ளனர். யாருக்கும் காயம் இல்லை. தீயணைப்பு உதவி வேண்டும்.',
  ],
  tanglish: [
    'Anna Nagar Chennai la oru accident aachu. Car bike mela modhi rendu peru injured. Oru person mayakkama irukkaru, innorutharukku kaal odanjirukku and heavy bleeding. Please ambulance anuppunga.',
    'Velachery Chennai la mazhai nala vellam vandhirukku. Anju peru maadi la maatikitanga, children um irukanga. Thanni adhigama varuthu, help venum.',
    'T Nagar Chennai la enga appa ku nenju vali. Moochu vida kashtama irukku. Seekiram ambulance anuppunga please.',
    'Guindy Chennai la building fire. Moonu peru maatikitanga, burn injuries irukku. Fire team and ambulance venum. En number 90000 00004.',
    'Marina Chennai la puyal. Aaru peru maadi la maatikitanga. Evacuation team venum.',
    'Madurai la building idinjirukku. Naalu peru sikki irukanga. Oru person mayakkama irukkaru.',
    'Anna Nagar la shed eriyuthu. Ellarum veliya safe ah irukanga. Kaayam illa. Fire team venum.',
  ],
}
