import { describe, expect, test } from 'claude-code/testing'

const SPINNER = { component: 'Spinner', requestId: 'main' } as const
const SPINNER_PROPS = { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' } as never

describe('peitsche', () => {
  test('knallt mitten im Turn: Claude bekommt die Notiz, der Spinner ändert sich', async ($, on) => {
    const notes: string[] = []
    const played: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.toast', () => ({ value: undefined }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('audio.play', ($, e) => {
      played.push(JSON.stringify(e))
      return { value: undefined } as never
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.message ?? e.props.word}</Text>
    })

    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true } as never)

    // Ohne laufenden Turn: nur Knall, keine Notiz.
    const idle = await $.command.run({ command: 'peitsche', args: '' } as never)
    expect(idle.text).toContain('ins Leere')
    expect(notes).toHaveLength(0)

    await $.turn.start({ text: 'baue die Login-Seite', turnId: 't1' })
    const first = await $.command.run({ command: 'peitsche', args: '' } as never)
    await $.command.run({ command: 'peitsche', args: '' } as never)
    expect(first.text).toContain('Nummer 1')
    // Claudes nächster Tool-Aufruf bringt die Notiz mit, danach ist sie weg.
    const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' } as never)
    notes.push(...(ran.context ?? []))
    const again = await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' } as never)
    expect(again.context ?? []).toHaveLength(0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('zum 2. Mal')
    expect(played).toHaveLength(3)
    expect(played[0]).toContain('sounds/peitsche.wav')

    const ui = await $.ui.mount({ plugin: 'peitsche', surface: 'terminal', ...SPINNER, props: SPINNER_PROPS })
    expect((await ui.find({ type: 'Text', text: /Schuftet unter der Peitsche \(2×\)/ }))?.text).toContain('2×')

    await ui.unmount()

    // Neuer Auftrag: Zähler zurück, normaler Spinner.
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.start({ text: 'nächste Aufgabe', turnId: 't2' })
    const fresh = await $.ui.mount({ plugin: 'peitsche', surface: 'terminal', ...SPINNER, props: SPINNER_PROPS })
    expect((await fresh.find({ type: 'Text', text: /Sauteing/ }))?.text).toBe('Sauteing')
  })

  const PANE = { component: 'Pane', requestId: 'peitsche' } as const
  const PANE_PROPS = {
    title: 'Peitsche',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20, contentRows: 0 },
    view: { isAtBottom: true },
  } as never

  test('Peitschen-Feld: Schwung knallt, Treffer auf Clawd zählen nur bei der Arbeit', async ($, on) => {
    const played: string[] = []
    const notes: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('audio.play', ($, e) => {
      played.push(JSON.stringify(e))
      return { value: undefined } as never
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true } as never)

    // Feld auf beiden Oberflächen mit Clawd, ohne Knall beim Öffnen.
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'peitsche', surface, ...PANE, props: PANE_PROPS })
      await ui.resize({ columns: 56, rows: 14, in: 'feld' })
      await ui.advance(800)
      expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/, in: 'feld' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Claude hat Pause/, in: 'feld' })).toBeDefined()
      await ui.unmount()
    }
    expect(played).toHaveLength(0)

    // Pause: Treffer knallt, zählt aber nicht.
    const idle = await $.ui.mount({ plugin: 'peitsche', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await idle.post({ type: 'knall', treffer: true }, { in: 'feld' })
    expect(played).toHaveLength(1)
    await idle.unmount()

    // Claude arbeitet: echter Schwung mit der Maus über Clawd.
    await $.turn.start({ text: 'baue Dark Mode', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'peitsche', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await ui.resize({ columns: 56, rows: 14, in: 'feld' })
    await ui.pointer({ type: 'down', x: 38, y: 1, button: 'left' })
    await ui.advance(1500)
    for (const [x, y] of [[46, 1], [54, 1]] as const) {
      await ui.pointer({ type: 'move', x, y, button: 'left' })
      await ui.advance(33)
    }
    await ui.advance(300)
    expect(played.length).toBeGreaterThan(1)
    expect((await ui.find({ type: 'Text', text: /Hiebe: [1-9]/, in: 'feld' }))?.text).toContain('Hiebe')

    // Claude bekommt die Ansage mit dem nächsten Tool-Ergebnis.
    const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' } as never)
    notes.push(...(ran.context ?? []))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('Peitsche')

    // Ohne Maus: H-Taste springt in Schlagposition und trifft Clawd.
    const hitsBefore = Number((await ui.find({ type: 'Text', text: /Hiebe: \d+/, in: 'feld' }))?.text.match(/\d+/)?.[0] ?? 0)
    for (let i = 0; i < 3; i++) {
      await ui.press({ key: 'hieb' })
      await ui.advance(1200)
    }
    const hitsAfter = Number((await ui.find({ type: 'Text', text: /Hiebe: \d+/, in: 'feld' }))?.text.match(/\d+/)?.[0] ?? 0)
    expect(hitsAfter).toBeGreaterThan(hitsBefore)

    // Unsinn aus dem Feld wird ignoriert.
    const before = played.length
    await ui.post({ type: 'unsinn' }, { in: 'feld' })
    expect(played).toHaveLength(before)
    await ui.unmount()
  })
})
