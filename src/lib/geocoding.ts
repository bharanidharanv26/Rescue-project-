import { coordinatesFrom, exactKnownLocation, normalizePlace } from './reportedLocation'
import type { EmergencyDetails, ResolvedLocation } from './types'

export class LocationResolutionError extends Error {
  readonly code = 'LOCATION_UNRESOLVED'
}
export interface GeocodeResult {
  lat: string; lon: string; display_name: string
  name?: string; address?: Record<string, string>; namedetails?: Record<string, string>
}
type Search = (query: string) => Promise<GeocodeResult[]>
const cache = new Map<string, { expires: number; results: GeocodeResult[] }>()
let queue = Promise.resolve()
let nextRequestAt = 0

// Nominatim requires an identifying User-Agent and at most one request/second.
// Only location text is sent, never the medical report or caller's number.
const searchMap: Search = (query) => {
  const key = normalizePlace(query)
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.results)
  const work = queue.then(async () => {
    const repeated = cache.get(key)
    if (repeated && repeated.expires > Date.now()) return repeated.results
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())))
    nextRequestAt = Date.now() + 1100
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.search = new URLSearchParams({ format: 'jsonv2', limit: '8', addressdetails: '1', namedetails: '1', 'accept-language': 'en,ta', q: query }).toString()
    const response = await fetch(url, { signal: AbortSignal.timeout(6500), headers: { Accept: 'application/json', 'User-Agent': 'AegisResponseSimulation/1.0 (location lookup; local emergency simulator)' } })
    if (!response.ok) throw new Error('Map lookup unavailable')
    const results: unknown = await response.json()
    if (!Array.isArray(results)) throw new Error('Invalid map response')
    const valid = results.filter((item): item is GeocodeResult => Boolean(item && typeof item.display_name === 'string' && item.lat !== '' && item.lon !== '' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180))
    if (valid.length) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(key, { expires: Date.now() + 86400000, results: valid })
    }
    return valid
  })
  queue = work.then(() => undefined, () => undefined)
  return work
}

function matchingTokens(text: string) {
  return normalizePlace(text).split(' ').filter((token) => !['near', 'at', 'in', 'the', 'opposite', 'outside', 'district'].includes(token))
}
function matches(query: string, result: GeocodeResult) {
  const words = new Set(matchingTokens([result.display_name, result.name, ...Object.values(result.address ?? {}), ...Object.values(result.namedetails ?? {})].filter(Boolean).join(' ')))
  const requested = matchingTokens(query)
  return requested.length > 0 && requested.every((token) => words.has(token))
}
function samePlace(a: GeocodeResult, b: GeocodeResult) {
  const latitude = Number(a.lat)
  const km = Math.hypot((latitude - Number(b.lat)) * 111.195, (Number(a.lon) - Number(b.lon)) * 111.195 * Math.cos(latitude * Math.PI / 180))
  return km < 2
}

/** Resolve before reservations or route planning. Never substitute a demo point. */
export async function resolveLocation(details: EmergencyDetails, options: { offline?: boolean; search?: Search } = {}): Promise<ResolvedLocation> {
  const query = details.location?.trim()
  if (!query) throw new LocationResolutionError('No emergency location was recognised. Say the emergency location, including its city and a nearby landmark. No teams have been dispatched.')
  const coordinates = coordinatesFrom(query)
  if (coordinates) return { name: query, point: coordinates, source: 'geocoded', explanation: 'Using the latitude and longitude supplied in the call.', matchedAddress: query }
  // Re-evaluate the whole query. A stale knownLocationId is never trusted.
  const local = exactKnownLocation(query)
  if (!options.offline) {
    let results: GeocodeResult[]
    try { results = await (options.search ?? searchMap)(local?.name ?? query) }
    catch {
      throw new LocationResolutionError(`The map service could not verify “${query}”. Please try again when the map connection is available. No teams have been dispatched.`)
    }
    const candidates = results.filter((result) => matches(query, result) && Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon)) && Math.abs(Number(result.lat)) <= 90 && Math.abs(Number(result.lon)) <= 180)
    if (candidates.length > 1 && candidates.some((item) => !samePlace(candidates[0], item))) {
      throw new LocationResolutionError(`More than one place matches “${query}”. Please clarify the city, street or landmark. No teams have been dispatched.`)
    }
    const match = candidates[0]
    if (match) return { name: local?.name ?? query, point: [Number(match.lat), Number(match.lon)], source: 'geocoded', matchedAddress: match.display_name, explanation: `Map match: ${match.display_name}. Position follows the map feature; an area name is not a precise street address.` }
    // An online no-match is not permission to drop a landmark or change cities.
    throw new LocationResolutionError(`The reported location “${query}” could not be matched on the map. Please say its city and a nearby street or landmark. No teams have been dispatched.`)
  }
  if (local) return { name: local.name, point: local.point, source: 'local', matchedAddress: local.name, explanation: 'Known place matched from the local gazetteer. Area position is approximate.' }
  throw new LocationResolutionError(`“${query}” cannot be verified while map lookup is offline. No teams have been dispatched.`)
}
