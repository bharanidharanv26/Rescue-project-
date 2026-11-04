import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Ambulance, Check, Cross, Expand, Flame, Focus, Globe2, HeartPulse, MapPin, Navigation, Radio, Users, Waves, Wind } from 'lucide-react'
import { RESOURCE_COLORS, RESOURCE_LABELS, availableBeds } from '../lib/resources'
import { distanceKm } from '../lib/response'
import { resourcePosition, rescueOperation, stageDuration, treatmentDescription } from '../lib/simulation'
import type { Mission, Point, ResourceKind, ResponseNetwork } from '../lib/types'

const paths: Record<ResourceKind | 'hospital' | 'station' | 'incident', string> = {
  ambulance: '<path d="M3 6h11v11H3zM14 10h4l3 4v3h-7M18 10v4h3M7 8v5M4.5 10.5h5"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  'fire-team': '<path d="M12 3c1 6 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-2 2-5 1-9z"/>',
  'flood-team': '<path d="M3 12l9-4 9 4-3 6H6zM12 3v5M2 21c3-3 5 3 8 0s5 3 8 0 4 0 4 0"/>',
  'disaster-team': '<path d="M3 18L12 4l9 14H3zM8 18l4-7 4 7M3 22h18"/>',
  'rescue-team': '<path d="M12 3l8 4v6c0 5-8 9-8 9s-8-4-8-9V7zM12 8v8M8 12h8"/>',
  hospital: '<path d="M12 4v16M4 12h16"/>',
  station: '<path d="M3 21V7l9-4 9 4v14H3zm5 0V11h8v10"/>',
  incident: '<circle cx="12" cy="12" r="9"/><path d="M12 7v7m0 2v1"/>',
}
const svgIcon = (kind: keyof typeof paths) => `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`
function textNode(text: string) { const node = document.createElement('span'); node.textContent = text; return node }
interface MarkerEntry { marker: L.Marker; signature: string; position: Point }
interface Movement { marker: L.Marker; from: L.LatLng; to: Point; start: number }

function schematic(map: L.Map, point: Point) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 1200 1000')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.innerHTML = '<defs><pattern id="streets" width="60" height="50" patternUnits="userSpaceOnUse"><rect width="60" height="50" fill="#e8eeed"/><path d="M0 0h60M0 0v50" stroke="#fff" stroke-width="5"/></pattern></defs><rect width="1200" height="1000" fill="url(#streets)"/><path d="M0 200C400 200 400 700 1200 650" stroke="#b9dce7" stroke-width="40" fill="none"/><path d="M0 550L1200 350M400 0L700 1000" stroke="#fff5da" stroke-width="14"/><rect x="800" y="160" width="100" height="90" rx="8" fill="#cfe2d0"/>'
  return L.svgOverlay(svg, [[point[0] - 0.35, point[1] - 0.45], [point[0] + 0.35, point[1] + 0.45]], { pane: 'schematicPane', interactive: false }).addTo(map)
}

