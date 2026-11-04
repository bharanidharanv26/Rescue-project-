# Aegis Response

An intelligent emergency response and rescue simulation with two connected pages: a public voice call and a shared, interactive response map.

## Run

Requires Node.js **22.12+ or 24+**, npm, a microphone, and a Mistral API account with access to realtime transcription.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `MISTRAL_API_KEY`.
3. Run `npm run dev` and open **http://localhost:5173**.

```dotenv
MISTRAL_API_KEY=your_key_here
MISTRAL_TRANSCRIPTION_MODEL=voxtral-mini-transcribe-realtime-3
MISTRAL_EXTRACTION_MODEL=mistral-small-latest
API_PORT=3001
SIMULATION_DATA_FILE=.data/aegis-network.json
```

The API key stays on the server. Do not prefix it with `VITE_`. Restart the server after changing configuration. The application reports missing credentials and provider errors; it never substitutes fabricated speech or browser speech recognition.

For production, run `npm run build` followed by `npm start`. The Node server serves both SPA routes, the API, server-sent updates and speech WebSockets on port 3001. A reverse proxy must support WebSocket upgrades on `/api/speech` and unbuffered SSE on `/api/events`. Microphone access requires **HTTPS or localhost**.

## Public emergency call — `/`

- Click **CALL EMERGENCY** to open the microphone. Speak naturally, including the incident, location, people affected, conditions and callback number if available.
- An AudioWorklet captures continuous mono PCM. Audio streams through the server to Mistral's realtime transcription WebSocket. Automatic language detection is enabled for English, Tamil and mixed Tamil/English speech; there is no language questionnaire.
- Every Mistral text delta appears immediately in the read-only live transcript. Audio spoken during provider connection is buffered briefly rather than discarded.
- **STOP CALL** drains the final audio frame and waits for Mistral's final transcript. That complete transcript is the source for emergency understanding and dispatch.
- Mistral chat extraction returns validated emergency facts and disjoint patient-condition groups. Unknown facts remain unspecified. If semantic extraction fails, the interface explicitly discloses local multilingual rule-based extraction; speech itself never falls back to generated text.
- Extracted key points remain on this page. **Follow emergency response** opens the dispatched mission. A new call creates an independent incident in the same resource pool.

The default realtime model follows Mistral's [current realtime API](https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-in-realtime). Model availability and language/code-switching accuracy depend on your Mistral account and model version. Live recognition quality, particularly Tamil/Tanglish, must be checked with actual speech and a configured account. Automated tests use provider fixtures, not a live paid API.

## Emergency simulation — `/simulation`

### Resource network

Each simulated region starts with:

| Resource | Count | Details |
| --- | ---: | --- |
| Ambulances | 121 | 11 × 11 staging grid, approximately **5.5 km** between adjacent positions |
| Hospitals | 36 | Emergency, trauma, cardiac, burns, neurology, paediatrics and multispecialty facilities |
| Fire stations | 36 | Distributed fire and rescue hubs |
| Fire teams | 36 | Suppression, breathing apparatus, extrication; selected units provide hazmat |
| Flood rescue teams | 36 | Boats, water rescue and life jackets |
| Disaster teams | 36 | Evacuation, debris clearance and shelter coordination |
| Technical rescue teams | 36 | Search, extrication and debris clearance |

Five ambulance types have different equipment: basic life support, oxygen support, advanced life support, critical care with ventilator, and burns/trauma care. The Chennai grid is shifted inland; other regions are generated around the reported city. All inventories, facility names, capacities and availability are simulation data.

Click resource markers to inspect equipment, availability and mission notifications. Click incidents to switch missions. Map controls fit a selected mission or the full network, expand the map and zoom. Resource filters reduce visual density. All active incidents and assigned units remain part of the same map and shared inventory.

### Allocation

