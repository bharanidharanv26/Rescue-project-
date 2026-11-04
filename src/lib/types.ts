export type Category = 'Road accident' | 'Flood' | 'Cyclone' | 'Fire' | 'Medical emergency' | 'Other disaster' | 'Unclassified'
export type Severity = 'Critical' | 'High' | 'Moderate' | 'Undetermined'
export type Language = 'en-IN' | 'ta-IN' | 'tanglish'
export type Point = [number, number]

export interface PatientGroup { count: number; conditions: string[] }
export interface PatientProfile { id: string; conditions: string[]; capabilities: string[]; specialties: string[]; severity: Severity }

export interface EmergencyDetails {
  transcript: string
  location: string | null
  knownLocationId: string | null
  category: Category
  victims: number | null
  unconscious: number | null
  callerContact: string | null
  conditions: string[]
  severity: Severity
  notes: string[]
  medicalRequired: boolean
  understanding: 'local' | 'ai'
  extractionNote?: string
  patientGroups?: PatientGroup[]
}

export interface ResolvedLocation {
  name: string
  point: Point
  source: 'local' | 'geocoded' | 'fallback'
  explanation: string
  matchedAddress?: string
}

export type ResourceKind = 'ambulance' | 'fire-team' | 'flood-team' | 'disaster-team' | 'rescue-team'
export interface Resource {
  id: string
  regionId: string
  name: string
  kind: ResourceKind
  stationId: string
  base: string
  point: Point
  capabilities: string[]
  capacity: number
  assignedTo: string | null
  operational: boolean
}
export interface Station {
  id: string
  regionId: string
  name: string
  kind: 'fire-station' | 'response-station'
  point: Point
}
export interface Hospital {
  id: string
  regionId: string
  name: string
  point: Point
  specialties: string[]
  beds: number
  reservations: Record<string, number>
}
export interface ResourceRequirement {
  kind: ResourceKind
  capabilities: string[]
  capacity: number
}
export interface RouteOption {
  id: string
  points: Point[]
  distanceKm: number
  durationMinutes: number
  traffic: 'Low' | 'Moderate' | 'Heavy'
  trafficFactor: number
  score: number
}
export interface RoutePlan {
  selected: RouteOption
  alternatives: RouteOption[]
  source: 'road-network' | 'illustrative'
}
export interface ResourceAssignment {
  resourceId: string
  name: string
  kind: ResourceKind
  base: string
  origin: Point
  capabilities: string[]
  capacity: number
  distance: number
  route: RoutePlan | null
  acknowledged: boolean
  patient: PatientProfile | null
  hospitalId: string | null
  packet: { emergency: string; location: string; affected: number | null; conditions: string[]; instructions: string; contact: string | null; hospital: string | null; sentAt: string; acknowledgedAt: string } | null
}
export interface HospitalAssignment {
  id: string; name: string; point: Point; specialties: string[]; reservedBeds: number; patientIds: string[]; route: RoutePlan | null
}
export type StageId = 'queued' | 'planning' | 'dispatch' | 'to-emergency' | 'arrival' | 'rescue' | 'loading' | 'to-hospital' | 'hospital-arrival' | 'handover' | 'treatment' | 'scene-clearance' | 'completed'
export interface SimulationState {
  stage: StageId
  stageElapsed: number
  elapsed: number
  paused: boolean
  speed: number
  events: { stage: StageId; elapsed: number; message: string }[]
}
export interface Mission {
  id: string
  requestId: string
  createdAt: string
  regionId: string
  details: EmergencyDetails
  location: ResolvedLocation
  requirements: ResourceRequirement[]
  assignments: ResourceAssignment[]
  hospital: { id: string; name: string; point: Point; specialties: string[]; reservedBeds: number } | null
  hospitalRoute: RoutePlan | null
  hospitals: HospitalAssignment[]
  waitingReason: string | null
  transmittedAt: string | null
  state: SimulationState
}
export interface ResponseNetwork {
  version: 3
  revision: number
  missions: Mission[]
  resources: Resource[]
  stations: Station[]
  hospitals: Hospital[]
  regions: string[]
  understandingMode: 'local' | 'ai'
}
