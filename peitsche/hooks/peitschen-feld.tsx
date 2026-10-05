// Das Peitschen-Feld: eine Peitsche, die der Maus folgt. Maus gedrückt halten
// und schwingen. Ist die Spitze schnell genug, knallt es; streift sie Clawd,
// zuckt er zusammen und das Hooks-Modul sagt Claude Bescheid.
// Ohne Maus: ins Feld klicken, dann Pfeiltasten bewegen die Hand, Leertaste haut.
import type { ClientModule } from 'claude-code'

export type FeldProps = {
  working: boolean
  count: number
  befehl?: { seq: number; kind: 'hieb' | 'hoch' | 'runter' | 'links' | 'rechts' }
}

// Ein Seilpunkt in Braille-Subpixeln (2 pro Spalte, 4 pro Zeile) samt letzter Lage.
type Punkt = { x: number; y: number; px: number; py: number }

type Feld = {
  rope: Punkt[]
  hand: { x: number; y: number }
  t: number
  lastCrack: number
  burst: { x: number; y: number; until: number } | null
  shakeUntil: number
  bubble: { text: string; until: number } | null
  hits: number
  working: boolean
  cols: number
  rows: number
  lastSeq: number
}

type Cell = { ch: string; color?: string; bold?: boolean; dim?: boolean }

const TICK = 33
const SEGMENTS = 18
const SEG_LEN = 2.6
const GRAVITY = 0.32
const DAMPING = 0.985
const CRACK_SPEED = 7
const HIT_SPEED = 3
const COOLDOWN = 320

const ROPE = '#a0703c'
const TIP = '#e8c39e'
const HANDLE = '#5c3a1e'
const CLAWD = '#d97757'
const BANG = '#ffd43b'
const SWEAT = '#74c0fc'

const SPRITE = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const SPRITE_W = 9

const OUCH = ['Aua! Ja, Chef!', 'Schon dabei!', 'Ich tipp ja schneller!', 'Gnade! Fast fertig!', 'Okay, okay!']
const BORED = ['Hä? Ich hab grad frei.', 'Gib mir erst ne Aufgabe.', 'Zzz… was?']

// Braille-Bit je Subpixel: Zeile 0–3, Spalte 0–1.
const BRAILLE = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]

function clawdBox(cols: number, rows: number) {
  return { x: Math.max(0, cols - SPRITE_W - 2), y: Math.max(1, rows - SPRITE.length - 1) }
}

function start(cols: number, rows: number): Feld {
  const hand = { x: 6, y: Math.floor(rows * 4 * 0.45) }
  const rope: Punkt[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const y = Math.min(rows * 4 - 1, hand.y + i * SEG_LEN)
    rope.push({ x: hand.x, y, px: hand.x, py: y })
  }
  return { rope, hand, t: 0, lastCrack: -9999, burst: null, shakeUntil: 0, bubble: null, hits: 0, working: false, cols, rows, lastSeq: 0 }
}

// Ein Physikschritt: Verlet-Seil, der erste Punkt hängt an der Hand.
function step(f: Feld, cols: number, rows: number): { x: number; y: number; speed: number } {
  const W = cols * 2
  const H = rows * 4
  const tip = f.rope[f.rope.length - 1]
  const tipBefore = tip ? { x: tip.x, y: tip.y } : { x: 0, y: 0 }

  f.rope.forEach((p, i) => {
    if (i === 0) {
      p.x = p.px = f.hand.x
      p.y = p.py = f.hand.y
      return
    }
    const vx = (p.x - p.px) * DAMPING
    const vy = (p.y - p.py) * DAMPING
    p.px = p.x
    p.py = p.y
    p.x += vx
    p.y += vy + GRAVITY
  })

  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < f.rope.length - 1; i++) {
      const a = f.rope[i]
      const b = f.rope[i + 1]
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.0001
      const diff = (d - SEG_LEN) / d
      if (i === 0) {
        b.x -= dx * diff
        b.y -= dy * diff
      } else {
        a.x += dx * diff * 0.5
        a.y += dy * diff * 0.5
        b.x -= dx * diff * 0.5
        b.y -= dy * diff * 0.5
      }
    }
    for (const p of f.rope.slice(1)) {
      p.x = Math.max(0, Math.min(W - 1, p.x))
      p.y = Math.max(0, Math.min(H - 1, p.y))
    }
  }

  const now = f.rope[f.rope.length - 1] ?? { x: 0, y: 0 }
  return { x: now.x, y: now.y, speed: Math.hypot(now.x - tipBefore.x, now.y - tipBefore.y) }
}

// H-Taste: Schwung nach rechts unten, Richtung Clawd.
function strike(f: Feld) {
  const n = f.rope.length
  f.rope.forEach((p, i) => {
    if (i === 0) return
    const k = i / n
    p.px = p.x - 11 * k
    p.py = p.y - 5 * k
  })
}

