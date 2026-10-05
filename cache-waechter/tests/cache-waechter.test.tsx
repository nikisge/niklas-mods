import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt' } as const
const BAND_PROPS = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10, contentRows: 0 } }) as never

describe('cache-waechter', () => {
  test('zählt den Cache runter, warnt kurz vor Ablauf und zeigt Limits', async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
    const toasts: string[] = []
    const sounds: string[] = []
    const prompts: string[] = []
    mock.store(on)
    on('session.id', () => ({ value: 's1' }) as never)
    on('audio.play', ($, e) => {
      sounds.push(String((e.clip as { asset?: string }).asset))
      return { value: undefined } as never
    })
    on('prompt.submit', ($, e) => {
      prompts.push(e.text)
      return { text: e.text }
    })
    on('ui.toast', ($, e) => {
      toasts.push(String((e as { text: string }).text))
      return { value: undefined } as never
    })
    // Unter dem Mod zeichnet ein anderer Mod (wie Next Steps) seine eigene Zeile.
    let other = false
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      if (!other) return <Box />
      return <Text key="next-steps">next: 1: Tests laufen lassen</Text>
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 68_400, window: 200_000, percent: 34 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 52, resetsAt: '2026-10-03T14:13:00Z' },
          { kind: 'seven_day', percentUsed: 18.4 },
        ],
        cost: { usd: 4.12 },
      },
    }))

    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true } as never)
    await $.turn.start({ text: 'hallo', turnId: 't1' })
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'cache-waechter', surface, ...BAND, props: BAND_PROPS(160) })
      expect((await ui.find({ type: 'Text', text: /warm, noch 60 min/ }))?.text).toContain('60 min')
      expect((await ui.find({ type: 'Text', text: /34%/ })), 'check 1').toBeDefined()
      expect((await ui.find({ type: 'Text', text: /68\.4k\/200k/ })), 'check 2').toBeDefined()
      expect((await ui.find({ type: 'Text', text: /Reset in 2 h 13 min/ })), 'check 3').toBeDefined()
      expect((await ui.find({ type: 'Text', text: /\$4\.12/ })), 'check 4').toBeDefined()
      await ui.unmount()
    }

    // 56 Minuten später: rot, Warnung, Komprimieren-Knopf.
    await clock.advance(56 * 60_000)
    expect(toasts.some(t => t.includes('Cache läuft in'))).toBe(true)
    expect(sounds).toEqual(['sounds/warnung.wav'])
    const ui = await $.ui.mount({ plugin: 'cache-waechter', surface: 'terminal', ...BAND, props: BAND_PROPS(90) })
    expect((await ui.find({ type: 'Text', text: /warm, noch 4 min/ })), 'check 5').toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'compact' })), 'check 6').toBeDefined()
    expect((await ui.find({ type: 'Text', text: /⚠ Cache läuft in 4 min ab/ })), 'check 6a').toBeDefined()
    await ui.press({ key: 'warm' })
    expect(prompts.some(t => t.includes('Cache warm'))).toBe(true)

    // Ein anderer Mod zeichnet auch: beide Zeilen stehen untereinander.
    other = true
    const both = await $.ui.mount({ plugin: 'cache-waechter', surface: 'terminal', ...BAND, props: BAND_PROPS(160) })
    expect(await both.find({ type: 'Text', text: /next: 1: Tests laufen lassen/ }), 'check 8').toBeDefined()
    expect(await both.find({ type: 'Text', text: /warm, noch 4 min/ }), 'check 9').toBeDefined()
    other = false

    // Nach einer Stunde: kalt.
    await clock.advance(5 * 60_000)
    expect((await ui.find({ type: 'Text', text: /kalt/ })), 'check 7').toBeDefined()
  })
})
