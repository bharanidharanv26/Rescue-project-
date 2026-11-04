import { describe, expect, it, vi } from 'vitest'
import { extractEmergency } from './extraction'
import { resolveLocation } from './geocoding'
import { exactKnownLocation } from './reportedLocation'
import { ResponseEngine } from './network'
import { illustrativeRoute } from './response'
import { resourcePosition } from './simulation'

describe('reported location preservation', () => {
  it.each([
    ['Accident near Apollo Hospital, Greams Road, Chennai.', 'Apollo Hospital, Greams Road, Chennai'],
    ['A crash at Anna Nagar, Madurai.', 'Anna Nagar, Madurai'],
    ['A crash at Unknown Junction, Chennai.', 'Unknown Junction, Chennai'],
    ['Accident near Oxford Street, London.', 'Oxford Street, London'],
    ['Accident at Jerusalem.', 'Jerusalem'],
    ['I am calling from Madurai. The accident is at Porur.', 'Porur, Chennai'],
    ['An accident at Anna Nagar, Chennai. Correction: the emergency location is Porur, Chennai.', 'Porur, Chennai'],
    ['Aypos nangal pagkatla, rindi perke aadipattitsi. Porur pagkatla.', 'Porur, Chennai'],
    ['குரோம்பேட்டையில் விபத்து நடந்துள்ளது.', 'Chromepet, Chennai'],
    ['திருப்பூரில் விபத்து நடந்துள்ளது.', 'திருப்பூர்'],
  ])('retains the actual location in %s', (text, expected) => {
    expect(extractEmergency(text).location).toBe(expected)
  })
  it('does not map a reused neighbourhood name or a landmark to a hardcoded city centre', () => {
    expect(exactKnownLocation('Anna Nagar, Madurai')).toBeNull()
    expect(exactKnownLocation('Anna Nagar')?.id).toBe('anna-nagar')
    expect(exactKnownLocation('Anna Nagar, Madurai')).toBeNull()
    expect(exactKnownLocation('Apollo Hospital, Chennai')).toBeNull()
    expect(exactKnownLocation('Jerusalem')).toBeNull()
    expect(exactKnownLocation('Anna Nagar, Chennai')?.id).toBe('anna-nagar')
  })
})

describe('verified map resolution before movement', () => {
  it('fetches even known places and uses the returned point instead of old coordinates', async () => {
    const search = vi.fn().mockResolvedValue([{ lat: '12.9257923', lon: '80.1179194', display_name: 'Tambaram Railway Station, Chennai, Tamil Nadu, India' }])
    const location = await resolveLocation(extractEmergency('Accident at Tambaram Railway Station.'), { search })
    expect(search).toHaveBeenCalledWith('Tambaram Railway Station, Chennai')
    expect(location.point).toEqual([12.9257923, 80.1179194])
    expect(location.source).toBe('geocoded')
  })
  it('matches the city and full landmark, rejecting a first result in the wrong city', async () => {
    const details = { ...extractEmergency('An accident at Anna Nagar, Madurai. Two people injured.'), knownLocationId: 'anna-nagar' }
    const search = vi.fn().mockResolvedValue([
      { lat: '13.085', lon: '80.2101', display_name: 'Anna Nagar, Chennai, India' },
      { lat: '9.923', lon: '78.151', display_name: 'Anna Nagar, Madurai, India' },
    ])
    const location = await resolveLocation(details, { search })
    expect(search).toHaveBeenCalledWith('Anna Nagar, Madurai')
    expect(location.point).toEqual([9.923, 78.151])
    const engine = new ResponseEngine(undefined, async (...args) => illustrativeRoute(...args))
    const mission = engine.submit(details, location, crypto.randomUUID())
    await engine.whenReady()
    expect(mission.location.matchedAddress).toContain('Madurai')
    mission.state.stage = 'arrival'
    for (const unit of mission.assignments) {
      expect(unit.route?.selected.points.at(-1)).toEqual([9.923, 78.151])
      expect(resourcePosition(mission, unit)).toEqual([9.923, 78.151])
    }
  })
  it('never treats a city-only search result as a match for a street or hospital', async () => {
    const search = vi.fn().mockResolvedValue([{ lat: '13.08', lon: '80.27', display_name: 'Chennai, Tamil Nadu, India' }])
    await expect(resolveLocation(extractEmergency('Accident at Apollo Hospital, Greams Road, Chennai.'), { search })).rejects.toThrow('could not be matched')
  })
  it('requests clarification for multiple equally named locations instead of taking the first', async () => {
    const search = vi.fn().mockResolvedValue([
      { lat: '13.085', lon: '80.2101', display_name: 'Anna Nagar, Chennai, India' },
      { lat: '9.923', lon: '78.151', display_name: 'Anna Nagar, Madurai, India' },
    ])
    // A bare neighbourhood name with no city in the gazetteer reaches the map as-is.
    const details = { ...extractEmergency('Accident at Anna Nagar.'), location: 'Anna Nagar', knownLocationId: null }
    await expect(resolveLocation(details, { search })).rejects.toThrow('More than one place')
  })
  it('accepts reported coordinates before considering any stale place id', async () => {
    const search = vi.fn()
    const details = { ...extractEmergency('Accident at 9.9252, 78.1198 near Chennai.'), knownLocationId: 'chennai' }
    expect((await resolveLocation(details, { search })).point).toEqual([9.9252, 78.1198])
    expect(search).not.toHaveBeenCalled()
  })
  it('blocks online lookup failures, invalid coordinates and no-match responses', async () => {
    const details = extractEmergency('Accident at Porur.')
    await expect(resolveLocation(details, { search: async () => { throw new Error('Offline') } })).rejects.toThrow('No teams have been dispatched')
    await expect(resolveLocation(details, { search: async () => [] })).rejects.toThrow('could not be matched')
    await expect(resolveLocation(details, { search: async () => [{ lat: '999', lon: '80', display_name: 'Porur, Chennai' }] })).rejects.toThrow('could not be matched')
  })
  it('rejects legacy demonstration positions before reserving any resource', () => {
    const engine = new ResponseEngine()
    expect(() => engine.submit(extractEmergency('Accident at Porur.'), { name: 'Demo', point: [13.085, 80.21], source: 'fallback', explanation: 'Unresolved' }, crypto.randomUUID())).toThrow('verified emergency location')
    expect(engine.network.missions).toHaveLength(0)
    expect(engine.network.resources.some((unit) => unit.assignedTo)).toBe(false)
  })
})
