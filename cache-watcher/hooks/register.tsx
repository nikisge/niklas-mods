// Cache Watcher: eine Zeile über dem Prompt mit allem, was Geld und Limits kostet.
// Wie lange der Prompt-Cache noch warm ist, wie voll der Kontext ist, wo die
// 5-Stunden- und Wochenlimits stehen, und was die Session bisher gekostet hat.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheWatcherLimit, CacheWatcherReading } from '../types'

// Claude Code hält den Prompt-Cache bei Abos eine Stunde warm. Wer per API mit
// 5 Minuten arbeitet, stellt hier 5 ein.
const CACHE_MINUTES = 60
const WARN_MINUTES = 5
const TICK_MS = 15_000

const reading = atom({ plugin: 'cache-watcher', key: 'reading' } as const, null as CacheWatcherReading | null)
const lastReplyAt = atom({ plugin: 'cache-watcher', key: 'lastReplyAt' } as const, null as number | null)
const now = atom({ plugin: 'cache-watcher', key: 'now' } as const, 0)
const isWorking = atom({ plugin: 'cache-watcher', key: 'isWorking' } as const, false)

// Ein kurzer Prompt, der den Cache für eine weitere Stunde warm hält: liest den
// ganzen Chat zum Cache-Preis (10 %) und kostet sonst fast nichts.
const KEEP_WARM_PROMPT = 'Kurz: Ich halte nur den Cache warm. Antworte ausschließlich mit "ok", tu sonst nichts.'

// Wann die letzte Antwort kam, je Session gespeichert: übersteht ein Neuladen des
// Mods und ein Fortsetzen der Session.
async function lastKey($: EngineInterface): Promise<string> {
  return `last:${await $.session.id()}`
}

async function warn($: EngineInterface, left: number): Promise<void> {
  void $.audio.play({ asset: 'sounds/warnung.wav' }).catch(() => undefined)
  $.ui.toast(`⚠ Cache läuft in ${untilText(left)} ab. Jetzt weiterschreiben, „Warm halten“ oder /compact, sonst zahlt der nächste Prompt wieder voll.`, {
    timeoutMs: 60_000,
  })
}

function limitOf(kind: string, limits: { kind: string; percentUsed: number; resetsAt?: string }[]): CacheWatcherLimit | null {
  const found = limits.find(one => one.kind === kind)
  if (!found) return null
  const at = found.resetsAt ? Date.parse(found.resetsAt) : NaN
  return { percent: Math.round(found.percentUsed), resetsAt: Number.isNaN(at) ? null : at }
}

async function takeReading($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const tokens = usage.context.tokens ?? 0
  const window = usage.context.window
  const next: CacheWatcherReading = {
    contextTokens: tokens,
    window,
    contextPercent: usage.context.percent ?? (window ? Math.round((tokens / window) * 100) : 0),
    fiveHour: limitOf('five_hour', usage.rateLimits),
    week: limitOf('seven_day', usage.rateLimits),
    usd: usage.cost?.usd ?? null,
  }
  await update($, reading, () => next)
}

