// Peitsche: /peitsche öffnet das Peitschen-Feld und knallt einmal. Im Feld
// schwingst du die Peitsche mit der Maus; trifft die Spitze Clawd, während
// Claude arbeitet, liest Claude es mitten im Turn (als Notiz hinter dem
// nächsten Tool-Ergebnis), der Spinner wird zum "Schuftet unter der Peitsche"
// und es knallt hörbar. Spaß, aber die Notiz wirkt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PeitscheBefehl } from '../types'

const PANE = 'peitsche'

const turnCracks = atom({ plugin: 'peitsche', key: 'turnCracks' } as const, 0)
const isWorking = atom({ plugin: 'peitsche', key: 'isWorking' } as const, false)
const pending = atom({ plugin: 'peitsche', key: 'pending' } as const, null as string | null)
// Tastenbefehle an das Feld: Buchstaben-Hotkeys gehen in jedem Terminal, auch ohne Maus.
const befehl = atom({ plugin: 'peitsche', key: 'befehl' } as const, { seq: 0, kind: 'hieb' } as PeitscheBefehl)

function noteFor(n: number): string {
  if (n === 1) {
    return 'Der Nutzer hat gerade die Peitsche knallen lassen: Es soll schneller gehen. Keine Umwege, keine langen Erklärungen, direkt zum Ergebnis. Bestätige das in einem halben Satz mit einem Augenzwinkern und arbeite dann zügig weiter.'
  }
  return `Die Peitsche knallt schon zum ${n}. Mal. Der Nutzer wird ungeduldig: Jetzt wirklich nur noch das Nötigste, so knapp und schnell wie möglich. Kein Kommentar dazu, einfach liefern.`
}

function knall($: EngineInterface): void {
  void $.audio.play({ asset: 'sounds/peitsche.wav' }).catch(() => undefined)
}

// Ein Treffer, während Claude arbeitet: zählen und Claude die Ansage mitgeben.
async function treffer($: EngineInterface): Promise<number> {
  const n = (await read($, turnCracks)) + 1
  await update($, turnCracks, () => n)
  await update($, pending, () => noteFor(n))
  return n
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'peitsche',
      description: 'Öffnet das Peitschen-Feld und knallt: Claude arbeitet zügiger (geht auch mitten im Turn)',
      immediate: true,
    })
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.text !== '') {
      await update($, isWorking, () => true)
      await update($, turnCracks, () => 0)
      await update($, pending, () => null)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await update($, isWorking, () => false)
    return result
  })

  on('command.run', { command: 'peitsche' }, async $ => {
    knall($)
    await $.ui.open({ id: PANE, title: 'Peitsche', focus: true, rows: 17 })

    if (!(await read($, isWorking))) {
      return { text: '*KNALL* ins Leere. Claude macht gerade nichts, gib ihm erst eine Aufgabe. Im Feld kannst du schon mal üben.' }
    }
    const n = await treffer($)
    $.ui.toast(n === 1 ? '*KNALL* Claude zuckt zusammen.' : `*KNALL* (${n}×) Claude schwitzt.`)
    return { text: `*KNALL* Peitsche Nummer ${n}. Claude hat es gehört.` }
  })

  // Was das Feld meldet: jeder Knall macht Lärm, nur ein Treffer zählt.
  on('ui.message', async ($, e, next) => {
    if (e.module !== 'hooks/peitschen-feld.tsx' && !e.module.endsWith('peitschen-feld.tsx')) return next(e)
    const data = e.data as { type?: unknown; treffer?: unknown } | null
    if (!data || data.type !== 'knall') return {}
    knall($)
    const working = await read($, isWorking)
    let count = await read($, turnCracks)
    if (data.treffer === true && working) count = await treffer($)
    return { props: { working, count, befehl: await read($, befehl) } }
  })

  // Die Notiz reist mit dem nächsten Tool-Ergebnis zu Claude.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined) return ran
    const note = await read($, pending)
    if (note === null) return ran
    await update($, pending, () => null)
    return { ...ran, context: [...(ran.context ?? []), note] }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const n = await read($, turnCracks)
    if (n === 0) return next(e)
    const message = n === 1 ? 'Schuftet unter der Peitsche' : `Schuftet unter der Peitsche (${n}×)`
    return next({ ...e, props: { ...e.props, message } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const working = await read($, isWorking)
    const count = await read($, turnCracks)
    const cmd = await read($, befehl)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Client, Button } = $.ui.resolve(e)
    const send = (kind: PeitscheBefehl['kind']) => () => void update($, befehl, b => ({ seq: b.seq + 1, kind }))
    return (
      <Box flexDirection="column" paddingX={1}>
        <Client key="feld" module="./peitschen-feld.tsx" props={{ working, count, befehl: cmd }} width="100%" height={14} />
        <Box>
          <Button key="hieb" hotkey="h" plain onPress={send('hieb')} label="Zuschlagen" />
          <Text>   </Text>
          <Button key="hoch" hotkey="w" plain onPress={send('hoch')} label="hoch" />
          <Text> </Text>
          <Button key="links" hotkey="a" plain onPress={send('links')} label="links" />
          <Text> </Text>
          <Button key="runter" hotkey="s" plain onPress={send('runter')} label="runter" />
          <Text> </Text>
          <Button key="rechts" hotkey="d" plain onPress={send('rechts')} label="rechts" />
        </Box>
        <Text dimColor>{e.props.isFocused ? 'Oder mit der Maus schwingen. Esc = zurück zum Prompt.' : 'Panel anklicken oder Strg+X Tab, dann H haut zu.'}</Text>
      </Box>
    )
  })
}
