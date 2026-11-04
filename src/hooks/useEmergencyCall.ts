import { useCallback, useEffect, useRef, useState } from 'react'

export function useEmergencyCall({ language = 'en' }: { language?: 'en' | 'ta' } = {}) {
  const [active, setActive] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [notice, setNotice] = useState('')
  const [seconds, setSeconds] = useState(0)
  const stream = useRef<MediaStream | null>(null)
  const context = useRef<AudioContext | null>(null)
  const source = useRef<MediaStreamAudioSourceNode | null>(null)
  const processor = useRef<AudioWorkletNode | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const generation = useRef(0)
  const running = useRef(false)
  const finishing = useRef(false)
  const text = useRef('')
  const finish = useRef<{ resolve: (text: string) => void; reject: (error: Error) => void } | null>(null)
  const flush = useRef<(() => void) | null>(null)
  const pendingStop = useRef<(() => void) | null>(null)
  const readyRef = useRef(false)

  const releaseAudio = useCallback(() => {
    source.current?.disconnect(); source.current = null
    processor.current?.disconnect(); processor.current = null
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null
    void context.current?.close(); context.current = null
  }, [])
  const cleanup = useCallback(() => {
    generation.current++
    running.current = false
    readyRef.current = false
    pendingStop.current = null
    releaseAudio()
    socket.current?.close(); socket.current = null
  }, [releaseAudio])
  useEffect(() => () => { finish.current?.reject(new Error('Call closed')); finish.current = null; cleanup() }, [cleanup])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [active])

  const start = useCallback(async () => {
    if (running.current) return
    running.current = true; finishing.current = false
    const session = ++generation.current
    setConnecting(true); setNotice(''); setSeconds(0)
    text.current = ''; setTranscript('')
    const fail = (message: string) => {
      if (session !== generation.current) return
      setNotice(message); setActive(false); setConnecting(false)
      finish.current?.reject(new Error(message)); finish.current = null
      cleanup()
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Microphone streaming requires a current browser on HTTPS or localhost.')
      const audio = new AudioContext({ sampleRate: 24000 })
      context.current = audio
      await audio.resume()
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      if (session !== generation.current) { input.getTracks().forEach((track) => track.stop()); return }
      stream.current = input
      await audio.audioWorklet.addModule('/pcm-capture.js')
      if (session !== generation.current) return
      const node = new AudioWorkletNode(audio, 'pcm-capture')
      processor.current = node
      source.current = audio.createMediaStreamSource(input)
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/speech`)
      socket.current = ws
      let ready = false
      const pending: ArrayBuffer[] = []
      node.port.onmessage = ({ data }) => {
        if (data?.flushed) { flush.current?.(); flush.current = null; return }
        if (!(data instanceof ArrayBuffer)) return
        if (ready && ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 2_000_000) { fail('The speech connection is too slow. Please retry the call.'); return }
          ws.send(data)
        } else if (pending.length < 250) pending.push(data)
        else fail('The speech service did not connect. Please retry the call.')
      }
      // Begin capture immediately; preserve audio spoken during provider handshake.
      source.current.connect(node); node.connect(audio.destination)
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', sampleRate: audio.sampleRate, language: language === 'ta' ? 'ta' : 'en' }))
      ws.onmessage = ({ data }) => {
        if (session !== generation.current) return
        try {
          const event = JSON.parse(data)
          if (event.type === 'ready') {
            ready = true; readyRef.current = true
            pending.forEach((chunk) => ws.send(chunk)); pending.length = 0
            setConnecting(false); setActive(true)
            pendingStop.current?.(); pendingStop.current = null
          } else if (event.type === 'delta') {
            text.current += event.text; setTranscript(text.current)
          } else if (event.type === 'done') {
            text.current = typeof event.text === 'string' ? event.text : text.current
            setTranscript(text.current); setActive(false)
            finish.current?.resolve(text.current); finish.current = null
            cleanup()
          } else if (event.type === 'error') fail(event.message)
        } catch { fail('Could not read the speech transcript.') }
      }
      ws.onerror = () => fail('The speech server could not be reached. Check your connection and try again.')
      ws.onclose = () => { if (session === generation.current) fail('The speech connection closed before the call finished. Your partial transcript is shown below.') }
    } catch (error) {
      fail(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow access in your browser and start the call again.' : error instanceof Error ? error.message : 'Unable to open the microphone.')
    }
  }, [cleanup])

  const stop = useCallback(async (): Promise<string> => {
    if (!running.current || finishing.current) throw new Error('No active call to finish.')
    finishing.current = true
    // Disconnect input first, then drain the last PCM frame before input_audio.end.
    source.current?.disconnect()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500)
      flush.current = () => { clearTimeout(timer); resolve() }
      processor.current?.port.postMessage('flush')
    })
    releaseAudio()
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { finish.current = null; cleanup(); setActive(false); reject(new Error('The final transcript timed out. Your partial transcript is preserved.')) }, 30000)
      finish.current = { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } }
      const sendStop = () => socket.current?.send(JSON.stringify({ type: 'stop' }))
      if (!readyRef.current && socket.current) pendingStop.current = sendStop
      else if (socket.current?.readyState === WebSocket.OPEN) sendStop()
      else { finish.current.reject(new Error('Microphone connection was stopped before it opened. Start a new call to try again.')); finish.current = null; cleanup(); setConnecting(false); setActive(false) }
    })
  }, [cleanup, releaseAudio])
  return { active, connecting, transcript, notice, seconds, start, stop }
}
