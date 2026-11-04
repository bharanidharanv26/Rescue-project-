import { afterEach, describe, expect, it, vi } from 'vitest'
import { understandCall } from './understanding'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Mistral emergency understanding', () => {
  it('sends the actual transcript and validates separate patient groups', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'test-key')
    const transcript = 'Anna Nagar la bus accident. 25 peru injured, rendu peru unconscious. En number 9876543210.'
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ category: 'Road accident', location: 'Anna Nagar main junction, Chennai', victims: 25, unconscious: 2, conditions: ['Injured', 'Unconscious'], severity: 'Critical', medicalRequired: true, notes: ['Large vehicle involved'], patientGroups: [{ count: 2, conditions: ['Unconscious'] }, { count: 23, conditions: ['Injured'] }] }) } }] }) })
    vi.stubGlobal('fetch', fetcher)
    const details = await understandCall(transcript)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).messages.at(-1).content).toBe(transcript)
    expect(details.understanding).toBe('ai')
    expect(details.patientGroups?.map((group) => group.count)).toEqual([2, 23])
    expect(details.location).toContain('main junction')
    expect(details.callerContact).toBe('9876543210')
  })
  it('discloses fallback when the provider returns inconsistent counts', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"victims":-2}' } }] }) }))
    const details = await understandCall('A bus accident at Anna Nagar. 25 people injured.')
    expect(details.understanding).toBe('local')
    expect(details.victims).toBe(25)
    expect(details.extractionNote).toContain('Mistral extraction was unavailable')
  })
})
