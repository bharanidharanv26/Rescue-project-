import { LOCATIONS } from './locations'
import { distanceKm, hospitalSpecialties, requiredCapabilities } from './response'
import type { EmergencyDetails, Hospital, Mission, PatientProfile, Point, Resource, ResourceKind, ResourceRequirement, ResponseNetwork, Station } from './types'

export const RESOURCE_LABELS: Record<ResourceKind, string> = { ambulance: 'Ambulance', 'fire-team': 'Fire & rescue', 'flood-team': 'Flood rescue', 'disaster-team': 'Disaster evacuation', 'rescue-team': 'Search & rescue' }
export const RESOURCE_COLORS: Record<ResourceKind, string> = { ambulance: '#3777ef', 'fire-team': '#e57544', 'flood-team': '#149cb1', 'disaster-team': '#8c6dcc', 'rescue-team': '#bc9142' }

export function regionFor(point: Point): { id: string; name: string; centre: Point } {
  if (distanceKm(point, [13.04, 80.12]) < 45) return { id: 'chennai', name: 'Chennai', centre: [13.04, 80.02] }
  const city = LOCATIONS.find((item) => !item.name.includes('Chennai') && distanceKm(item.point, point) < 30)
  if (city) return { id: city.id, name: city.name.split(',')[0], centre: city.point }
  const centre: Point = [Math.round(point[0] * 4) / 4, Math.round(point[1] * 4) / 4]
  return { id: `region-${centre.join('-')}`, name: 'Regional', centre }
}

// 11 × 11 staging points, 5.5 km apart; Chennai's grid is shifted inland.
// These are simulation facilities, never presented as live service inventory.
export function buildRegion(point: Point) {
  const region = regionFor(point)
  const stations: Station[] = []
  const resources: Resource[] = []
  const hospitals: Hospital[] = []
  const latStep = 5.5 / 111.195
  const lonStep = latStep / Math.cos(region.centre[0] * Math.PI / 180)
  const care = [
    { name: 'Basic Life Support', capabilities: ['Basic life support'] },
    { name: 'Oxygen Support Ambulance', capabilities: ['Basic life support', 'Oxygen'] },
    { name: 'Advanced Life Support', capabilities: ['Basic life support', 'Oxygen', 'Advanced life support', 'Trauma care'] },
    { name: 'Critical Care Ambulance', capabilities: ['Basic life support', 'Oxygen', 'Advanced life support', 'Trauma care', 'Burn care', 'Ventilator'] },
    { name: 'Burns & Trauma Ambulance', capabilities: ['Basic life support', 'Oxygen', 'Advanced life support', 'Trauma care', 'Burn care'] },
  ]
  for (let row = 0; row < 11; row++) for (let col = 0; col < 11; col++) {
    const index = row * 11 + col
    const position: Point = [region.centre[0] + (row - 5) * latStep, region.centre[1] + (col - 5) * lonStep]
    const hub = row % 2 === 0 && col % 2 === 0
    const station: Station = { id: `${region.id}-station-${index}`, regionId: region.id, name: `${region.name} ${hub ? 'Fire & Rescue' : 'Medical'} Post ${index + 1}`, kind: hub ? 'fire-station' : 'response-station', point: [position[0] - latStep / 2, position[1]] }
    stations.push(station)
    const add = (kind: ResourceKind, name: string, capabilities: string[], capacity: number, offset: Point = [0, 0]) => resources.push({ id: `${region.id.toUpperCase()}-${kind === 'ambulance' ? 'AMB' : kind.toUpperCase().replace('-TEAM', '')}-${String(index + 1).padStart(3, '0')}`, regionId: region.id, name, kind, stationId: station.id, base: station.name, point: [position[0] + offset[0], position[1] + offset[1]], capabilities: [...capabilities], capacity, assignedTo: null, operational: true })
    const type = care[index % care.length]
    add('ambulance', type.name, type.capabilities, 1)
    if (hub) {
      add('fire-team', 'Fire Suppression & Rescue', ['Fire suppression', 'Breathing apparatus', 'Extrication', ...(index % 3 === 0 ? ['Hazmat'] : [])], 8, [latStep * .35, lonStep * .35])
      add('flood-team', 'Boat Rescue Team', ['Water rescue', 'Rescue boat', 'Life jackets'], 8, [latStep * .35, -lonStep * .35])
      add('disaster-team', 'Disaster Evacuation Team', ['Evacuation', 'Debris clearance', 'Shelter coordination'], 12, [-latStep * .35, lonStep * .35])
      add('rescue-team', 'Technical Search & Rescue', ['Search & rescue', 'Extrication', 'Debris clearance'], 6, [-latStep * .35, -lonStep * .35])
      const variants = [
        ['Trauma centre', 'Intensive care'], ['Cardiac care', 'Intensive care'], ['Burns unit', 'Trauma centre', 'Intensive care'],
        ['Neurology', 'Intensive care'], ['Paediatrics', 'Trauma centre', 'Intensive care'],
        ['Trauma centre', 'Intensive care', 'Cardiac care', 'Burns unit', 'Neurology', 'Paediatrics'],
      ]
      const specialties = ['Emergency medicine', ...variants[hospitals.length % variants.length]]
      hospitals.push({ id: `${region.id}-hospital-${index}`, regionId: region.id, name: `${region.name} ${['Trauma', 'Heart', 'Burns', 'Neuro', 'Children’s', 'Multispecialty'][hospitals.length % 6]} Centre ${hospitals.length + 1}`, point: [position[0], position[1] + lonStep / 2], specialties, beds: 8 + hospitals.length % 4 * 4, reservations: {} })
    }
  }
  return { region, stations, resources, hospitals }
}

