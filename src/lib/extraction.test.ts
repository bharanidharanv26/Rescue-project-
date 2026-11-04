import { describe, expect, it } from 'vitest'
import { extractEmergency, SAMPLES } from './extraction'

describe('natural-language emergency extraction', () => {
  it.each(['en-IN', 'ta-IN', 'tanglish'] as const)('understands the accident sample in %s', (language) => {
    const details = extractEmergency(SAMPLES[language][0])
    expect(details.category).toBe('Road accident')
    expect(details.knownLocationId).toBe(language === 'en-IN' ? 'tambaram-station' : 'anna-nagar')
    expect(details.victims).toBe(language === 'en-IN' ? 3 : 2)
    expect(details.conditions).toContain('Unconscious')
    expect(details.severity).toBe('Critical')
  })

  it.each(['en-IN', 'ta-IN', 'tanglish'] as const)('understands flood rescue in %s', (language) => {
    const details = extractEmergency(SAMPLES[language][1])
    expect(details.category).toBe('Flood')
    expect(details.knownLocationId).toBe('velachery')
    expect(details.victims).toBe(5)
    expect(details.severity).toBe('High')
    expect(details.conditions).toContain('Trapped')
    expect(details.notes).toContain('Children involved')
  })

  it.each(['en-IN', 'ta-IN', 'tanglish'] as const)('understands a single cardiac patient in %s', (language) => {
    const details = extractEmergency(SAMPLES[language][2])
    expect(details.category).toBe('Medical emergency')
    expect(details.victims).toBe(1)
    expect(details.conditions).toContain('Chest pain')
    expect(details.severity).toBe('Critical')
  })

  it.each([
    ['A building is on fire near Guindy. Three people have burns.', 'Fire', 3],
    ['A cyclone at Marina Beach has left six people injured.', 'Cyclone', 6],
    ['A building collapsed in Madurai. Four people are trapped.', 'Other disaster', 4],
  ])('classifies %s', (text, category, victims) => {
    const details = extractEmergency(String(text))
    expect(details.category).toBe(category)
    expect(details.victims).toBe(victims)
  })

  it('does not turn missing details into invented facts', () => {
    const details = extractEmergency('Please send help, something happened.')
    expect(details.victims).toBeNull()
    expect(details.location).toBeNull()
    expect(details.category).toBe('Unclassified')
    expect(details.severity).toBe('Undetermined')
  })

  it('handles explicit negation without marking the patient unconscious', () => {
    const details = extractEmergency('There was an accident at Anna Nagar. One person has minor injuries. He is not unconscious and is not bleeding.')
    expect(details.conditions).not.toContain('Unconscious')
    expect(details.conditions).not.toContain('Bleeding')
    expect(details.severity).toBe('Moderate')
  })

  it('accepts typed free-form locations and coordinates', () => {
    expect(extractEmergency('There is an accident near Oxford Street, London. Two people are injured.').location).toBe('Oxford Street, London')
    expect(extractEmergency('Crash at 13.0827, 80.2707. Three people are hurt.').location).toBe('13.0827, 80.2707')
  })

  it('handles Tamil numerals and distinguishes zero from unknown patients', () => {
    expect(extractEmergency('சென்னை விபத்தில் ௩ பேர் காயமடைந்தனர்.').victims).toBe(3)
    expect(extractEmergency('A car accident at Guindy. No one is hurt.').victims).toBe(0)
    expect(extractEmergency('A car accident at Guindy.').victims).toBeNull()
  })

  it('understands spoken Tamil accident details with a station location', () => {
    const details = extractEmergency('ரயில்வே ஸ்டேஷன் பக்கத்துல ஆக்சிடென்ட் ஆயிடுச்சு தாம்பரம் ரயில்வே ஸ்டேஷன் நாலு பேருக்கு செம அடி கொஞ்சம் சீக்கிரம் வாங்க')
    expect(details.category).toBe('Road accident')
    expect(details.knownLocationId).toBe('tambaram-station')
    expect(details.victims).toBe(4)
    expect(details.conditions).toContain('Injured')
  })
})