export function ResponseMap({ network, mission, onSelect }: { network: ResponseNetwork; mission: Mission | null; onSelect: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef(new Map<string, MarkerEntry>())
  const routeLayersRef = useRef(new Map<string, { signature: string; layer: L.LayerGroup }>())
  const movementsRef = useRef(new Map<string, Movement>())
  const schematicRegionsRef = useRef(new Set<string>())
  const frameRef = useRef(0)
  const onSelectRef = useRef(onSelect)
  const fittedRef = useRef('')
  const [offline, setOffline] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([])
  const [zoom, setZoom] = useState(12)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!containerRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: false }).setView([13.04, 80.22], 12)
    mapRef.current = map
    map.on('zoomend', () => setZoom(map.getZoom()))
    map.createPane('schematicPane').style.zIndex = '150'
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' }).addTo(map)
    let loaded = 0
    tiles.on('tileload', () => { loaded++; setOffline(false) })
    tiles.on('tileerror', () => { if (!loaded) setOffline(true) })
    const timer = setTimeout(() => { if (!loaded) setOffline(true) }, 7000)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(containerRef.current)
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changeMotion = () => setReduced(media.matches)
    media.addEventListener('change', changeMotion)
    return () => {
      clearTimeout(timer); observer.disconnect(); media.removeEventListener('change', changeMotion)
      cancelAnimationFrame(frameRef.current)
      movementsRef.current.clear(); markersRef.current.clear(); routeLayersRef.current.clear(); schematicRegionsRef.current.clear()
      fittedRef.current = ''; map.remove(); mapRef.current = null
    }
  }, [])

  function fitSelected() {
    const map = mapRef.current
    if (!map) return
    let points: Point[]
    if (mission) {
      const nearby = network.resources.filter((resource) => resource.regionId === mission.regionId).sort((a, b) => distanceKm(a.point, mission.location.point) - distanceKm(b.point, mission.location.point)).slice(0, 5)
      points = [mission.location.point, ...mission.assignments.flatMap((assignment) => assignment.route?.selected.points ?? [assignment.origin]), ...mission.hospitals.flatMap((hospital) => hospital.route?.selected.points ?? [hospital.point]), ...nearby.map((resource) => resource.point)]
    } else points = network.resources.map((resource) => resource.point)
    if (points.length) map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [48, 60], paddingBottomRight: [48, 145], maxZoom: 14, animate: false })
  }
  function fitAll() {
    const points = [...network.resources.map((resource) => resource.point), ...network.hospitals.map((hospital) => hospital.point), ...network.missions.filter((item) => item.state.stage !== 'completed').map((item) => item.location.point)]
    if (points.length) mapRef.current?.fitBounds(L.latLngBounds(points), { padding: [55, 85], maxZoom: 13, animate: false })
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const region of network.regions) {
      if (schematicRegionsRef.current.has(region)) continue
      const station = network.stations.find((item) => item.regionId === region)
      if (station) { schematic(map, station.point); schematicRegionsRef.current.add(region) }
    }
    const activeMap = map
    const keep = new Set<string>()
    function upsert(key: string, point: Point, kind: keyof typeof paths, color: string, label: string, selected: boolean, assigned: boolean, missionId?: string, moving = false, description = '') {
      keep.add(key)
      const size = selected ? 32 : zoom <= 10 ? 17 : kind === 'station' ? 23 : 28
      const signature = `${kind}|${selected}|${assigned}|${label}|${description}|${size}`
      let entry = markersRef.current.get(key)
      const markerIcon = () => L.divIcon({ className: `network-map-marker ${size < 20 ? 'compact-marker' : ''} ${assigned ? 'resource-assigned' : 'resource-available'} ${selected ? 'resource-selected' : ''}`, html: `<span style="--marker-color:${color}">${svgIcon(kind)}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
      if (!entry) {
        const marker = L.marker(point, { icon: markerIcon(), title: label, zIndexOffset: selected ? 1000 : kind === 'station' ? -50 : 0 }).addTo(activeMap)
        if (missionId) marker.on('click', () => onSelectRef.current(missionId))
        entry = { marker, signature: '', position: point }
        markersRef.current.set(key, entry)
      }
      if (entry.signature !== signature) {
        entry.marker.setIcon(markerIcon()).setZIndexOffset(selected ? 1000 : 0)
        entry.marker.unbindTooltip()
        entry.marker.bindTooltip(textNode(label), { permanent: selected && kind === 'incident', direction: kind === 'incident' || kind === 'hospital' ? 'top' : 'bottom', offset: [0, kind === 'incident' || kind === 'hospital' ? -21 : 20], className: `map-label network-map-label ${selected ? 'selected-label' : ''}` })
        entry.marker.getElement()?.setAttribute('aria-label', label)
        // A unit can be reassigned to a different mission after release.
        entry.marker.off('click')
        if (missionId) entry.marker.on('click', () => onSelectRef.current(missionId))
        entry.marker.unbindPopup()
        const content = document.createElement('div')
        content.className = 'resource-map-popup'
        const heading = document.createElement('strong'); heading.textContent = label
        const body = document.createElement('p'); body.textContent = description
        content.append(heading, body)
        entry.marker.bindPopup(content, { maxWidth: 300 })
        entry.signature = signature
      }
      if (entry.position[0] !== point[0] || entry.position[1] !== point[1]) {
        if (moving && !reduced) movementsRef.current.set(key, { marker: entry.marker, from: entry.marker.getLatLng(), to: point, start: performance.now() })
        else { movementsRef.current.delete(key); entry.marker.setLatLng(point) }
        entry.position = point
      }
    }
    network.stations.filter((station) => station.kind === 'fire-station' && !hiddenKinds.includes('station')).forEach((station) => {
      const units = network.resources.filter((resource) => resource.stationId === station.id)
      upsert(`station-${station.id}`, station.point, 'station', '#d78c64', station.name, false, false, undefined, false, `Simulated station. ${units.filter((unit) => !unit.assignedTo).length}/${units.length} units available. ${units.map((unit) => `${unit.id}: ${unit.assignedTo ?? 'available'}`).join('\n')}`)
    })
    network.hospitals.filter(() => !hiddenKinds.includes('hospital')).forEach((hospital) => upsert(`hospital-${hospital.id}`, hospital.point, 'hospital', '#249983', `${hospital.name} · ${availableBeds(hospital)}/${hospital.beds} beds available`, Boolean(mission?.hospitals.some((item) => item.id === hospital.id)), false, undefined, false, `Simulated facility. ${hospital.specialties.join(' · ')}.\nReservations: ${Object.entries(hospital.reservations).map(([id, beds]) => `${id}: ${beds} beds`).join(', ') || 'None'}`))
    network.missions.forEach((item) => {
      if (item.state.stage === 'completed' && item.id !== mission?.id) return
      upsert(`incident-${item.id}`, item.location.point, 'incident', item.state.stage === 'completed' ? '#8799ad' : '#df6270', `${item.id} · ${item.details.category} · ${item.location.name}`, item.id === mission?.id, true, item.id, false, `${item.details.victims ?? 'Unknown'} affected · ${item.details.conditions.join(', ')}. ${item.assignments.length} assigned units. Stage: ${item.state.stage}`)
    })
    network.resources.forEach((resource) => {
      if (hiddenKinds.includes(resource.kind)) return
      const owner = resource.assignedTo ? network.missions.find((item) => item.id === resource.assignedTo) : undefined
      const assignment = owner?.assignments.find((item) => item.resourceId === resource.id)
      const displayedMission = owner && reduced ? { ...owner, state: { ...owner.state, stageElapsed: Math.floor(owner.state.stageElapsed / 3) * 3 } } : owner
      const point = displayedMission && assignment ? resourcePosition(displayedMission, assignment) : resource.point
      const selected = Boolean(owner && owner.id === mission?.id)
      const packet = assignment?.packet
      const description = `${resource.name}\n${resource.capabilities.join(' · ')}\n${packet ? `Mission: ${packet.emergency} at ${packet.location}. Affected: ${packet.affected ?? 'unspecified'}. Conditions: ${packet.conditions.join(', ')}.\n${packet.instructions}\nContact: ${packet.contact ?? 'Not supplied'}\nHospital: ${packet.hospital ?? 'Not required'}\nSimulated notification acknowledged.` : 'Available for capability-matched dispatch.'}`
      upsert(`resource-${resource.id}`, point, resource.kind, RESOURCE_COLORS[resource.kind], `${resource.id} · ${owner ? owner.id : 'Available'} · ${RESOURCE_LABELS[resource.kind]}`, selected, Boolean(owner), owner?.id, Boolean(owner && !owner.state.paused && ['to-emergency', 'to-hospital'].includes(owner.state.stage)), description)
    })
    for (const [key, entry] of markersRef.current) if (!keep.has(key)) { entry.marker.remove(); markersRef.current.delete(key); movementsRef.current.delete(key) }

    const keepRoutes = new Set<string>()
    for (const item of network.missions) {
      if (item.state.stage === 'completed' && item.id !== mission?.id) continue
      keepRoutes.add(item.id)
      const isSelected = item.id === mission?.id
      const signature = `${isSelected}|${item.transmittedAt}|${item.assignments.filter((assignment) => assignment.route).length}|${item.hospitalRoute?.selected.id}`
      const existing = routeLayersRef.current.get(item.id)
      if (existing?.signature === signature) continue
      existing?.layer.remove()
      const layer = L.layerGroup().addTo(activeMap)
      for (const assignment of item.assignments) if (assignment.route) {
        if (isSelected) L.polyline(assignment.route.selected.points, { color: '#fff', weight: 8, opacity: 0.85, interactive: false }).addTo(layer)
        L.polyline(assignment.route.selected.points, { color: RESOURCE_COLORS[assignment.kind], weight: isSelected ? 4 : 2, opacity: isSelected ? 0.9 : 0.35, interactive: false }).addTo(layer)
      }
      for (const hospital of item.hospitals) if (hospital.route) L.polyline(hospital.route.selected.points, { color: '#269a83', weight: isSelected ? 4 : 2, opacity: isSelected ? 0.9 : 0.3, dashArray: '8 5', interactive: false }).addTo(layer)
      routeLayersRef.current.set(item.id, { signature, layer })
    }
    for (const [id, entry] of routeLayersRef.current) if (!keepRoutes.has(id)) { entry.layer.remove(); routeLayersRef.current.delete(id) }

    const fitKey = mission ? `${mission.id}-${Boolean(mission.transmittedAt)}` : 'network'
    if (fitKey !== fittedRef.current) { fitSelected(); fittedRef.current = fitKey }

    if (movementsRef.current.size) {
      cancelAnimationFrame(frameRef.current)
      const animate = (now: number) => {
        for (const [key, move] of movementsRef.current) {
          const fraction = Math.min(1, (now - move.start) / 200)
          move.marker.setLatLng([move.from.lat + (move.to[0] - move.from.lat) * fraction, move.from.lng + (move.to[1] - move.from.lng) * fraction])
          if (fraction === 1) movementsRef.current.delete(key)
        }
        if (movementsRef.current.size) frameRef.current = requestAnimationFrame(animate)
      }
      frameRef.current = requestAnimationFrame(animate)
    }
  }, [network, mission, reduced, hiddenKinds, zoom])

  useEffect(() => {
    if (!expanded) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [expanded])

  const active = network.missions.filter((item) => item.state.stage !== 'completed').length
  return <div className={`response-map-frame network-map-frame ${expanded ? 'expanded-map' : ''}`}>
    <div ref={containerRef} className="response-map" aria-label="Interactive map of all emergencies, available and assigned ambulances, rescue teams, fire stations, and hospitals" />
    <div className="map-top-label"><span className="live-dot" /><span>SHARED RESPONSE MAP</span><span className="map-label-divider" /><span className="map-city">{offline ? 'Offline schematic' : `${active} active ${active === 1 ? 'incident' : 'incidents'}`}</span></div>
    <div className="map-controls"><button className="map-button" onClick={fitSelected} aria-label="Fit selected mission" title="Fit selected mission"><Focus size={17} /></button><button className="map-button" onClick={fitAll} aria-label="Show all active missions and resources" title="Show entire network"><Globe2 size={17} /></button><button className="map-button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Exit expanded map' : 'Expand map'} aria-pressed={expanded}><Expand size={17} /></button></div>
    <div className="map-legend network-map-legend">{[...Object.entries(RESOURCE_LABELS), ['hospital', 'Hospital'], ['station', 'Fire station']].map(([kind, label]) => <button key={kind} aria-label={`Show ${label} markers`} aria-pressed={!hiddenKinds.includes(kind)} onClick={() => setHiddenKinds((hidden) => hidden.includes(kind) ? hidden.filter((item) => item !== kind) : [...hidden, kind])}><i className="legend-dot" style={{ background: RESOURCE_COLORS[kind as ResourceKind] ?? (kind === 'hospital' ? '#249983' : '#d78c64') }} />{label}</button>)}<span><i className="legend-dot red" />Incident</span></div>
    {mission ? <MissionScene mission={mission} /> : <div className="map-navigation-card"><span className="navigation-icon"><Radio size={24} /></span><div className="navigation-copy"><span>READY FOR THE NEXT CALL</span><strong>{network.resources.length} response resources standing by</strong><small>Click a map marker to inspect its location and availability.</small></div></div>}
    <span className="map-simulation-note">{offline ? 'Illustrative basemap · ' : ''}Live shared simulation · fleet, capacity & traffic modelled</span>
  </div>
}

function MissionScene({ mission }: { mission: Mission }) {
  const { state, details } = mission
  const progress = Math.min(1, state.stageElapsed / (stageDuration(state.stage, mission) || 1))
  const special = ['rescue', 'loading', 'handover', 'treatment', 'scene-clearance'].includes(state.stage)
  const SceneIcon = state.stage === 'treatment' ? HeartPulse : details.category === 'Fire' ? Flame : details.category === 'Flood' ? Waves : details.category === 'Cyclone' ? Wind : Users
  const title = state.stage === 'rescue' ? 'Specialist rescue in progress' : state.stage === 'loading' ? 'Loading patients into ambulances' : state.stage === 'handover' ? 'Transferring patients to hospital staff' : state.stage === 'treatment' ? 'Specialist treatment in progress' : 'Confirming everyone is safe'
  if (special) return <div className={`scene-card ${state.stage === 'treatment' ? 'treatment-scene' : ''}`}><div className="scene-card-header"><span className="scene-icon"><SceneIcon size={21} /></span><div><strong>{title}</strong><p>{state.stage === 'treatment' ? treatmentDescription(mission) : state.stage === 'rescue' ? rescueOperation(mission) : state.stage === 'scene-clearance' ? 'The team confirms the hazard is controlled and the rescue is complete.' : 'Patient identity, condition, and the complete emergency brief travel with the care team.'}</p></div><span className="scene-percent">{Math.floor(progress * 100)}%</span></div>
      {['loading', 'handover'].includes(state.stage) ? <div className="transfer-scene"><span className="scene-building">{state.stage === 'loading' ? <MapPin size={26} /> : <Ambulance size={31} />}</span><span className="transfer-track" /><span className="patient-stretcher" style={{ transform: `translateX(${progress * 90}px)` }}><svg width="47" height="29" viewBox="0 0 47 29" fill="none" aria-hidden="true"><circle cx="9" cy="7" r="4" fill="currentColor" /><path d="M16 9h14l6 7H5M6 20h33M11 20v5m22-5v5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><circle cx="11" cy="26" r="2" fill="currentColor" /><circle cx="33" cy="26" r="2" fill="currentColor" /></svg></span><span className="scene-destination">{state.stage === 'loading' ? <Ambulance size={35} /> : <Cross size={29} />}</span></div> : <div className="operation-progress"><div style={{ transform: `scaleX(${progress})` }} /></div>}
    </div>
  const completed = state.stage === 'completed'
  const hospitalPhase = ['to-hospital', 'hospital-arrival'].includes(state.stage)
  const preparing = ['queued', 'planning'].includes(state.stage)
  return <div className={`map-navigation-card ${completed ? 'completed-navigation' : ''}`}><span className="navigation-icon">{completed ? <Check size={25} /> : preparing ? <Radio size={23} /> : <Navigation size={23} />}</span><div className="navigation-copy"><span>{completed ? 'OPERATION COMPLETED' : preparing ? state.stage === 'queued' ? 'WAITING FOR SUITABLE RESOURCES' : 'RESERVATIONS CONFIRMED · PREPARING ROUTES' : hospitalPhase ? 'PATIENTS TO SPECIALIST CARE' : 'COORDINATED RESPONSE'}</span><strong>{completed ? details.medicalRequired ? 'Rescue, handover & treatment complete' : 'Rescue complete · everyone in a safe area' : hospitalPhase ? `${mission.hospitals.length} receiving hospitals · individual patient routes` : mission.location.name}</strong><small>{state.paused ? 'This mission is paused · other missions continue' : preparing ? mission.waitingReason || 'Mission packets will be acknowledged by every assigned team' : `${mission.assignments.length} assigned units · ${details.medicalRequired ? 'medical transport included' : 'rescue-only operation'}`}</small></div></div>
}