export function patientsFor(details: EmergencyDetails) { return details.medicalRequired ? Math.max(1, details.victims ?? details.unconscious ?? 1) : 0 }

export function patientProfiles(details: EmergencyDetails): PatientProfile[] {
  const count = patientsFor(details)
  const explicit = (details.patientGroups ?? []).flatMap((group) => Array.from({ length: Math.min(count, group.count) }, () => [...group.conditions])).slice(0, count)
  // A counted unconscious subgroup must not make every patient unconscious.
  const hasGroups = explicit.length > 0
  const unspecified = hasGroups ? [] : details.conditions.filter((condition) => condition !== 'Unconscious' || details.unconscious === null)
  const conditions = Array.from({ length: count }, (_, index) => explicit[index] ?? [...unspecified])
  const knownUnconscious = conditions.filter((items) => items.includes('Unconscious')).length
  let remaining = Math.max(0, (details.unconscious ?? 0) - knownUnconscious)
  for (const items of conditions) if (remaining && !items.includes('Unconscious')) { items.push('Unconscious'); remaining-- }
  return conditions.map((items, index) => {
    const critical = items.some((condition) => ['Unconscious', 'Not breathing', 'Chest pain', 'Possible stroke', 'Heavy bleeding', 'Breathing difficulty', 'Seizure'].includes(condition))
    const profile: EmergencyDetails = { ...details, conditions: items, severity: critical ? 'Critical' : hasGroups || details.unconscious !== null ? 'High' : details.severity }
    return { id: `P${String(index + 1).padStart(3, '0')}`, conditions: items.length ? items : ['Condition unspecified — assessment required'], severity: profile.severity, capabilities: requiredCapabilities(profile), specialties: hospitalSpecialties(profile) }
  })
}

export function requirementsFor(details: EmergencyDetails): ResourceRequirement[] {
  const requirements: ResourceRequirement[] = []
  const capacity = Math.max(1, details.victims ?? 1)
  const add = (kind: ResourceKind, capabilities: string[]) => requirements.push({ kind, capabilities, capacity })
  if (details.category === 'Fire') add('fire-team', ['Fire suppression', ...(details.notes.includes('Hazardous material reported') ? ['Hazmat'] : [])])
  if (details.category === 'Flood') add('flood-team', ['Water rescue', 'Rescue boat'])
  if (details.category === 'Cyclone') add('disaster-team', ['Evacuation'])
  if (details.category === 'Other disaster' || details.category === 'Unclassified' || details.category === 'Road accident' && (details.conditions.includes('Trapped') || details.notes.includes('Large vehicle involved'))) add('rescue-team', ['Search & rescue', 'Extrication'])
  if (details.medicalRequired) requirements.push({ kind: 'ambulance', capabilities: [...new Set(patientProfiles(details).flatMap((patient) => patient.capabilities))], capacity: patientsFor(details) })
  if (!requirements.length) add('rescue-team', ['Search & rescue'])
  return requirements
}

