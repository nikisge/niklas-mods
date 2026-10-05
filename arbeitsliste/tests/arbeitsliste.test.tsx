import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'arbeitsliste' } as const
const PANE_PROPS = {
  title: 'Arbeitsliste',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30, contentRows: 0 },
  view: { isAtBottom: true },
} as never

describe('arbeitsliste', () => {
  test('To-dos laufen nacheinander, eins pro Turn', async ($, on) => {
    const submitted: string[] = []
    const clock = mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/tmp/demo-projekt' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text' } }) as never)

    await $.session.start({ cwd: '/tmp/demo-projekt', surface: 'terminal', isInteractive: true } as never)

    // Erstes To-do bei freiem Claude: startet sofort.
    await $.command.run({ command: 'todo', args: 'Login-Seite bauen' } as never)
    await clock.advance(100)
    // Zweites To-do, während Claude arbeitet: wartet.
    await $.turn.start({ text: submitted[0] ?? '', turnId: 't1' })
    await $.command.run({ command: 'todo', args: 'Dark Mode einbauen' } as never)
    await clock.advance(100)
    expect(submitted).toEqual(['[Arbeitsliste 1/1] Login-Seite bauen'])

    // Turn fertig: Nummer 1 abgehakt, Nummer 2 geht los.
    await $.turn.complete({ answer: 'fertig', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(submitted).toEqual(['[Arbeitsliste 1/1] Login-Seite bauen', '[Arbeitsliste 2/2] Dark Mode einbauen'])

    // Oben steht, woran Claude gerade sitzt, und was es in diesem Moment tut.
    await $.turn.start({ text: submitted[1] ?? '', turnId: 't2' })
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/tmp/demo-projekt/src/theme.css' } as never)
    await clock.advance(3_000)
    const live = await $.ui.mount({ plugin: 'arbeitsliste', surface: 'terminal', ...PANE, props: PANE_PROPS })
    expect((await live.find({ type: 'Text', text: /^Dark Mode einbauen$/ }))?.text).toBe('Dark Mode einbauen')
    expect((await live.find({ type: 'Text', text: /To-do 2 von 2/ }))?.text).toBeDefined()
    expect((await live.find({ type: 'Text', text: /liest theme\.css/ }))?.text).toContain('theme.css')
    expect((await live.find({ type: 'Text', text: /^0:0[34]$/ }))?.text).toBeDefined()
    await live.unmount()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'arbeitsliste', surface, ...PANE, props: PANE_PROPS })
      expect((await ui.find({ type: 'Text', text: /✓ Login-Seite bauen/ }))?.text).toContain('Login-Seite')
      await ui.unmount()
    }
  })

  test('Abbruch pausiert die Liste statt blind weiterzumachen', async ($, on) => {
    const submitted: string[] = []
    const clock = mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/tmp/demo-abbruch' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))

    await $.session.start({ cwd: '/tmp/demo-abbruch', surface: 'terminal', isInteractive: true } as never)
    await $.command.run({ command: 'todo', args: 'Aufgabe A' } as never)
    await clock.advance(100)
    await $.command.run({ command: 'todo', args: 'Aufgabe B' } as never)
    await clock.advance(100)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    expect(submitted).toEqual(['[Arbeitsliste 1/1] Aufgabe A'])

    await $.command.run({ command: 'todo', args: 'weiter' } as never)
    await clock.advance(100)
    expect(submitted[1]).toBe('[Arbeitsliste 1/2] Aufgabe A')
  })

  test('Claudes Plan erscheint mit Fortschritt', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 })
    mock.store(on)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/tmp/demo-plan' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }) as never)

    await $.session.start({ cwd: '/tmp/demo-plan', surface: 'terminal', isInteractive: true } as never)
    await $.tool.call({
      tool: 'TodoWrite',
      tool_use_id: 'u1',
      todos: [
        { content: 'Struktur lesen', status: 'completed', activeForm: 'Lese Struktur' },
        { content: 'Tests schreiben', status: 'in_progress', activeForm: 'Schreibe Tests' },
        { content: 'Doku', status: 'pending', activeForm: 'Schreibe Doku' },
        { content: 'Commit', status: 'pending', activeForm: 'Committe' },
      ],
    } as never)

    const ui = await $.ui.mount({ plugin: 'arbeitsliste', surface: 'terminal', ...PANE, props: PANE_PROPS })
    expect((await ui.find({ type: 'Text', text: /^25%$/ }))?.text).toBe('25%')
    expect((await ui.find({ type: 'Text', text: /▶ Tests schreiben/ }))?.text).toContain('Tests')
  })

  test('To-dos kommen übers Feld, normale Nachrichten bleiben normal', async ($, on) => {
    const submitted: string[] = []
    const reached: string[] = []
    const opened: unknown[] = []
    const clock = mock.clock(on, { now: 5_000 })
    mock.store(on)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/tmp/demo-feld' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      opened.push(e)
      return { value: { isPlaced: true } } as never
    })
    on('prompt.submit', ($, e) => {
      reached.push(e.text)
      if (e.text.startsWith('[Arbeitsliste')) submitted.push(e.text)
      return { text: e.text, context: e.context }
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/tmp/demo-feld', surface: 'terminal', isInteractive: true } as never)

    // /todo öffnet das Panel mit Tastatur, der Cursor steht im Feld.
    await $.command.run({ command: 'todo', args: '' } as never)
    expect(JSON.stringify(opened)).toContain('"focus":true')

    // Claude arbeitet. Eine normale Nachricht geht ganz normal an Claude.
    await $.turn.start({ text: 'Bau eine Suche ein', turnId: 't1' })
    const normal = await $.prompt.submit({ text: 'nimm lieber Variante B', asUser: true, turnId: 't1', origin: { kind: 'composer' } } as never)
    expect(normal.drop).toBeUndefined()
    expect(reached).toContain('nimm lieber Variante B')

    // Ins To-do-Feld getippt: landet in der Liste und wartet, bis Claude frei ist.
    const ui = await $.ui.mount({ plugin: 'arbeitsliste', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await ui.input({ key: 'neu', text: 'LinkedIn-Akquise checken' })
    await clock.advance(100)
    expect(submitted).toHaveLength(0)
    expect((await ui.find({ type: 'Text', text: /LinkedIn-Akquise checken/ }))?.text).toContain('LinkedIn')

    // Claude fertig: das To-do startet als eigener Turn.
    await $.turn.complete({ answer: 'fertig', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(submitted).toEqual(['[Arbeitsliste 1/1] LinkedIn-Akquise checken'])
    await ui.unmount()
  })
})
