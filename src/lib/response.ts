import type { EmergencyDetails, Point, RouteOption, RoutePlan } from './types'
export { resolveLocation } from './geocoding'

export function distanceKm(a: Point, b: Point) {
  const radians = Math.PI / 180
  const dLat = (b[0] - a[0]) * radians
  const dLon = (b[1] - a[1]) * radians
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - Math.min(1, h)))
}

async function fetchJson<T>(url: string, timeout = 5500): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return await response.json() as T
  } finally { clearTimeout(timer) }
}

export function requiredCapabilities(details: EmergencyDetails) {
  const required = ['Basic life support']
  if (details.severity === 'Critical' || details.conditions.includes('Unconscious')) required.push('Advanced life support')
  if (details.category === 'Road accident' || details.conditions.includes('Possible fracture')) required.push('Trauma care')
  if (details.conditions.some((condition) => ['Oxygen required', 'Breathing difficulty', 'Unconscious', 'Smoke inhalation', 'Not breathing'].includes(condition))) required.push('Oxygen')
  if (details.conditions.includes('Not breathing')) required.push('Ventilator')
  if (details.conditions.includes('Burn injuries')) required.push('Burn care')
  return required
}

export function hospitalSpecialties(details: EmergencyDetails) {
  const needed = ['Emergency medicine']
  if (details.category === 'Road accident' || details.conditions.includes('Possible fracture') || details.category === 'Other disaster') needed.push('Trauma centre')
  if (details.category === 'Fire' || details.conditions.includes('Burn injuries')) needed.push('Burns unit')
  if (details.conditions.includes('Chest pain')) needed.push('Cardiac care')
  if (details.conditions.includes('Possible stroke')) needed.push('Neurology')
  if (details.severity === 'Critical') needed.push('Intensive care')
  if (details.notes.includes('Children involved')) needed.push('Paediatrics')
  return needed
}

function scoreRoute(points: Point[], index: number, distance: number, duration: number, details: EmergencyDetails): RouteOption {
  // A deterministic traffic model, deliberately not presented as live traffic.
  const weather = details.notes.includes('Rain reported') || details.category === 'Flood' || details.category === 'Cyclone'
  const restriction = details.notes.includes('Road access may be restricted')
  const factors = restriction ? [1.75, 1.15, 1.35] : weather ? [1.45, 1.12, 1.3] : [1.3, 1.05, 1.55]
  const trafficFactor = factors[index % factors.length]
  const minutes = Math.max(1, duration * trafficFactor)
  return {
    id: `route-${index + 1}`, points, distanceKm: distance, durationMinutes: minutes, trafficFactor,
    traffic: trafficFactor < 1.2 ? 'Low' : trafficFactor < 1.5 ? 'Moderate' : 'Heavy',
    score: minutes * 0.7 + distance * 0.2 + (trafficFactor - 1) * 4,
  }
}

export function illustrativeRoute(start: Point, end: Point, details: EmergencyDetails): RoutePlan {
  const dLat = end[0] - start[0]
  const dLon = end[1] - start[1]
  const variations: Point[][] = [
    [start, [start[0], start[1] + dLon * 0.35], [start[0] + dLat * 0.65, start[1] + dLon * 0.35], [start[0] + dLat * 0.65, end[1]], end],
    [start, [start[0] + dLat * 0.3, start[1]], [start[0] + dLat * 0.3, start[1] + dLon * 0.7], [end[0], start[1] + dLon * 0.7], end],
    [start, [start[0] - 0.002, start[1]], [start[0] - 0.002, end[1] + 0.002], [end[0], end[1] + 0.002], end],
  ]
  const routes = variations.map((points, index) => {
    const distance = points.slice(1).reduce((total, point, i) => total + distanceKm(points[i], point), 0)
    return scoreRoute(points, index, distance, distance / 32 * 60, details)
  }).sort((a, b) => a.score - b.score)
  return { selected: routes[0], alternatives: routes.slice(1), source: 'illustrative' }
}

export async function planRoute(start: Point, end: Point, details: EmergencyDetails): Promise<RoutePlan> {
  try {
    const result = await fetchJson<{ code: string; routes: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] }>(
      `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=simplified&geometries=geojson&alternatives=true&steps=false`,
    )
    if (result.code !== 'Ok' || !result.routes?.length) throw new Error('No road route')
    const routes = result.routes.filter((route) => route.geometry.coordinates.length >= 2 && Number.isFinite(route.distance) && Number.isFinite(route.duration)).map((route, index) => {
      const points: Point[] = route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
      // Connect snapped road endpoints to the exact incident/station markers.
      return scoreRoute([start, ...points, end], index, route.distance / 1000, route.duration / 60, details)
    }).sort((a, b) => a.score - b.score)
    if (!routes.length) throw new Error('Invalid road route')
    return { selected: routes[0], alternatives: routes.slice(1), source: 'road-network' }
  } catch { return illustrativeRoute(start, end, details) }
}

export function positionAlongRoute(points: Point[], fraction: number): Point {
  if (!points.length) return [13.085, 80.2101]
  if (fraction <= 0) return points[0]
  if (fraction >= 1) return points[points.length - 1]
  const lengths = points.slice(1).map((point, index) => distanceKm(points[index], point))
  let remaining = lengths.reduce((total, length) => total + length, 0) * fraction
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index] > 0) {
      const progress = remaining / lengths[index]
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * progress, points[index][1] + (points[index + 1][1] - points[index][1]) * progress]
    }
    remaining -= lengths[index]
  }
  return points[points.length - 1]
}
