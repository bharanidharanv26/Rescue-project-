import type { Server } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'

// The browser sends mono PCM only. Credentials and provider configuration stay here.
export function attachSpeech(server: Server, connect = (url: string, options: WebSocket.ClientOptions) => new WebSocket(url, options)) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url || '/', 'http://localhost').pathname !== '/api/speech') { socket.destroy(); return }
    const origin = request.headers.origin
    if (origin && new URL(origin).host !== request.headers.host) { socket.destroy(); return }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client))
  })
  sockets.on('connection', (client) => {
    let upstream: WebSocket | undefined
    let ready = false
    let ended = false
    let configured = false
    let finalised = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    const send = (value: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)) }
    const fail = (message: string) => { send({ type: 'error', message }); client.close(); upstream?.close() }
    if (!process.env.MISTRAL_API_KEY) { fail('Mistral is not configured. Set MISTRAL_API_KEY in .env and restart the server.'); return }
    deadline = setTimeout(() => fail('Mistral speech connection timed out. Please try again.'), 20000)
    client.on('message', (data, binary) => {
      if (binary) {
        if (!ready || ended || !upstream) return
        if (upstream.bufferedAmount > 2_000_000) { fail('Speech connection is too slow. Please start a new call.'); return }
        upstream.send(JSON.stringify({ type: 'input_audio.append', audio: data.toString('base64') }))
        return
      }
      try {
        const event = JSON.parse(data.toString())
        if (event.type === 'start' && !configured) {
          configured = true
          const rate = Number(event.sampleRate)
          if (![16000, 24000, 44100, 48000].includes(rate)) { fail('Unsupported microphone sample rate.'); return }
          const language = event.language === 'ta' ? 'ta' : 'en'
          upstream = connect(`wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(process.env.MISTRAL_TRANSCRIPTION_MODEL || 'voxtral-mini-transcribe-realtime-3')}`, {
            headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` }, handshakeTimeout: 15000,
          })
          upstream.on('message', (raw) => {
            try {
              const message = JSON.parse(raw.toString())
              if (message.type === 'session.created') upstream?.send(JSON.stringify({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: rate }, target_streaming_delay_ms: 480, language } }))
              if (message.type === 'session.updated') { ready = true; clearTimeout(deadline); send({ type: 'ready' }) }
              if (message.type === 'transcription.text.delta') send({ type: 'delta', text: message.text })
              if (message.type === 'transcription.done') { finalised = true; clearTimeout(deadline); send({ type: 'done', text: message.text }); upstream?.close() }
              if (message.type === 'error') fail(message.error?.message || 'Mistral could not transcribe this call.')
            } catch { fail('Invalid response from the speech provider.') }
          })
          upstream.on('error', () => fail('Could not connect to Mistral speech. Check the API key, model access and internet connection.'))
          upstream.on('close', () => { if (!finalised && client.readyState === WebSocket.OPEN) fail('Speech connection ended before the transcript was finalised. Please retry the call.') })
        } else if (event.type === 'stop' && ready && !ended) {
          ended = true
          upstream?.send(JSON.stringify({ type: 'input_audio.end' }))
          deadline = setTimeout(() => fail('Mistral did not finalise the transcript. The partial text is preserved.'), 25000)
        }
      } catch { fail('Invalid speech message.') }
    })
    client.on('error', () => upstream?.close())
    client.on('close', () => { clearTimeout(deadline); upstream?.close() })
  })
  return sockets
}
