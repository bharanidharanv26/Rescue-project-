import { distanceKm, illustrativeRoute, planRoute } from './response'
import { availableBeds, buildRegion, requirementsFor, selectAllocation } from './resources'
import { advanceSimulation, initialSimulation, rescueOperation, resourcePosition, transition } from './simulation'
import type { EmergencyDetails, Mission, Point, ResolvedLocation, ResponseNetwork, RoutePlan } from './types'

type RoutePlanner = (start: Point, end: Point, details: EmergencyDetails) => Promise<RoutePlan>
const priority = { Critical: 0, High: 1, Moderate: 2, Undetermined: 3 }

export function emptyNetwork(): ResponseNetwork {
  return { version: 3, revision: 0, missions: [], resources: [], stations: [], hospitals: [], regions: [], understandingMode: 'local' }
}

// One authoritative server owns reservations. No await occurs during allocation,
// so simultaneous calls cannot reserve the same unit or overbook receiving beds.
export class ResponseEngine {
  network: ResponseNetwork
  private routePlanner: RoutePlanner
  private planning = new Set<string>()
  private pending = new Set<Promise<void>>()

  constructor(snapshot?: ResponseNetwork, routePlanner: RoutePlanner = planRoute) {
    this.network = snapshot ?? emptyNetwork()
    this.routePlanner = routePlanner
    this.ensureRegion([13.04, 80.22])
    for (const mission of this.network.missions) {
      if (mission.state.stage === 'planning') {
        this.release(mission, false)
        mission.assignments = []
        mission.hospital = null
        mission.hospitalRoute = null
        mission.hospitals = []
        transition(mission, 'queued', 'Server restarted during planning. Rechecking shared availability.')
      }
    }
  }

  ensureRegion(point: Point) {
    const data = buildRegion(point)
    if (!this.network.regions.includes(data.region.id)) {
      this.network.regions.push(data.region.id)
      this.network.resources.push(...data.resources)
      this.network.stations.push(...data.stations)
      this.network.hospitals.push(...data.hospitals)
    }
    return data.region.id
  }