// Leertaste: ein Hieb von Hand, das Seil bekommt Schwung nach rechts oben.
function lash(f: Feld) {
  const n = f.rope.length
  f.rope.forEach((p, i) => {
    if (i === 0) return
    const k = i / n
    p.px = p.x - 9 * k
    p.py = p.y + 6 * k
  })
}

function paint(f: Feld, props: FeldProps, cols: number, rows: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, (): Cell => ({ ch: ' ' })))
  const put = (x: number, y: number, cell: Cell) => {
    const row = grid[y]
    if (row && x >= 0 && x < cols) row[x] = cell
  }
  const text = (x: number, y: number, s: string, cell: Omit<Cell, 'ch'>) => [...s].forEach((ch, i) => put(x + i, y, { ch, ...cell }))

  // Boden
  for (let x = 0; x < cols; x++) put(x, rows - 1, { ch: '─', dim: true })

  // Clawd, beim Treffer zittert er, in der Pause schläft er
  const box = clawdBox(cols, rows)
  const shaking = f.t < f.shakeUntil
  const shake = shaking ? (Math.floor(f.t / TICK) % 2 === 0 ? -1 : 1) : 0
  SPRITE.forEach((line, dy) => {
    ;[...line].forEach((ch, dx) => {
      if (ch !== ' ') put(box.x + dx + shake, box.y + dy, { ch, color: CLAWD })
    })
  })
  if (!props.working && !shaking) {
    put(box.x + SPRITE_W - 1, box.y - 1, { ch: 'z', dim: true })
    put(box.x + SPRITE_W, box.y - 2, { ch: 'Z', dim: true })
  }
  if (shaking) {
    put(box.x - 1, box.y, { ch: "'", color: SWEAT })
    put(box.x + SPRITE_W, box.y, { ch: "'", color: SWEAT })
    put(box.x - 1, box.y + 1, { ch: ',', color: SWEAT })
    put(box.x + SPRITE_W, box.y + 1, { ch: ',', color: SWEAT })
  }

  // Seil als Braille-Punkte, die Spitze heller
  const dots = new Map<number, { bits: number; tip: boolean }>()
  const plot = (x: number, y: number, isTip: boolean) => {
    const sx = Math.round(x)
    const sy = Math.round(y)
    const cx = Math.floor(sx / 2)
    const cy = Math.floor(sy / 4)
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
    const key = cy * cols + cx
    const cell = dots.get(key) ?? { bits: 0, tip: false }
    cell.bits |= BRAILLE[(sy % 4) * 2 + (sx % 2)] ?? 0
    cell.tip ||= isTip
    dots.set(key, cell)
  }
  const n = f.rope.length
  for (let i = 0; i < n - 1; i++) {
    const a = f.rope[i]
    const b = f.rope[i + 1]
    if (!a || !b) continue
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5))
    for (let s = 0; s <= steps; s++) plot(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps, i >= n - 4)
  }
  for (const [key, cell] of dots) {
    put(key % cols, Math.floor(key / cols), { ch: String.fromCharCode(0x2800 + cell.bits), color: cell.tip ? TIP : ROPE })
  }

  // Griff an der Hand
  const hx = Math.floor(Math.round(f.hand.x) / 2)
  const hy = Math.floor(Math.round(f.hand.y) / 4)
  put(hx, hy, { ch: '█', color: HANDLE })
  if (hy + 1 < rows - 1) put(hx, hy + 1, { ch: '▌', color: HANDLE })

  // KNALL
  if (f.burst && f.t < f.burst.until) {
    const word = '*KNALL*'
    const bx = Math.max(0, Math.min(cols - word.length, Math.floor(f.burst.x / 2) - 3))
    const by = Math.max(0, Math.min(rows - 2, Math.floor(f.burst.y / 4) - 1))
    text(bx, by, word, { color: BANG, bold: true })
  }

  // Sprechblase über Clawd
  if (f.bubble && f.t < f.bubble.until) {
    const s = f.bubble.text
    text(Math.max(0, Math.min(cols - s.length, box.x + SPRITE_W - s.length)), Math.max(0, box.y - 2), s, { color: '#ffffff', bold: true })
  }

  // Kopfzeile
  const head = props.working ? `Hiebe: ${props.count}` : 'Claude hat Pause'
  text(cols - head.length, 0, head, { dim: true })
  return grid
}

