// Snake: /snake öffnet ein Panel mit Snake, gesteuert mit W/A/S/D. Weg ist es
// genauso schnell: Esc, Q, nochmal /snake, oder von selbst, sobald Claude fertig
// ist. Das Spiel bleibt dabei pausiert stehen, /snake spielt weiter.
// Die Tasten sind Button-Hotkeys des Panels: Die gehen in jedem Terminal,
// ohne Maus und ohne Vollbild.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SnakeClaude, SnakeDir, SnakeGame } from '../types'

const PANE = 'snake'
const TICK_MS = 130
const H = 12

const game = atom({ plugin: 'snake', key: 'game' } as const, null as SnakeGame | null)
const best = atom({ plugin: 'snake', key: 'best' } as const, 0)
const claude = atom({ plugin: 'snake', key: 'claude' } as const, 'idle' as SnakeClaude)

const STEP: Record<SnakeDir, [number, number]> = { hoch: [0, -1], runter: [0, 1], links: [-1, 0], rechts: [1, 0] }
const OPPOSITE: Record<SnakeDir, SnakeDir> = { hoch: 'runter', runter: 'hoch', links: 'rechts', rechts: 'links' }

const HEAD = '#69db7c'
const BODY = '#2f9e44'
const FOOD = '#ff6b6b'

// Kleiner Zufallsgenerator mit Startwert, damit Tests reproduzierbar bleiben.
function nextRandom(seed: number): [number, number] {
  const s = (seed * 1103515245 + 12345) % 2147483648
  return [s, s / 2147483648]
}

function placeFood(g: SnakeGame): SnakeGame {
  let seed = g.seed
  for (let i = 0; i < 200; i++) {
    const [s1, rx] = nextRandom(seed)
    const [s2, ry] = nextRandom(s1)
    seed = s2
    const food: [number, number] = [Math.floor(rx * g.w), Math.floor(ry * g.h)]
    if (!g.snake.some(([x, y]) => x === food[0] && y === food[1])) return { ...g, food, seed }
  }
  return { ...g, seed }
}

function newGame(w: number, seed: number): SnakeGame {
  const y = Math.floor(H / 2)
  const g: SnakeGame = {
    snake: [
      [4, y],
      [3, y],
      [2, y],
    ],
    dir: 'rechts',
    nextDir: 'rechts',
    food: [0, 0],
    score: 0,
    status: 'bereit',
    w,
    h: H,
    seed: seed % 2147483648,
  }
  return placeFood(g)
}

// Ein Schritt: Kopf vor, Futter frisst, Wand oder eigener Körper beendet das Spiel.
export function advance(g: SnakeGame): SnakeGame {
  if (g.status !== 'laeuft') return g
  const dir = g.nextDir
  const [dx, dy] = STEP[dir]
  const head = g.snake[0] ?? [0, 0]
  const next: [number, number] = [head[0] + dx, head[1] + dy]
  const eats = next[0] === g.food[0] && next[1] === g.food[1]
  const body = eats ? g.snake : g.snake.slice(0, -1)
  const hitsWall = next[0] < 0 || next[1] < 0 || next[0] >= g.w || next[1] >= g.h
  const hitsSelf = body.some(([x, y]) => x === next[0] && y === next[1])
  if (hitsWall || hitsSelf) return { ...g, dir, status: 'vorbei' }
  const moved: SnakeGame = { ...g, dir, snake: [next, ...body] }
  return eats ? placeFood({ ...moved, score: g.score + 1 }) : moved
}

// Der laufende Spieltakt. Ein Neuladen des Mods setzt ihn zurück, das Spiel steht dann auf Pause.
let timer: Timer | null = null
let busy = false

function stop() {
  timer?.cancel()
  timer = null
}

async function tick($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    const g = await read($, game)
    if (!g || g.status !== 'laeuft') return stop()
    const after = advance(g)
    await update($, game, () => after)
    if (after.status === 'vorbei') {
      stop()
      if (after.score > (await read($, best))) {
        await update($, best, () => after.score)
        await $.store.set('best', after.score)
      }
    }
  } finally {
    busy = false
  }
}

async function run($: EngineInterface) {
  await update($, game, g => (g && (g.status === 'bereit' || g.status === 'pause') ? { ...g, status: 'laeuft' as const } : g))
  if (!timer) timer = $.clock.every(TICK_MS, () => void tick($))
}

async function pause($: EngineInterface) {
  stop()
  await update($, game, g => (g && g.status === 'laeuft' ? { ...g, status: 'pause' as const } : g))
}

async function steer($: EngineInterface, dir: SnakeDir) {
  const g = await read($, game)
  if (!g || g.status === 'vorbei') return
  if (dir !== OPPOSITE[g.dir]) await update($, game, cur => (cur ? { ...cur, nextDir: dir } : cur))
  // Die erste Richtungstaste startet das Spiel, auch nach einer Pause.
  if (g.status !== 'laeuft') await run($)
}

async function restart($: EngineInterface, w: number) {
  stop()
  const seed = Math.floor(await $.clock.now())
  await update($, game, () => newGame(w, seed))
}


// Die Desktop-App zeichnet Text in einer Schrift, in der Leerzeichen schmaler
// sind als Blöcke: das Textfeld verrutscht dort. Deshalb dort als Grafik.
const CELL = 16

