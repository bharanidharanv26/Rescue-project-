import { describe, expect, it } from 'vitest'
import { extractEmergency } from './extraction'
import { ResponseEngine } from './network'
import { distanceKm, illustrativeRoute } from './response'
import { availableBeds, buildRegion } from './resources'
import { progressFor, resourcePosition, stageDuration, stagesFor } from './simulation'
import type { EmergencyDetails, Mission } from './types'

const location = { name: 'Anna Nagar, Chennai', point: [13.085, 80.2101] as [number, number], source: 'local' as const, explanation: 'Reported area' }
const engineFor = () => new ResponseEngine(undefined, async (...args) => illustrativeRoute(...args))
const submit = (engine: ResponseEngine, text: string, extra: Partial<EmergencyDetails> = {}) => engine.submit({ ...extractEmergency(text), ...extra }, location, crypto.randomUUID())
function complete(engine: ResponseEngine, mission: Mission) {
  for (let index = 0; index < 20 && mission.state.stage !== 'completed'; index++) engine.tick(stageDuration(mission.state.stage, mission) + .1)
}

describe('distributed response network', () => {
  it('has 121 ambulances on a 5–6 km grid and varied specialist facilities', () => {
    const data = buildRegion(location.point)
    const ambulances = data.resources.filter((unit) => unit.kind === 'ambulance')
    expect(ambulances).toHaveLength(121)
    for (const unit of ambulances) {
      const nearest = Math.min(...ambulances.filter((item) => item.id !== unit.id).map((item) => distanceKm(unit.point, item.point)))
      expect(nearest).toBeGreaterThan(5); expect(nearest).toBeLessThan(6)
    }
    expect(new Set(ambulances.map((item) => item.name)).size).toBe(5)
    expect(data.hospitals).toHaveLength(36)
    expect(data.stations.filter((item) => item.kind === 'fire-station')).toHaveLength(36)
  })

  it('allocates 25 ambulances, multiple hospitals and a complete packet to every unit', async () => {
    const engine = engineFor()
    const mission = submit(engine, 'A bus accident at Anna Nagar. 25 people are injured. Two people are unconscious. My contact number is 9876543210.')
    await engine.whenReady()
    const ambulances = mission.assignments.filter((unit) => unit.kind === 'ambulance')
    expect(ambulances).toHaveLength(25)
    expect(mission.assignments.filter((unit) => unit.kind === 'rescue-team')).toHaveLength(5)
    expect(mission.hospitals.length).toBeGreaterThan(1)
    expect(mission.hospitals.reduce((sum, hospital) => sum + hospital.reservedBeds, 0)).toBe(25)
    expect(ambulances.filter((item) => item.patient?.conditions.includes('Unconscious'))).toHaveLength(2)
    for (const assignment of mission.assignments) {
      expect(assignment.packet?.contact).toBe('9876543210')
      expect(assignment.packet?.affected).toBe(25)
      expect(assignment.acknowledged).toBe(true)
      expect(assignment.route?.selected.points.at(-1)).toEqual(location.point)
      if (assignment.patient) {
        expect(assignment.capabilities).toEqual(expect.arrayContaining(assignment.patient.capabilities))
        const hospital = mission.hospitals.find((item) => item.id === assignment.hospitalId)!
        expect(hospital.specialties).toEqual(expect.arrayContaining(assignment.patient.specialties))
        mission.state.stage = 'hospital-arrival'
        expect(resourcePosition(mission, assignment)).toEqual(hospital.point)
      }
    }
    engine.assertConsistent()
  })

  it('matches individually reported conditions to equipment and specialists', async () => {
    const engine = engineFor()
    const mission = submit(engine, 'Four patients at Anna Nagar need medical assistance.', {
      victims: 4, medicalRequired: true, category: 'Medical emergency', unconscious: 1,
      patientGroups: [{ count: 1, conditions: ['Unconscious', 'Not breathing'] }, { count: 1, conditions: ['Chest pain'] }, { count: 1, conditions: ['Possible stroke'] }, { count: 1, conditions: ['Oxygen required'] }],
    })
    await engine.whenReady()
    const units = mission.assignments
    expect(units.find((item) => item.patient?.id === 'P001')?.capabilities).toContain('Ventilator')
    expect(units.find((item) => item.patient?.id === 'P004')?.patient?.specialties).not.toContain('Cardiac care')
    for (const assignment of units) expect(mission.hospitals.find((item) => item.id === assignment.hospitalId)?.specialties).toEqual(expect.arrayContaining(assignment.patient!.specialties))
  })

  it('runs four simultaneous emergencies without sharing units or overbooking beds', async () => {
    const engine = engineFor()
    const missions = [
      submit(engine, 'Bus accident at Anna Nagar. 25 people injured. Two unconscious.'),
      submit(engine, 'Fire at Guindy. Three people have burns.'),
      submit(engine, 'Flood at Velachery. 20 people trapped. No injuries.'),
      submit(engine, 'My father has chest pain at T Nagar.'),
    ]
    await engine.whenReady()
    expect(missions.every((mission) => mission.state.stage === 'dispatch')).toBe(true)
    engine.assertConsistent()
    const ids = missions.flatMap((mission) => mission.assignments.map((assignment) => assignment.resourceId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(missions[2].hospitals).toHaveLength(0)
    expect(missions[2].assignments.every((unit) => unit.kind === 'flood-team')).toBe(true)
    expect(engine.network.hospitals.every((hospital) => availableBeds(hospital) >= 0)).toBe(true)
  })

  it('queues shortages atomically, resumes on release and keeps paused units reserved', async () => {
    const engine = engineFor()
    const keep = engine.network.resources.find((unit) => unit.kind === 'ambulance' && unit.capabilities.includes('Advanced life support'))!
    engine.network.resources.forEach((unit) => { if (unit.kind === 'ambulance' && unit !== keep) unit.operational = false })
    const first = submit(engine, 'One patient at Anna Nagar needs oxygen.')
    const second = submit(engine, 'One patient at Anna Nagar needs oxygen.')
    await engine.whenReady()
    expect(second.state.stage).toBe('queued'); expect(second.assignments).toHaveLength(0)
    expect(second.waitingReason).toContain('Waiting')
    engine.control(first.id, { paused: true }); engine.tick(999)
    expect(first.state.stage).toBe('dispatch'); expect(keep.assignedTo).toBe(first.id)
    engine.control(first.id, { paused: false }); complete(engine, first)
    await engine.whenReady()
    expect(first.state.stage).toBe('completed'); expect(second.state.stage).toBe('dispatch')
    expect(keep.assignedTo).toBe(second.id); engine.assertConsistent()
  })

  it('finishes only after hospital handover and treatment and survives a restart', async () => {
    let engine = engineFor()
    let mission = submit(engine, 'One person is unconscious at Anna Nagar after an accident.')
    await engine.whenReady()
    engine = new ResponseEngine(JSON.parse(JSON.stringify(engine.network)), async (...args) => illustrativeRoute(...args))
    mission = engine.network.missions[0]
    for (const stage of stagesFor(mission)) {
      expect(mission.state.stage).toBe(stage.id)
      expect(progressFor(mission.state, mission)).toBeLessThan(1)
      engine.tick(stageDuration(stage.id, mission) - .1)
      expect(mission.state.stage).toBe(stage.id)
      engine.tick(.2)
    }
    expect(mission.state.stage).toBe('completed')
    expect(progressFor(mission.state, mission)).toBe(1)
    expect(mission.state.events.map((event) => event.stage)).toContain('treatment')
    expect(engine.network.resources.every((unit) => unit.assignedTo === null)).toBe(true)
    expect(engine.network.hospitals.every((hospital) => availableBeds(hospital) === hospital.beds)).toBe(true)
  })

  it('does not duplicate an idempotent submission', () => {
    const engine = engineFor()
    const details = extractEmergency('Fire at Guindy. No injuries.')
    const first = engine.submit(details, location, 'same-request')
    expect(engine.submit(details, location, 'same-request')).toBe(first)
    expect(engine.network.missions).toHaveLength(1)
  })

  it('rejects the closest unsuitable ambulance and does not reserve units when beds are exhausted', async () => {
    const engine = engineFor()
    const nearest = engine.network.resources.find((unit) => unit.kind === 'ambulance' && unit.capabilities.length === 1)!
    nearest.point = [...location.point]
    const mission = submit(engine, 'One person is unconscious and not breathing at Anna Nagar.')
    await engine.whenReady()
    expect(mission.assignments).toHaveLength(1)
    expect(mission.assignments[0].resourceId).not.toBe(nearest.id)
    expect(mission.assignments[0].capabilities).toContain('Ventilator')
    const before = engine.network.resources.filter((unit) => unit.assignedTo).length
    engine.network.hospitals.forEach((hospital) => { hospital.beds = Object.values(hospital.reservations).reduce((sum, count) => sum + count, 0) })
    const waiting = submit(engine, 'One person is unconscious at Anna Nagar.')
    expect(waiting.state.stage).toBe('queued')
    expect(waiting.waitingReason).toContain('receiving bed')
    expect(engine.network.resources.filter((unit) => unit.assignedTo)).toHaveLength(before)
  })
})