  submit(details: EmergencyDetails, location: ResolvedLocation, requestId: string): Mission {
    const existing = this.network.missions.find((mission) => mission.requestId === requestId)
    if (existing) return existing
    if (location.source === 'fallback' || !location.point.every(Number.isFinite)) throw new Error('A verified emergency location is required before dispatch.')
    const mission: Mission = {
      id: `ER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, requestId, createdAt: new Date().toISOString(),
      regionId: this.ensureRegion(location.point), details, location, requirements: requirementsFor(details), assignments: [],
      hospital: null, hospitalRoute: null, hospitals: [], waitingReason: null, transmittedAt: null, state: initialSimulation(),
    }
    this.network.missions.push(mission)
    this.schedule()
    this.network.revision++
    return mission
  }

  schedule() {
    const waiting = this.network.missions.filter((mission) => mission.state.stage === 'queued' && !mission.state.paused)
      .sort((a, b) => priority[a.details.severity] - priority[b.details.severity] || a.createdAt.localeCompare(b.createdAt))
    for (const mission of waiting) {
      const allocation = selectAllocation(this.network, mission)
      mission.waitingReason = allocation.reason
      if (allocation.reason) continue
      for (const resource of allocation.resources) resource.assignedTo = mission.id
      for (const { patient, hospital } of allocation.patients) {
        hospital.reservations[mission.id] = (hospital.reservations[mission.id] ?? 0) + 1
        let receiving = mission.hospitals.find((item) => item.id === hospital.id)
        if (!receiving) {
          receiving = { id: hospital.id, name: hospital.name, point: hospital.point, specialties: hospital.specialties, reservedBeds: 0, patientIds: [], route: null }
          mission.hospitals.push(receiving)
        }
        receiving.reservedBeds++; receiving.patientIds.push(patient.id)
      }
      mission.hospital = mission.hospitals[0] ?? null
      mission.assignments = allocation.resources.map((resource) => {
        const clinical = allocation.patients.find((item) => item.resource.id === resource.id)
        return { resourceId: resource.id, name: resource.name, kind: resource.kind, base: resource.base, origin: [...resource.point], capabilities: [...resource.capabilities], capacity: resource.capacity, distance: distanceKm(resource.point, mission.location.point), route: null, acknowledged: false, patient: clinical?.patient ?? null, hospitalId: clinical?.hospital.id ?? null, packet: null }
      })
      transition(mission, 'planning', 'Suitable resources and receiving capacity reserved. Preparing routes and mission packets.')
      this.planning.add(mission.id)
      const work = this.prepareRoutes(mission).finally(() => { this.pending.delete(work); this.planning.delete(mission.id) })
      this.pending.add(work)
    }
  }

  private async prepareRoutes(mission: Mission) {
    const safePlan = async (start: Point, end: Point) => {
      try { return await this.routePlanner(start, end, mission.details) }
      catch { return illustrativeRoute(start, end, mission.details) }
    }
    // All routes are immediately usable; obtain road geometry within one bounded
    // planning window, rather than blocking a large incident for minutes.
    const deadline = Date.now() + 6500
    mission.assignments.forEach((assignment) => { assignment.route = illustrativeRoute(assignment.origin, mission.location.point, mission.details) })
    for (let index = 0; index < mission.assignments.length; index += 3) {
      if (Date.now() > deadline) break
      await Promise.all(mission.assignments.slice(index, index + 3).map(async (assignment) => {
        assignment.route = await safePlan(assignment.origin, mission.location.point)
      }))
    }
    await Promise.all(mission.hospitals.map(async (hospital) => { hospital.route = Date.now() > deadline ? illustrativeRoute(mission.location.point, hospital.point, mission.details) : await safePlan(mission.location.point, hospital.point) }))
    mission.hospitalRoute = mission.hospitals[0]?.route ?? null
    mission.transmittedAt = new Date().toISOString()
    mission.assignments.forEach((assignment) => {
      assignment.packet = { emergency: mission.details.category, location: mission.location.name, affected: mission.details.victims, conditions: assignment.patient?.conditions ?? mission.details.conditions, instructions: `${rescueOperation(mission)} Required equipment: ${assignment.patient?.capabilities.join(', ') ?? assignment.capabilities.join(', ')}. ${mission.details.notes.join('. ')}`, contact: mission.details.callerContact, hospital: mission.hospitals.find((hospital) => hospital.id === assignment.hospitalId)?.name ?? null, sentAt: mission.transmittedAt!, acknowledgedAt: new Date().toISOString() }
      assignment.acknowledged = true
    })
    transition(mission, 'dispatch', `Simulation mission packets delivered and acknowledged by ${mission.assignments.length} teams; ${mission.hospitals.length} receiving hospitals reserved.`)
    this.network.revision++
  }

  async whenReady() { await Promise.all([...this.pending]) }

  control(id: string, action: { paused?: boolean; speed?: number }) {
    const mission = this.network.missions.find((item) => item.id === id)
    if (!mission) throw new Error('Mission not found')
    if (mission.state.stage === 'completed') return mission
    if (action.paused !== undefined) mission.state.paused = action.paused
    if (action.speed !== undefined) {
      if (![1, 2, 4].includes(action.speed)) throw new Error('Playback speed must be 1, 2, or 4')
      mission.state.speed = action.speed
    }
    this.schedule()
    this.network.revision++
    return mission
  }

  tick(seconds: number) {
    let changed = false
    for (const mission of this.network.missions) {
      const previous = mission.state
      mission.state = advanceSimulation(previous, seconds * previous.speed, mission)
      if (mission.state !== previous) changed = true
      if (previous.stage !== 'completed' && mission.state.stage === 'completed') this.release(mission, true)
    }
    this.schedule()
    if (changed) this.network.revision++
  }

  private release(mission: Mission, moveToDestination: boolean) {
    for (const resource of this.network.resources) {
      if (resource.assignedTo !== mission.id) continue
      const assignment = mission.assignments.find((item) => item.resourceId === resource.id)
      if (moveToDestination && assignment) resource.point = resourcePosition(mission, assignment)
      resource.assignedTo = null
    }
    for (const hospital of this.network.hospitals) delete hospital.reservations[mission.id]
  }

  assertConsistent() {
    const active = this.network.missions.filter((mission) => !['queued', 'completed'].includes(mission.state.stage))
    const ids = active.flatMap((mission) => mission.assignments.map((assignment) => assignment.resourceId))
    if (new Set(ids).size !== ids.length) throw new Error('A resource is assigned to more than one active mission')
    for (const hospital of this.network.hospitals) if (availableBeds(hospital) < 0) throw new Error('Hospital capacity overbooked')
    for (const mission of active) for (const assignment of mission.assignments) {
      if (this.network.resources.find((resource) => resource.id === assignment.resourceId)?.assignedTo !== mission.id) throw new Error('Reservation does not match assignment')
    }
  }
}
