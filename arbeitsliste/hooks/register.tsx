// Arbeitsliste: ein eigenes To-do-Feld neben dem Chat. /todo springt hinein,
// du tippst Aufgaben ein, während Claude arbeitet, getrennt von normalen
// Nachrichten. Ist Claude fertig, nimmt es sich das nächste To-do selbst:
// ein To-do = ein eigener Turn. Darüber siehst du live Claudes eigenen Plan.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ArbeitslisteAktuell, ArbeitslisteTodo, ArbeitslistePlanItem } from '../types'

const PANE = 'arbeitsliste'
const TITLE = 'Arbeitsliste'

const queue = atom({ plugin: 'arbeitsliste', key: 'queue' } as const, [] as ArbeitslisteTodo[])
const plan = atom({ plugin: 'arbeitsliste', key: 'plan' } as const, [] as ArbeitslistePlanItem[])
const isPaused = atom({ plugin: 'arbeitsliste', key: 'isPaused' } as const, false)
const isWorking = atom({ plugin: 'arbeitsliste', key: 'isWorking' } as const, false)
// Was gerade im To-do-Feld steht. Das Feld bleibt so bei jedem Neuzeichnen stehen und leert sich nach Enter.
const draft = atom({ plugin: 'arbeitsliste', key: 'draft' } as const, '')
// Woran Claude gerade sitzt, was es in diesem Moment tut, und die Uhr für die Laufzeit.
const aktuell = atom({ plugin: 'arbeitsliste', key: 'aktuell' } as const, null as ArbeitslisteAktuell | null)
const activity = atom({ plugin: 'arbeitsliste', key: 'activity' } as const, '')
const now = atom({ plugin: 'arbeitsliste', key: 'now' } as const, 0)

const MARK = { offen: '○', laeuft: '▶', erledigt: '✓', pending: '○', in_progress: '▶', completed: '✓' } as const
const ACCENT = '#d97757'

// Damit Claude seinen Plan als Aufgabenliste anlegt und er im Panel erscheint.
const PLAN_HINT =
  'Der Nutzer sieht deinen Fortschritt live in einem Arbeitslisten-Panel. Hat die Aufgabe mehr als einen Schritt, lege die Schritte zuerst als Aufgabenliste an (TaskCreate bzw. TodoWrite) und hake sie beim Arbeiten ab.'

async function storeKey($: EngineInterface): Promise<string> {
  return `queue:${await $.session.cwd()}`
}

async function saveQueue($: EngineInterface, list: ArbeitslisteTodo[]): Promise<void> {
  await update($, queue, () => list)
  await $.store.set(await storeKey($), list)
}

function promptFor(todo: ArbeitslisteTodo, list: ArbeitslisteTodo[]): string {
  const nr = list.findIndex(one => one.id === todo.id) + 1
  return `[Arbeitsliste ${nr}/${list.length}] ${todo.text}`
}

// Startet das nächste offene To-do als eigenen Turn, sobald Claude frei ist.
async function startNext($: EngineInterface): Promise<void> {
  if ((await read($, isPaused)) || (await read($, isWorking))) return
  const list = await read($, queue)
  if (list.some(one => one.status === 'laeuft')) return
  const next = list.find(one => one.status === 'offen')
  if (!next) return
  const updated = list.map(one => (one.id === next.id ? { ...one, status: 'laeuft' as const } : one))
  await saveQueue($, updated)
  void $.prompt.submit({ text: promptFor(next, updated) })
}

async function addTodo($: EngineInterface, text: string): Promise<number> {
  const list = await read($, queue)
  const todo: ArbeitslisteTodo = { id: `t${(await $.clock.now()).toString(36)}-${list.length}`, text, status: 'offen' }
  const updated = [...list, todo]
  await saveQueue($, updated)
  // Nicht direkt aus dem Befehl heraus starten: der Befehl hält seinen eigenen
  // Turn, ein Prompt von hier würde auf ihn warten. Kurz danach ist er frei.
  $.clock.after(50, () => void startNext($))
  return updated.filter(one => one.status !== 'erledigt').length
}

// Was Claude gerade tut, in ein paar Worten, aus dem Werkzeugaufruf.
const VERB: Record<string, string> = {
  Read: 'liest',
  Edit: 'ändert',
  Write: 'schreibt',
  NotebookEdit: 'ändert',
  Bash: 'Befehl:',
  Grep: 'sucht',
  Glob: 'sucht Dateien',
  WebFetch: 'öffnet',
  WebSearch: 'recherchiert',
  Agent: 'Helfer:',
  Skill: 'nutzt Skill',
  TaskCreate: 'plant',
  TaskUpdate: 'hakt ab',
  TodoWrite: 'plant',
}

function describeTool(tool: string, input: Record<string, unknown>): string {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const file = text('file_path') || text('notebook_path')
  const what = file
    ? (file.split('/').pop() ?? file)
    : text('description') || text('subject') || text('pattern') || text('query') || text('url') || text('skill') || text('command')
  const verb = VERB[tool] ?? (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)
  return `${verb} ${what}`.trim().split('\n')[0] ?? ''
}