const PeitschenFeld: ClientModule<FeldProps, Feld> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    const first = start(Math.max(surface.columns, 30), Math.max(surface.rows, 10))
    first.working = props.working
    first.lastSeq = props.befehl?.seq ?? 0

    surface.every(TICK, () => {
      const s = surface.state ?? first
      const c = Math.max(surface.columns, 10)
      const r = Math.max(surface.rows, 6)
      s.t += TICK
      // Beim Start und nach einer Größenänderung springt das Seil: kein Knall.
      if (c !== s.cols || r !== s.rows) {
        s.cols = c
        s.rows = r
        s.lastCrack = s.t + 400
      }
      const tip = step(s, c, r)

      // Treffer: eins der letzten Seilstücke streift Clawd mit Tempo.
      // Knall in die Luft: die Spitze ist richtig schnell.
      const box = clawdBox(c, r)
      const touches = s.rope.slice(-4).some(p => {
        const cx = p.x / 2
        const cy = p.y / 4
        return cx >= box.x - 1 && cx <= box.x + SPRITE_W && cy >= box.y - 1 && cy <= box.y + SPRITE.length
      })
      const treffer = touches && tip.speed >= HIT_SPEED
      const ready = s.t > 600 && s.t - s.lastCrack >= COOLDOWN
      if (ready && (treffer || tip.speed >= CRACK_SPEED)) {
        s.lastCrack = s.t
        s.burst = treffer ? { x: (box.x + 1) * 2, y: (box.y - 1) * 4, until: s.t + 350 } : { x: tip.x, y: tip.y, until: s.t + 300 }
        if (treffer) {
          s.hits += 1
          s.shakeUntil = s.t + 450
          const lines = s.working ? OUCH : BORED
          s.bubble = { text: lines[s.hits % lines.length] ?? '', until: s.t + 1400 }
        }
        surface.post({ type: 'knall', treffer })
      }

      // Nur neu zeichnen, wenn sich etwas bewegt oder ein Effekt läuft.
      const moving = s.rope.some(p => Math.abs(p.x - p.px) > 0.03 || Math.abs(p.y - p.py) > 0.03)
      const effects =
        s.t < s.shakeUntil + TICK || (s.burst !== null && s.t < s.burst.until + TICK) || (s.bubble !== null && s.t < s.bubble.until + TICK)
      if (moving || effects) surface.setState({ ...s })
    })

    surface.onPointer(e => {
      const s = surface.state
      if (!s) return
      const x = e.fine ? e.fine.x * 2 : e.x * 2 + 1
      const y = e.fine ? e.fine.y * 4 : e.y * 4 + 2
      s.hand = { x: Math.max(0, Math.min(surface.columns * 2 - 1, x)), y: Math.max(0, Math.min(surface.rows * 4 - 1, y)) }
    })

    surface.onKey(e => {
      const s = surface.state
      if (!s) return
      if (e.key === ' ') lash(s)
      if (e.key === 'left') s.hand.x = Math.max(0, s.hand.x - 4)
      if (e.key === 'right') s.hand.x = Math.min(surface.columns * 2 - 1, s.hand.x + 4)
      if (e.key === 'up') s.hand.y = Math.max(0, s.hand.y - 4)
      if (e.key === 'down') s.hand.y = Math.min(surface.rows * 4 - 1, s.hand.y + 4)
    })

    surface.setState(first)
  }

  const f = surface.state
  if (f) {
    f.working = props.working
    // Ein neuer Tastenbefehl aus dem Hooks-Modul (H, W/A/S/D).
    const cmd = props.befehl
    if (cmd && cmd.seq > f.lastSeq) {
      f.lastSeq = cmd.seq
      const W = Math.max(surface.columns, 10) * 2 - 1
      const H = Math.max(surface.rows, 6) * 4 - 1
      if (cmd.kind === 'hieb') {
        // Per Taste: Hand springt in Schlagposition links über Clawd, dann der Hieb.
        const box = clawdBox(Math.max(surface.columns, 10), Math.max(surface.rows, 6))
        const to = { x: Math.max(2, box.x * 2 - 20), y: 6 }
        // Das ganze Seil springt mit, sonst knallt schon der Sprung.
        const dx = to.x - f.hand.x
        const dy = to.y - f.hand.y
        for (const p of f.rope) {
          p.x += dx
          p.px += dx
          p.y += dy
          p.py += dy
        }
        f.hand = to
        strike(f)
      }
      if (cmd.kind === 'links') f.hand.x = Math.max(0, f.hand.x - 8)
      if (cmd.kind === 'rechts') f.hand.x = Math.min(W, f.hand.x + 8)
      if (cmd.kind === 'hoch') f.hand.y = Math.max(0, f.hand.y - 6)
      if (cmd.kind === 'runter') f.hand.y = Math.min(H, f.hand.y + 6)
    }
  }
  const cols = surface.columns
  const rows = surface.rows
  if (!f || cols < 20 || rows < 6) return <Text dimColor>Peitsche lädt…</Text>

  return (
    <Box flexDirection="column">
      {paint(f, props, cols, rows).map((row, y) => {
        // Gleiche Farben zu einem Stück zusammenfassen, damit der Baum klein bleibt.
        const runs: { text: string; cell: Cell }[] = []
        for (const cell of row) {
          const last = runs[runs.length - 1]
          if (last && last.cell.color === cell.color && last.cell.bold === cell.bold && last.cell.dim === cell.dim) last.text += cell.ch
          else runs.push({ text: cell.ch, cell })
        }
        return (
          <Text key={`z${y}`} wrap="truncate-end">
            {runs.map((run, i) => (
              <Text key={`r${i}`} color={run.cell.color} bold={run.cell.bold} dimColor={run.cell.dim}>
                {run.text}
              </Text>
            ))}
          </Text>
        )
      })}
    </Box>
  )
}

export default PeitschenFeld
