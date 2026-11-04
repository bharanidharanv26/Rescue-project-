import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractEmergency } from './extraction'
import { distanceKm, illustrativeRoute, planRoute, positionAlongRoute, resolveLocation } from './response'

afterEach(() => vi.unstubAllGlobals())
const offline = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')))

describe('response assignment and routing', () => {
  it('blocks dispatch instead of inventing a location when lookup fails', async () => {
    offline()
    await expect(resolveLocation(extractEmergency('Help, a person is hurt.'))).rejects.toThrow('No emergency location')
    await expect(resolveLocation(extractEmergency('Accident near Unknown Junction.'))).rejects.toThrow('No teams have been dispatched')
  })

  it('selects the lowest combined distance, traffic, and travel-time score', () => {
    const details = extractEmergency('A flood at Velachery. Heavy traffic is blocking the road.')
    const plan = illustrativeRoute([13.09, 80.21], [13.06, 80.25], details)
    expect(plan.alternatives).toHaveLength(2)
    for (const alternative of plan.alternatives) expect(plan.selected.score).toBeLessThanOrEqual(alternative.score)
    expect(plan.selected.traffic).toBe('Low')
  })

  it('uses road-network alternatives when the route service responds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'Ok', routes: [
      { geometry: { coordinates: [[80.21, 13.09], [80.23, 13.08], [80.25, 13.06]] }, distance: 6000, duration: 600 },
      { geometry: { coordinates: [[80.21, 13.09], [80.22, 13.07], [80.25, 13.06]] }, distance: 6500, duration: 620 },
    ] }) }))
    const route = await planRoute([13.09, 80.21], [13.06, 80.25], extractEmergency('A crash at Anna Nagar.'))
    expect(route.source).toBe('road-network')
    expect(route.alternatives).toHaveLength(1)
    expect(route.selected.id).toBe('route-2')
  })

  it('moves by distance along the route and lands exactly on the destination', () => {
    const points: [number, number][] = [[13, 80], [13.01, 80], [13.02, 80]]
    expect(positionAlongRoute(points, 0)).toEqual(points[0])
    expect(positionAlongRoute(points, 1)).toEqual(points[2])
    expect(positionAlongRoute(points, 0.5)[0]).toBeCloseTo(13.01, 4)
    expect(distanceKm(points[0], points[2])).toBeGreaterThan(2)
  })
})