export function fieldSvg(g: SnakeGame): string {
  const w = g.w * CELL
  const h = g.h * CELL
  const cell = (x: number, y: number, color: string) =>
    `<rect x="${x * CELL + 1}" y="${y * CELL + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="3" fill="${color}"/>`
  const parts = [
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="4" fill="#111" stroke="#555"/>`,
    cell(g.food[0], g.food[1], FOOD),
    ...g.snake.map(([x, y], i) => cell(x, y, i === 0 ? HEAD : BODY)),
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'snake', description: 'Snake spielen, während Claude arbeitet (W/A/S/D)', immediate: true })
    const saved = (await $.store.get('best')) as number | undefined
    if (typeof saved === 'number') await update($, best, () => saved)
    return result
  })

  on('command.run', { command: 'snake' }, async $ => {
    // Nochmal /snake schließt, wenn es offen ist.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Snake zu, Spiel pausiert. /snake spielt weiter.' }
    }
    if (!(await read($, game))) {
      const seed = Math.floor(await $.clock.now())
      await update($, game, () => newGame(20, seed))
    }
    await $.ui.open({ id: PANE, title: 'Snake', focus: true, closeOnEscape: true, rows: H + 5 })
    return { text: 'Snake geöffnet. W/A/S/D steuert, P pausiert, N neu, Esc oder Q schließt.' }
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.text !== '') await update($, claude, () => 'arbeitet')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    await update($, claude, () => 'fertig')
    const g = await read($, game)
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      // Zurück an die Arbeit: Panel zu, Spiel bleibt pausiert stehen.
      await $.ui.close({ id: PANE })
      $.ui.toast(g && g.score > 0 ? `Claude ist fertig. Snake pausiert bei ${g.score} Punkten, /snake spielt weiter.` : 'Claude ist fertig.')
    } else if (g && g.status === 'laeuft') {
      await pause($)
    }
    return result
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await pause($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const g = await read($, game)
    const record = await read($, best)
    const state = await read($, claude)
    if (!g) return <Text dimColor>/snake startet ein Spiel.</Text>

    // Jede Zelle ist zwei Zeichen breit, damit das Feld quadratisch wirkt.
    const rows: { text: string; color?: string }[][] = []
    rows.push([{ text: '┌' + '──'.repeat(g.w) + '┐', color: 'gray' }])
    for (let y = 0; y < g.h; y++) {
      const line: { text: string; color?: string }[] = [{ text: '│', color: 'gray' }]
      for (let x = 0; x < g.w; x++) {
        const idx = g.snake.findIndex(([sx, sy]) => sx === x && sy === y)
        const cell =
          idx === 0
            ? { text: '██', color: HEAD }
            : idx > 0
              ? { text: '██', color: BODY }
              : g.food[0] === x && g.food[1] === y
                ? { text: '██', color: FOOD }
                : { text: '  ' }
        const last = line[line.length - 1]
        if (last && last.color === cell.color) last.text += cell.text
        else line.push({ ...cell })
      }
      line.push({ text: '│', color: 'gray' })
      rows.push(line)
    }
    rows.push([{ text: '└' + '──'.repeat(g.w) + '┘', color: 'gray' }])

    const message =
      g.status === 'bereit'
        ? 'Los gehts: W/A/S/D drücken'
        : g.status === 'pause'
          ? 'Pause. P oder eine Richtung spielt weiter'
          : g.status === 'vorbei'
            ? `Game over mit ${g.score} Punkten. N startet neu`
            : null
    const claudeLine =
      state === 'arbeitet' ? <Text color="yellow">Claude arbeitet…</Text> : state === 'fertig' ? <Text color="green" bold>✓ Claude ist fertig</Text> : <Text dimColor>Claude wartet</Text>

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text bold>Punkte {g.score}</Text>
          <Text dimColor>  ·  Rekord {Math.max(record, g.score)}  ·  </Text>
          {claudeLine}
        </Box>
        {Svg ? (
          <Svg key="feld" source={fieldSvg(g)} alt={`Snake-Feld, ${g.score} Punkte`} width={g.w * CELL} height={g.h * CELL} />
        ) : rows.map((line, y) => (
          <Text key={`z${y}`} wrap="truncate-end">
            {line.map((part, i) => (
              <Text key={`t${i}`} color={part.color}>
                {part.text}
              </Text>
            ))}
          </Text>
        ))}
        {message && <Text color={g.status === 'vorbei' ? 'red' : undefined}>{message}</Text>}
        <Box>
          <Button key="hoch" hotkey="w" plain onPress={() => void steer($, 'hoch')} label="hoch" />
          <Text> </Text>
          <Button key="links" hotkey="a" plain onPress={() => void steer($, 'links')} label="links" />
          <Text> </Text>
          <Button key="runter" hotkey="s" plain onPress={() => void steer($, 'runter')} label="runter" />
          <Text> </Text>
          <Button key="rechts" hotkey="d" plain onPress={() => void steer($, 'rechts')} label="rechts" />
          <Text>   </Text>
          <Button key="pause" hotkey="p" plain onPress={async () => ((await read($, game))?.status === 'laeuft' ? pause($) : run($))} label="Pause" />
          <Text> </Text>
          <Button key="neu" hotkey="n" plain onPress={() => void restart($, g.w)} label="Neu" />
          <Text> </Text>
          <Button key="zu" hotkey="q" plain onPress={() => void $.ui.close({ id: PANE })} label="Schließen" />
        </Box>
        {!e.props.isFocused && <Text dimColor>Panel anklicken oder Strg+X Tab, dann W/A/S/D</Text>}
      </Box>
    )
  })
}
