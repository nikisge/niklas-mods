import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'snake' } as const
const PANE_PROPS = {
  title: 'Snake',
  isFocused: true,
  bodyColumns: 60,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20, contentRows: 0 },
  view: { isAtBottom: true },
} as never

function flat(n: unknown): string {
  if (typeof n === 'string') return n
  if (!n || typeof n !== 'object') return ''
  const node = n as { children?: unknown; props?: { children?: unknown } }
  const ch = node.children ?? node.props?.children ?? []
  return (Array.isArray(ch) ? ch : [ch]).map(flat).join('')
}

describe('snake', () => {
  test('spielt mit WASD, frisst nicht sich selbst, endet an der Wand', async ($, on) => {
    const clock = mock.clock(on, { now: 42_000 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    // Ein kleines Fenster-Verzeichnis: was offen ist, was zu.
    const open = new Set<string>()
    let escapeCloses = false
    on('ui.open', ($, e) => {
      open.add(e.id)
      escapeCloses = e.closeOnEscape === true
      return { value: { isPlaced: true } } as never
    })
    on('ui.close', ($, e) => {
      open.delete(e.id)
      return { value: undefined } as never
    })
    on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }) as never)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true } as never)

    await $.turn.start({ text: 'baue Dark Mode', turnId: 't1' })
    const out = await $.command.run({ command: 'snake', args: '' } as never)
    expect(out.text).toContain('W/A/S/D')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'snake', surface, ...PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /Los gehts/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Claude arbeitet/ })).toBeDefined()
      // Desktop: das Feld ist eine Grafik, im Terminal Textzeilen.
      expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(surface === 'desktop')
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...PANE, props: PANE_PROPS })
    // Rückwärts in sich selbst (links) ist gesperrt, hoch startet.
    await ui.press({ key: 'links' })
    await clock.advance(130)
    await ui.press({ key: 'hoch' })
    await clock.advance(130 * 3)
    expect(flat(await ui.drawn())).toContain('██')
    expect(await ui.find({ type: 'Text', text: /Game over/ })).toBeUndefined()

    expect(escapeCloses).toBe(true)

    // Claude wird fertig: Panel geht zu, Spiel bleibt pausiert stehen.
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(open.has('snake')).toBe(false)
    expect(await ui.find({ type: 'Text', text: /Pause/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude ist fertig/ })).toBeDefined()

    // /snake öffnet wieder, nochmal /snake schließt, Q schließt auch.
    await $.command.run({ command: 'snake', args: '' } as never)
    expect(open.has('snake')).toBe(true)
    const closed = await $.command.run({ command: 'snake', args: '' } as never)
    expect(closed.text).toContain('Snake zu')
    expect(open.has('snake')).toBe(false)
    await $.command.run({ command: 'snake', args: '' } as never)
    await ui.press({ key: 'zu' })
    expect(open.has('snake')).toBe(false)

    // Weiter mit P, dann geradeaus in die obere Wand.
    await ui.press({ key: 'pause' })
    await clock.advance(130 * 15)
    expect(await ui.find({ type: 'Text', text: /Game over/ })).toBeDefined()

    // N startet neu.
    await ui.press({ key: 'neu' })
    expect(await ui.find({ type: 'Text', text: /Los gehts/ })).toBeDefined()
    await ui.unmount()
  })
})