function clockText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Die Laufzeit-Uhr tickt nur, solange Claude arbeitet.
let ticker: Timer | null = null

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

async function startTicker($: EngineInterface) {
  await update($, now, () => 0)
  const tick = async () => {
    const t = await $.clock.now()
    await update($, now, () => t)
  }
  await tick()
  if (!ticker) ticker = $.clock.every(1000, () => void tick())
}

function bar(done: number, total: number, width: number): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'todo',
      description: 'Arbeitsliste: ins To-do-Feld springen, oder direkt /todo Aufgabe / pause / weiter / leeren',
      argumentHint: '[Aufgabe | pause | weiter | leeren]',
      immediate: true,
    })
    // Eine Liste aus der letzten Session in diesem Ordner wieder aufnehmen,
    // aber pausiert, damit nichts ungefragt losläuft.
    const saved = (await $.store.get(await storeKey($))) as ArbeitslisteTodo[] | undefined
    if (saved && saved.some(one => one.status !== 'erledigt')) {
      const resumed = saved.map(one => (one.status === 'laeuft' ? { ...one, status: 'offen' as const } : one))
      await update($, queue, () => resumed)
      await update($, isPaused, () => true)
    }
    return result
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const args = e.args.trim()
    const word = args.toLowerCase()

    if (word === 'pause') {
      await update($, isPaused, () => true)
      return { text: 'Arbeitsliste pausiert. Mit /todo weiter geht es weiter.' }
    }
    if (word === 'weiter') {
      await update($, isPaused, () => false)
      $.clock.after(50, () => void startNext($))
      return { text: 'Arbeitsliste läuft weiter.' }
    }
    if (word === 'leeren') {
      await saveQueue($, [])
      await update($, plan, () => [])
      return { text: 'Arbeitsliste geleert.' }
    }
    if (args === '') {
      // Panel mit Tastatur öffnen: der Cursor steht sofort im To-do-Feld.
      await $.ui.open({ id: PANE, title: TITLE, focus: true })
      return { text: 'Du bist im To-do-Feld. Aufgabe tippen, Enter, nächste. Esc bringt dich zurück zum Chat.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    const open = await addTodo($, args)
    return { text: `Auf der Liste (${open} offen): ${args}` }
  })

  // Claude soll seinen Plan sichtbar anlegen, damit er oben im Panel erscheint.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer' || e.origin?.kind === 'plugin') {
      return next({ ...e, context: [...(e.context ?? []), PLAN_HINT] })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.text !== '') {
      await update($, isWorking, () => true)
      const running = (await read($, queue)).find(one => one.status === 'laeuft')
      const startedAt = await $.clock.now()
      await update($, aktuell, () =>
        running
          ? { text: running.text, source: 'todo' as const, startedAt }
          : { text: e.text.replace(/^\[Arbeitsliste \d+\/\d+\]\s*/, '').split('\n')[0] ?? '', source: 'chat' as const, startedAt },
      )
      await update($, activity, () => 'denkt nach')
      await startTicker($)
      // Neuer Auftrag: erledigte Schritte vom letzten Plan aufräumen.
      await update($, plan, list => list.filter(one => one.status !== 'completed'))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result

    await update($, isWorking, () => false)
    await update($, aktuell, () => null)
    await update($, activity, () => '')
    stopTicker()
    const list = await read($, queue)
    const current = list.find(one => one.status === 'laeuft')

    if (e.reason !== 'answer') {
      // Abgebrochen oder Fehler: nicht blind weitermachen.
      if (current) {
        await saveQueue($, list.map(one => (one.id === current.id ? { ...one, status: 'offen' as const } : one)))
      }
      if (list.some(one => one.status !== 'erledigt')) {
        await update($, isPaused, () => true)
        $.ui.toast('Arbeitsliste pausiert, weil der Turn nicht sauber fertig wurde. /todo weiter setzt fort.')
      }
      return result
    }

    if (current) {
      await saveQueue($, list.map(one => (one.id === current.id ? { ...one, status: 'erledigt' as const } : one)))
    }
    await startNext($)
    return result
  })

  // Jeder Werkzeugaufruf zeigt live, was Claude gerade tut.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await update($, activity, () => describeTool(e.tool, e as unknown as Record<string, unknown>))
    return next(e)
  })

  // Claudes eigener Plan: das neue Task-System und das ältere TodoWrite.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (!e.agentId && id) {
      const item: ArbeitslistePlanItem = { id, text: e.subject, status: 'pending' }
      await update($, plan, list => [...list.filter(one => one.id !== item.id), item])
      void $.ui.open({ id: PANE, title: TITLE })
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) {
      const status = e.status
      await update($, plan, list =>
        status === 'deleted'
          ? list.filter(one => one.id !== e.taskId)
          : list.map(one =>
              one.id === e.taskId ? { ...one, text: e.subject ?? one.text, status: status ?? one.status } : one,
            ),
      )
    }
    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) {
      await update($, plan, () =>
        e.todos.map((todo, i) => ({ id: `w${i}`, text: todo.content, status: todo.status })),
      )
      void $.ui.open({ id: PANE, title: TITLE })
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // Das Handy hat kein Eingabefeld: dort zeichnet Claude Code selbst.
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Input, Button } = $.ui.resolve(e)
    const steps = await read($, plan)
    const list = await read($, queue)
    const paused = await read($, isPaused)
    const working = await read($, isWorking)
    const typed = await read($, draft)
    const job = await read($, aktuell)
    const doing = await read($, activity)
    const time = await read($, now)
    const width = Math.max(10, Math.min(24, (e.props.bodyColumns ?? 40) - 22))

    const done = steps.filter(one => one.status === 'completed').length
    const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100)
    const waiting = list.filter(one => one.status === 'offen')
    const finished = list.filter(one => one.status === 'erledigt')
    const runningNr = list.findIndex(one => one.status === 'laeuft') + 1

    return (
      <Box flexDirection="column">
        {/* JETZT: woran Claude sitzt und was es in diesem Moment tut */}
        <Box flexDirection="column" borderStyle="round" borderColor={working ? ACCENT : 'gray'} paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold color={working ? ACCENT : 'gray'}>
              {working ? '◆ JETZT' : '◇ Claude ist frei'}
            </Text>
            {working && job && <Text dimColor>{clockText(time - job.startedAt)}</Text>}
          </Box>
          {working && job ? (
            <Box flexDirection="column">
              <Text dimColor>{job.source === 'todo' ? `To-do ${runningNr} von ${list.length}` : 'aus dem Chat'}</Text>
              <Text bold wrap="truncate-end">
                {job.text}
              </Text>
              {doing !== '' && (
                <Text color="yellow" wrap="truncate-end">
                  ↳ {doing}
                </Text>
              )}
            </Box>
          ) : (
            <Text dimColor>
              {waiting.length > 0 && paused ? 'Liste pausiert, Weiter startet das nächste To-do.' : 'Tipp unten ein To-do ein, Claude legt sofort los.'}
            </Text>
          )}
          {steps.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Box justifyContent="space-between">
                <Text>
                  <Text color="green">{bar(done, steps.length, width)}</Text>
                  <Text dimColor>
                    {' '}
                    {done}/{steps.length} Schritte
                  </Text>
                </Text>
                <Text dimColor>{percent}%</Text>
              </Box>
              {steps.map(step => (
                <Text
                  key={`p-${step.id}`}
                  color={step.status === 'in_progress' ? 'cyan' : undefined}
                  bold={step.status === 'in_progress'}
                  dimColor={step.status === 'completed'}
                  strikethrough={step.status === 'completed'}
                  wrap="truncate-end"
                >
                  {MARK[step.status]} {step.text}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        {/* DANACH: deine Warteschlange und das Eingabefeld */}
        <Box flexDirection="column" borderStyle="round" borderColor={e.props.isFocused ? 'cyan' : 'gray'} paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold color="cyan">
              ☰ DANACH
            </Text>
            <Text dimColor>{waiting.length === 0 ? 'nichts wartet' : `${waiting.length} warten`}</Text>
          </Box>
          {paused && <Text color="yellow">⏸ pausiert</Text>}
          {waiting.map((todo, i) => (
            <Text key={`q-${todo.id}`} wrap="truncate-end">
              <Text color="cyan">{i + 1}. </Text>
              {todo.text}
            </Text>
          ))}
          <Input
            key="neu"
            autoFocus
            value={typed}
            label="+ "
            placeholder="neues To-do, Enter"
            submitLabel="einreihen"
            onInput={value => void update($, draft, () => value)}
            onSubmit={async value => {
              const text = value.trim()
              await update($, draft, () => '')
              if (text !== '') await addTodo($, text)
            }}
          />
          {finished.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {finished.slice(-3).map(todo => (
                <Text key={`d-${todo.id}`} dimColor strikethrough wrap="truncate-end">
                  ✓ {todo.text}
                </Text>
              ))}
              {finished.length > 3 && <Text dimColor>  und {finished.length - 3} weitere erledigt</Text>}
            </Box>
          )}
        </Box>

        <Box justifyContent="space-between">
          <Text dimColor wrap="truncate-end">
            {e.props.isFocused ? '✎ Du tippst To-dos · Esc = Chat' : '✎ /todo = ins Feld'}
          </Text>
          <Box>
            <Button
              key="pause"
              plain
              label={paused ? '▶ Weiter' : '⏸ Pause'}
              onPress={async () => {
                await update($, isPaused, (value: boolean) => !value)
                await startNext($)
              }}
            />
            {finished.length > 0 && <Text> </Text>}
            {finished.length > 0 && (
              <Button
                key="aufraeumen"
                plain
                label="Erledigte weg"
                onPress={async () => {
                  await saveQueue($, (await read($, queue)).filter(one => one.status !== 'erledigt'))
                }}
              />
            )}
          </Box>
        </Box>
      </Box>
    )
  })
}
