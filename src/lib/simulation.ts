import { positionAlongRoute } from './response'
import type { Mission, Point, ResourceAssignment, SimulationState, StageId } from './types'

export const STAGES: { id: StageId; title: string; short: string; description: string }[] = [
  { id: 'dispatch', title: 'Mission assigned & acknowledged', short: 'Dispatch', description: 'The complete incident brief is transmitted to every assigned team.' },
  { id: 'to-emergency', title: 'Teams en route to emergency', short: 'En route', description: 'Each assigned resource follows its own selected route.' },
  { id: 'arrival', title: 'Response teams on scene', short: 'On scene', description: 'All assigned teams have reached the reported location.' },
  { id: 'rescue', title: 'Rescue operation in progress', short: 'Rescue', description: 'Specialist teams secure the scene and attend to the victims.' },
  { id: 'loading', title: 'Patients boarding ambulances', short: 'Loading', description: 'Victims are stabilised and transferred into the assigned ambulances.' },
  { id: 'to-hospital', title: 'Transport to receiving hospital', short: 'Transport', description: 'Ambulances transport patients to the reserved specialist care team.' },
  { id: 'hospital-arrival', title: 'Ambulances arrived at hospital', short: 'Hospital', description: 'All transporting ambulances have reached the hospital entrance.' },
  { id: 'handover', title: 'Clinical handover in progress', short: 'Handover', description: 'The receiving team acknowledges patients, injuries, and the incident record.' },
  { id: 'treatment', title: 'Hospital treatment in progress', short: 'Treatment', description: 'The required specialist care pathway is being simulated.' },
  { id: 'scene-clearance', title: 'Rescue and scene clearance', short: 'All safe', description: 'Victims are in a safe area and the rescue team confirms the operation is complete.' },
]

export function stagesFor(mission: Mission) {
  return STAGES.filter((stage) => mission.details.medicalRequired ? stage.id !== 'scene-clearance' : ['dispatch', 'to-emergency', 'arrival', 'rescue', 'scene-clearance'].includes(stage.id))
}
export function travelDuration(minutes: number) { return Math.min(36, Math.max(15, minutes * 2.2)) }
export function stageDuration(stage: StageId, mission: Mission): number {
  switch (stage) {
    case 'queued': case 'planning': return Infinity
    case 'dispatch': return 4
    case 'to-emergency': return Math.max(15, ...mission.assignments.map((assignment) => travelDuration(assignment.route?.selected.durationMinutes ?? 8)))
    case 'arrival': return 3
    case 'rescue': return 9 + Math.min(9, (mission.details.victims ?? 1)) + (mission.details.conditions.includes('Trapped') ? 5 : 0)
    case 'loading': return 6
    case 'to-hospital': return Math.max(15, ...mission.hospitals.map((hospital) => travelDuration(hospital.route?.selected.durationMinutes ?? 8)))
    case 'hospital-arrival': return 3
    case 'handover': return 6
    case 'treatment': return mission.details.severity === 'Critical' ? 16 : 10
    case 'scene-clearance': return 5
    case 'completed': return 0
  }
}
export function initialSimulation(): SimulationState {
  return { stage: 'queued', stageElapsed: 0, elapsed: 0, paused: false, speed: 1, events: [{ stage: 'queued', elapsed: 0, message: 'Emergency received. Checking the shared resource pool.' }] }
}
export function transition(mission: Mission, stage: StageId, message: string) {
  mission.state.stage = stage
  mission.state.stageElapsed = 0
  mission.state.events.push({ stage, elapsed: mission.state.elapsed, message })
}
export function advanceSimulation(state: SimulationState, deltaSeconds: number, mission: Mission): SimulationState {
  if (state.paused || ['queued', 'planning', 'completed'].includes(state.stage) || deltaSeconds <= 0) return state
  const elapsed = state.elapsed + deltaSeconds
  const stageElapsed = state.stageElapsed + deltaSeconds
  if (stageElapsed < stageDuration(state.stage, mission)) return { ...state, stageElapsed, elapsed }
  const stages = stagesFor(mission)
  const index = stages.findIndex((stage) => stage.id === state.stage)
  const stage = stages[index + 1]?.id ?? 'completed'
  const message = stage === 'completed' ? (mission.details.medicalRequired ? 'Treatment and handover completed. All patients transferred to care; resources released.' : 'Rescue completed. Victims safe; no hospital treatment required. Resources released.')
    : stage === 'rescue' ? rescueOperation(mission)
    : stage === 'to-hospital' ? `Patient loading complete. Transporting patients to ${mission.hospitals.length} suitable receiving hospitals.`
    : stage === 'treatment' ? `Handover acknowledged. ${treatmentDescription(mission)}`
    : stages[index + 1].description
  return { ...state, stage, stageElapsed: 0, elapsed, events: [...state.events, { stage, elapsed, message }] }
}
export function rescueOperation(mission: Mission) {
  const category = mission.details.category
  if (category === 'Fire') return 'Fire teams isolate hazards, suppress the fire, and search for trapped victims.'
  if (category === 'Flood') return 'Water rescue teams deploy boats and life jackets, then evacuate victims to dry ground.'
  if (category === 'Cyclone') return 'Disaster teams clear debris, evacuate residents, and establish a safe shelter area.'
  if (category === 'Other disaster') return 'Search and rescue teams locate victims, stabilise debris, and perform extrication.'
  if (category === 'Medical emergency') return 'Paramedics assess the patient and provide condition-matched initial care.'
  return mission.details.conditions.includes('Trapped') ? 'Technical rescue teams extricate victims while paramedics provide initial care.' : 'Response teams secure the scene, assess victims, and provide initial care.'
}
export function treatmentDescription(mission: Mission) {
  const conditions = mission.details.conditions
  if (conditions.includes('Chest pain')) return 'Cardiac assessment, monitoring, and specialist treatment are being simulated.'
  if (conditions.includes('Possible stroke')) return 'Neurology assessment, imaging, and stroke-team treatment are being simulated.'
  if (conditions.includes('Burn injuries')) return 'Burns-unit assessment, wound care, and monitoring are being simulated.'
  if (conditions.some((condition) => ['Unconscious', 'Not breathing', 'Breathing difficulty', 'Oxygen required'].includes(condition))) return 'Airway support, oxygen, critical-care assessment, and monitoring are being simulated.'
  return 'Injury assessment, stabilisation, and appropriate specialist treatment are being simulated.'
}
export function progressFor(state: SimulationState, mission: Mission) {
  if (state.stage === 'completed') return 1
  const stages = stagesFor(mission)
  const index = stages.findIndex((stage) => stage.id === state.stage)
  return index < 0 ? 0 : (index + Math.min(1, state.stageElapsed / stageDuration(state.stage, mission))) / stages.length
}
export function resourcePosition(mission: Mission, assignment: ResourceAssignment): Point {
  const stage = mission.state.stage
  if (['queued', 'planning', 'dispatch'].includes(stage)) return assignment.origin
  if (stage === 'to-emergency' && assignment.route) return positionAlongRoute(assignment.route.selected.points, mission.state.stageElapsed / travelDuration(assignment.route.selected.durationMinutes))
  const hospital = mission.hospitals.find((item) => item.id === assignment.hospitalId)
  if (assignment.kind === 'ambulance' && hospital) {
    if (stage === 'to-hospital' && hospital.route) return positionAlongRoute(hospital.route.selected.points, mission.state.stageElapsed / travelDuration(hospital.route.selected.durationMinutes))
    if (['hospital-arrival', 'handover', 'treatment', 'completed'].includes(stage)) return hospital.point
  }
  return mission.location.point
}
export function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` }
