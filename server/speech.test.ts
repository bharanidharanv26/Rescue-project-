import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachSpeech } from './speech'

afterEach(() => vi.unstubAllEnvs())

describe('Mistral realtime proxy contract', () => {
  it('keeps the key server-side, configures PCM, forwards audio and waits for the complete transcript', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'test-secret-not-for-browser')
    const provider = new WebSocketServer({ port: 0 })
    await once(provider, 'listening')
    const providerPort = (provider.address() as AddressInfo).port
    let format: unknown
    let captured = Buffer.alloc(0)
    provider.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'session.created', session: {} }))
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString())
        if (message.type === 'session.update') { format = message.session.audio_format; socket.send(JSON.stringify({ type: 'session.updated' })) }
        if (message.type === 'input_audio.append') {
          captured = Buffer.from(message.audio, 'base64')
          socket.send(JSON.stringify({ type: 'transcription.text.delta', text: 'Anna Nagar accident.' }))
        }
        if (message.type === 'input_audio.end') socket.send(JSON.stringify({ type: 'transcription.done', text: 'Anna Nagar accident. Two injured.' }))
      })
    })
    const server = createServer()
    const connect = vi.fn((url: string, options: WebSocket.ClientOptions) => {
      expect(url).toContain('wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=')
      expect(options.headers?.Authorization).toBe('Bearer test-secret-not-for-browser')
      return new WebSocket(`ws://127.0.0.1:${providerPort}`)
    })
    const proxy = attachSpeech(server, connect)
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/speech`)
    const messages: { type: string; text?: string }[] = []
    client.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
    try {
      await once(client, 'open')
      client.send(JSON.stringify({ type: 'start', sampleRate: 24000 }))
      await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('ready'))
      client.send(Buffer.from([0, 0, 128, 255, 255, 127]))
      await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('delta'))
      client.send(JSON.stringify({ type: 'stop' }))
      await vi.waitFor(() => expect(messages.at(-1)).toEqual({ type: 'done', text: 'Anna Nagar accident. Two injured.' }))
      expect(format).toEqual({ encoding: 'pcm_s16le', sample_rate: 24000 })
      expect([...captured]).toEqual([0, 0, 128, 255, 255, 127])
      expect(JSON.stringify(messages)).not.toContain('test-secret')
    } finally {
      client.terminate()
      for (const socket of proxy.clients) socket.terminate()
      for (const socket of provider.clients) socket.terminate()
      proxy.close(); provider.close(); server.close()
    }
  })
})