export function availableBeds(hospital: Hospital) { return hospital.beds - Object.values(hospital.reservations).reduce((total, count) => total + count, 0) }
export interface Allocation { resources: Resource[]; patients: { patient: PatientProfile; resource: Resource; hospital: Hospital }[]; reason: string | null }
export function selectAllocation(network: ResponseNetwork, mission: Mission): Allocation {
  const selected: Resource[] = []
  const patients: Allocation['patients'] = []
  const failure = (reason: string): Allocation => ({ resources: [], patients: [], reason })
  for (const requirement of mission.requirements.filter((item) => item.kind !== 'ambulance')) {
    const candidates = network.resources.filter((resource) => resource.regionId === mission.regionId && resource.kind === requirement.kind && resource.operational && !resource.assignedTo && requirement.capabilities.every((capability) => resource.capabilities.includes(capability)))
      .sort((a, b) => distanceKm(a.point, mission.location.point) - distanceKm(b.point, mission.location.point))
    let capacity = 0
    for (const resource of candidates) { if (capacity >= requirement.capacity) break; selected.push(resource); capacity += resource.capacity }
    if (capacity < requirement.capacity) return failure(`Waiting for ${RESOURCE_LABELS[requirement.kind]}: ${capacity}/${requirement.capacity} suitable rescue spaces available.`)
  }
  // Hard clinical constraints first; preserve scarce equipment for critical patients.
  const profiles = patientProfiles(mission.details).sort((a, b) => b.capabilities.length + b.specialties.length - a.capabilities.length - a.specialties.length)
  const beds = new Map(network.hospitals.map((hospital) => [hospital.id, availableBeds(hospital)]))
  for (const patient of profiles) {
    const candidates = network.resources.filter((resource) => resource.regionId === mission.regionId && resource.kind === 'ambulance' && resource.operational && !resource.assignedTo && !selected.includes(resource) && patient.capabilities.every((capability) => resource.capabilities.includes(capability)))
    const score = (resource: Resource) => distanceKm(resource.point, mission.location.point) / 40 * 60 + (resource.capabilities.length - patient.capabilities.length) * 2.5
    candidates.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))
    const resource = candidates[0]
    if (!resource) return failure(`Waiting for suitable ambulances: ${patients.length}/${profiles.length} patients can be assigned. ${patient.id} needs ${patient.capabilities.join(', ')}. Busy units are never reused.`)
    const hospitalScore = (hospital: Hospital) => {
      const km = distanceKm(hospital.point, mission.location.point)
      const eta = km / 32 * 60 * (mission.details.category === 'Flood' ? 1.45 : 1.15)
      return eta * 0.7 + km * 0.3 + (1 - (beds.get(hospital.id) ?? 0) / hospital.beds) * 8 + (hospital.specialties.length - patient.specialties.length) * 0.5
    }
    const hospital = network.hospitals.filter((candidate) => candidate.regionId === mission.regionId && (beds.get(candidate.id) ?? 0) > 0 && patient.specialties.every((specialty) => candidate.specialties.includes(specialty))).sort((a, b) => hospitalScore(a) - hospitalScore(b))[0]
    if (!hospital) return failure(`Waiting for a receiving bed for ${patient.id}: ${patient.specialties.join(', ')}. No unsuitable hospital is substituted.`)
    selected.push(resource); beds.set(hospital.id, beds.get(hospital.id)! - 1)
    patients.push({ patient, resource, hospital })
  }
  return { resources: selected, patients, reason: null }
}