function bar(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function levelColor(percent: number): string {
  return percent >= 80 ? 'red' : percent >= 50 ? 'yellow' : 'green'
}

function tokensText(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`
}

function untilText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes <= 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const register: Register = on => {
  // Damit die Warnung pro Cache-Fenster nur einmal kommt.
  let warnedFor: number | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const started = await $.clock.now()
    await update($, now, () => started)
    const saved = (await $.store.get(await lastKey($))) as number | undefined
    if (typeof saved === 'number') await update($, lastReplyAt, () => saved)
    await takeReading($)

    $.clock.every(TICK_MS, () => {
      void (async () => {
        const t = await $.clock.now()
        await update($, now, () => t)
        const last = await read($, lastReplyAt)
        if (last === null || (await read($, isWorking)) || warnedFor === last) return
        const left = last + CACHE_MINUTES * 60_000 - t
        if (left > 0 && left <= WARN_MINUTES * 60_000) {
          warnedFor = last
          await warn($, left)
        }
      })()
    })
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    await update($, isWorking, () => true)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const t = await $.clock.now()
    await update($, isWorking, () => false)
    await update($, lastReplyAt, () => t)
    await $.store.set(await lastKey($), t)
    await update($, now, () => t)
    await takeReading($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Umfragen und andere Mods (Next Steps, You Should Know) zuerst zeichnen lassen,
    // die Zeile hängt sich darunter.
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, reading)
    const last = await read($, lastReplyAt)
    const t = await read($, now)
    const working = await read($, isWorking)
    const columns = e.props.bodyColumns
    const isNarrow = columns < 110

    let cacheText = 'noch nichts gesendet'
    let cacheColor = 'gray'
    let left = Infinity
    if (working) {
      cacheText = 'in Benutzung'
      cacheColor = 'green'
    } else if (last !== null) {
      left = last + CACHE_MINUTES * 60_000 - t
      if (left <= 0) {
        cacheText = 'kalt, nächster Prompt zahlt voll'
        cacheColor = 'red'
      } else {
        cacheText = `warm, noch ${untilText(left)}`
        cacheColor = left <= WARN_MINUTES * 60_000 ? 'red' : left <= 15 * 60_000 ? 'yellow' : 'green'
      }
    }

    const showCompact = !working && r !== null && (r.contextPercent >= 50 || (left > 0 && left <= 10 * 60_000))

    const cache = (
      <Text>
        <Text dimColor>Cache </Text>
        <Text color={cacheColor}>● {cacheText}</Text>
      </Text>
    )
    const context = r && (
      <Text>
        <Text dimColor>Kontext </Text>
        <Text color={levelColor(r.contextPercent)}>{bar(r.contextPercent, 8)}</Text> {r.contextPercent}%{' '}
        <Text dimColor>
          {tokensText(r.contextTokens)}/{tokensText(r.window)}
        </Text>
      </Text>
    )
    const limits = r && (
      <Text>
        {r.fiveHour && (
          <Text>
            <Text dimColor>5h </Text>
            <Text color={levelColor(r.fiveHour.percent)}>{bar(r.fiveHour.percent, 8)}</Text> {r.fiveHour.percent}%
            {r.fiveHour.resetsAt !== null && t > 0 && <Text dimColor> Reset in {untilText(r.fiveHour.resetsAt - t)}</Text>}
          </Text>
        )}
        {r.week && (
          <Text>
            <Text dimColor>{r.fiveHour ? '  │  ' : ''}Woche </Text>
            <Text color={levelColor(r.week.percent)}>{r.week.percent}%</Text>
          </Text>
        )}
        {r.usd !== null && (
          <Text dimColor>
            {r.fiveHour || r.week ? '  │  ' : ''}API-Wert ${r.usd.toFixed(2)}
          </Text>
        )}
      </Text>
    )
    const isWarning = !working && left > 0 && left <= WARN_MINUTES * 60_000
    const compact = showCompact && (
      <Box>
        {isWarning && <Button key="warm" label="Warm halten" onPress={() => void $.prompt.submit({ text: KEEP_WARM_PROMPT })} />}
        {isWarning && <Text> </Text>}
        <Button key="compact" label="Komprimieren" onPress={() => void $.command.run({ command: 'compact' })} />
      </Box>
    )
    // Kurz vor Ablauf eine eigene, rote Zeile, die stehen bleibt, bis du reagierst.
    const alarm = isWarning && (
      <Text color="red" bold wrap="truncate-end">
        ⚠ Cache läuft in {untilText(left)} ab · jetzt schreiben oder „Warm halten“, sonst zahlt der nächste Prompt voll
      </Text>
    )

    const line = isNarrow ? (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          {cache}
          {context && <Text dimColor>  │  </Text>}
          {context}
        </Box>
        <Box>
          {limits}
          {compact && <Text> </Text>}
          {compact}
        </Box>
      </Box>
    ) : (
      <Box paddingX={1}>
        {cache}
        {context && <Text dimColor>  │  </Text>}
        {context}
        {limits && <Text dimColor>  │  </Text>}
        {limits}
        {compact && <Text> </Text>}
        {compact}
      </Box>
    )
    const mine = alarm ? (
      <Box flexDirection="column">
        <Box paddingX={1}>{alarm}</Box>
        {line}
      </Box>
    ) : (
      line
    )

    return below ? (
      <Box flexDirection="column">
        {below}
        {mine}
      </Box>
    ) : (
      mine
    )
  })
}