- **One ambulance per medical patient.** A 25-victim bus accident reserves 25 suitable ambulances, plus technical rescue teams sized for the affected population.
- Hard equipment requirements exclude unsuitable units. Availability, distance/modelled arrival time and equipment scarcity rank the remaining candidates. A closer basic unit cannot replace a required advanced or ventilator unit.
- Explicit patient groups retain their own conditions. Counted unconscious patients are handled separately. Where the caller has not distinguished conditions, the local fallback uses conservative shared requirements and labels unspecified conditions.
- Every patient receives a compatible hospital bed. Hospital matching uses specialty, estimated travel time, distance and remaining capacity; patients can be split across several hospitals.
- Fire, flood, cyclone and collapse emergencies receive capacity-matched specialist teams. Rescue-only incidents finish without inventing injuries or hospital treatment.
- Unit and bed reservations are atomic on the authoritative Node server. Concurrent calls cannot double-book a unit or overbook beds. If a complete suitable allocation is unavailable, the incident queues with an explicit shortage; queued missions are reconsidered by severity and arrival order when capacity is released.
- Every assigned team gets a stored **simulated mission notification**: emergency, location, affected count, conditions, instructions, callback number and its own hospital where applicable. Notifications and simulated acknowledgements are inspectable in the assignment list and marker popup. No external emergency service or real phone is contacted.

### Full lifecycle

Call received → transcription → structured understanding → requirements → atomic resource/bed reservation → route planning → mission delivery/acknowledgement → individual journeys to the scene → arrival → rescue → patient loading → individual hospital routes → hospital arrival → handover → treatment → completion and resource release.

Each unit follows its own route; ambulances travel to their assigned receiving hospital. The mission waits for the longest transport before handover. Play, pause and 1×/2×/4× speed affect only the selected incident. Other incidents keep progressing, including while the public page is open or browser tabs are closed.

The server persists state in `.data/aegis-network.json`. Refreshing or restarting restores reservations and progress. A restart during route planning safely releases and recalculates that mission's reservations. Older project snapshots are not loaded into the new schema; the default filename keeps them separate.

## Maps, timing and simulation boundaries

- Leaflet uses OpenStreetMap tiles. Panning and zooming remain available with a labelled schematic if tiles fail.
- Known Tamil Nadu locations map to approximate neighbourhood coordinates. Other locations use Nominatim; an unresolved location explicitly displays its demonstration-position fallback. This is not GPS-level incident positioning.
- OSRM provides road routes where available. Route planning has a bounded window for large fleets; unreturned routes use labelled illustrative geometry. Distance, weather/access hints and a simulated traffic factor inform route ranking. Traffic is not live.
- Travel, rescue and treatment durations are accelerated simulation time, not medical predictions. Beds are released after simulated treatment. Units become available at their destination rather than teleporting to their original staging points.
- `SIMULATION_OFFLINE=1` disables road-route lookup for deterministic runs; live microphone transcription still requires Mistral. `SIMULATION_DATA_FILE=:memory:` disables persistence.

## Verification

```sh
npm test          # Extraction, speech proxy, grid coverage, allocation, concurrency, lifecycle
npm run build     # TypeScript and production bundle
npm run test:e2e  # Desktop/mobile browser workflows using microphone/provider fixtures
```

Browser tests use installed Google Chrome. Set `PLAYWRIGHT_CHANNEL=msedge` for Microsoft Edge. Tests start an isolated in-memory server, run the actual AudioWorklet pipeline with Chromium's test microphone, and mock Mistral text events. They cover final buffered words, the complete treatment lifecycle, 25 simultaneous patient assignments, four concurrent emergencies, mobile Tamil rendering, map inspection, offline maps, refresh recovery and missing-key/microphone-denial errors. The speech proxy contract is also exercised against a local WebSocket provider fixture.

Test real microphone permissions, recognition quality and mobile touch/safe-area behaviour on physical devices before relying on the interaction. No real Mistral API request is part of the automated tests.

## Key files

```text
server/speech.ts                   Server-side Mistral realtime proxy
public/pcm-capture.js              Continuous PCM AudioWorklet
src/hooks/useEmergencyCall.ts      Call capture, streaming, stop/finalisation and cleanup
server/understanding.ts            Mistral structured extraction and validation
server/index.ts                    Shared API, SSE, persistence and simulation clock
src/lib/resources.ts              Distributed inventory and patient-level allocation
src/lib/network.ts                Atomic reservations, routes and mission notifications
src/lib/simulation.ts             Response lifecycle and individual resource positions
src/components/ResponseMap.tsx    Interactive all-mission resource map
src/pages/CallPage.tsx             Public voice interface
src/pages/SimulationPage.tsx       Live response interface
```
