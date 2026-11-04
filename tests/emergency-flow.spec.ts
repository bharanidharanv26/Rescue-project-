import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ request }) => { await request.post('/api/test/reset') })

async function speechFixture(page: Page, live: string, final = live) {
  let audioBytes = 0
  await page.routeWebSocket('**/api/speech', (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') { audioBytes += message.length; return }
      const event = JSON.parse(message)
      if (event.type === 'start') { socket.send(JSON.stringify({ type: 'ready' })); socket.send(JSON.stringify({ type: 'delta', text: live })) }
      if (event.type === 'stop') setTimeout(() => socket.send(JSON.stringify({ type: 'done', text: final })), 180)
    })
  })
  return () => audioBytes
}

test('microphone PCM pipeline preserves final words and connects all treatment stages', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const live = 'A road accident at Anna Nagar. Two people are injured.'
  const final = `${live} One is unconscious. My contact number is 9876543210.`
  const audioBytes = await speechFixture(page, live, final)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Help starts with your voice.' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('public-page.png'), fullPage: true })
  await page.getByRole('button', { name: 'CALL EMERGENCY', exact: true }).click()
  await expect(page.getByRole('log')).toHaveText(live)
  await expect.poll(audioBytes).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'STOP CALL', exact: true }).click()
  await expect(page.getByRole('log')).toHaveText(final)
  await expect(page.getByText('2 people reported', { exact: true })).toBeVisible()
  await expect(page.getByText('9876543210', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Follow emergency response' }).click()
  await expect(page).toHaveURL(/\/simulation$/)
  await page.getByRole('button', { name: 'Pause selected mission' }).click()
  await expect(page.getByText('SELECTED MISSION PAUSED', { exact: true })).toBeVisible()
  const elapsed = await page.locator('.elapsed-time').innerText()
  await page.waitForTimeout(500)
  expect(await page.locator('.elapsed-time').innerText()).toBe(elapsed)
  await expect(page.locator('.assigned-resource')).toHaveCount(2)
  await page.locator('.notification-details summary').first().click()
  await expect(page.locator('.notification-details').first()).toContainText('9876543210')
  await page.screenshot({ path: testInfo.outputPath('simulation-page.png'), fullPage: true })
  await page.getByRole('button', { name: '4×', exact: true }).click()
  await page.getByRole('button', { name: 'Resume selected mission' }).click()
  await expect(page.getByText('EMERGENCY SIMULATION COMPLETED', { exact: true })).toBeVisible({ timeout: 50000 })
  await expect(page.getByText('All 9 stages complete')).toBeVisible()
  await page.getByRole('button', { name: /Response activity/ }).click()
  await expect(page.locator('#response-log')).toContainText('Handover acknowledged')
  await page.reload()
  await expect(page.getByText('EMERGENCY SIMULATION COMPLETED', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('25-person bus accident, fire, flood and medical missions share a conflict-free network', async ({ page, request }, testInfo) => {
  for (const transcript of ['A bus accident at Anna Nagar. 25 people injured. Two are unconscious.', 'A fire at Guindy. Three people have burns.', 'Flood at Velachery. 20 people trapped. No injuries.', 'My father has chest pain at T Nagar.']) {
    const response = await request.post('/api/missions', { data: { transcript, requestId: crypto.randomUUID() } })
    expect(response.ok()).toBe(true)
  }
  const state = await (await request.get('/api/state')).json()
  const bus = state.missions[0]
  expect(bus.assignments.filter((unit: { kind: string }) => unit.kind === 'ambulance')).toHaveLength(25)
  expect(bus.hospitals.length).toBeGreaterThan(1)
  const ids = state.missions.flatMap((mission: { assignments: { resourceId: string }[] }) => mission.assignments.map((unit) => unit.resourceId))
  expect(new Set(ids).size).toBe(ids.length)
  for (const mission of state.missions) await request.post(`/api/missions/${mission.id}/control`, { data: { paused: true } })
  await page.goto('/simulation')
  await expect(page.getByRole('tab')).toHaveCount(4)
  await page.getByRole('tab').first().click()
  await expect(page.locator('.assigned-resource')).toHaveCount(30)
  await page.getByRole('button', { name: 'Show all active missions and resources' }).click()
  const available = page.locator('.network-map-marker.resource-available[title*="Available"]').first()
  await available.press('Enter')
  await expect(page.locator('.resource-map-popup')).toContainText('Available for capability-matched dispatch')
  await page.screenshot({ path: testInfo.outputPath('multi-emergency.png'), fullPage: true })
})

test('Tamil transcript and offline map fit a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort())
  await speechFixture(page, 'சென்னை வேளச்சேரியில் மழையால் வெள்ளம் வந்துள்ளது. ஐந்து பேர் மாடியில் சிக்கி உள்ளனர். உடனே உதவி வேண்டும்.')
  await page.goto('/')
  await page.getByRole('button', { name: 'CALL EMERGENCY', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('வெள்ளம்')
  await page.getByRole('button', { name: 'STOP CALL', exact: true }).click()
  await expect(page.getByText('5 people reported')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('public-mobile.png'), fullPage: true })
  await page.getByRole('link', { name: 'Follow emergency response' }).click()
  await page.getByRole('button', { name: 'Pause selected mission' }).click()
  await expect(page.getByText('Offline schematic', { exact: true })).toBeAttached()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('simulation-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Expand map', exact: true }).click()
  await expect(page.locator('.expanded-map')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.expanded-map')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('SELECTED MISSION PAUSED', { exact: true })).toBeVisible()
})

test('missing credentials and microphone denial never fabricate speech or dispatch', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'CALL EMERGENCY', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('MISTRAL_API_KEY')
  expect((await (await request.get('/api/state')).json()).missions).toHaveLength(0)
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') } })
  await page.reload()
  await page.getByRole('button', { name: 'CALL EMERGENCY', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Microphone access was denied')
  await expect(page.getByRole('log')).toHaveText('Your actual spoken words will appear here as you speak.')
})

test('stopping during provider connection still drains buffered audio and finalises', async ({ page }) => {
  let started = false
  let audioBytes = 0
  await page.routeWebSocket('**/api/speech', (socket) => {
    socket.onMessage((raw) => {
      if (typeof raw !== 'string') { audioBytes += raw.length; return }
      const message = JSON.parse(raw)
      if (message.type === 'start') {
        started = true
        setTimeout(() => socket.send(JSON.stringify({ type: 'ready' })), 1300)
      }
      if (message.type === 'stop') socket.send(JSON.stringify({ type: 'done', text: 'My father has chest pain at Anna Nagar.' }))
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CALL EMERGENCY', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: 'STOP CALL', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Follow emergency response' })).toBeVisible()
  expect(audioBytes).toBeGreaterThan(0)
  await expect(page.getByRole('log')).toContainText('chest pain')
})
