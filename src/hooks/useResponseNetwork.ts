import { useCallback, useEffect, useState } from 'react'
import type { EmergencyDetails, ResponseNetwork } from '../lib/types'

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || 'The response server could not process the request.'), { code: result.code })
  return result as T
}

export function useResponseNetwork() {
  const [network, setNetwork] = useState<ResponseNetwork | null>(null)
  const [connected, setConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as ResponseNetwork
        if (snapshot.version !== 3) return
        setNetwork(snapshot)
        setConnected(true)
        setConnectionError('')
      } catch { setConnectionError('Could not read the shared response update.') }
    }
    events.onerror = () => {
      setConnected(false)
      setConnectionError('Reconnecting to the response server. Missions continue on the server; displayed positions may be out of date.')
    }
    return () => events.close()
  }, [])

  const submit = useCallback(async (transcript: string, requestId: string) => {
    const result = await post<{ missionId: string }>('/api/missions', { transcript, requestId })
    // The POST may finish before the next SSE message. Fetch the authoritative snapshot.
    const response = await fetch('/api/state')
    if (!response.ok) throw new Error('The mission was received but the response could not be loaded. Retry to retrieve it.')
    const snapshot = await response.json() as ResponseNetwork
    setNetwork(snapshot)
    const details = snapshot.missions.find((mission) => mission.id === result.missionId)?.details
    if (!details) throw new Error('The mission could not be retrieved. Please retry.')
    return { id: result.missionId, details: details as EmergencyDetails }
  }, [])
  const control = useCallback(async (id: string, action: { paused?: boolean; speed?: number }) => {
    await post(`/api/missions/${encodeURIComponent(id)}/control`, action)
  }, [])
  return { network, connected, connectionError, submit, control }
}
