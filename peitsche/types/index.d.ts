export type PeitscheCount = number
export type PeitscheBefehl = { seq: number; kind: 'hieb' | 'hoch' | 'runter' | 'links' | 'rechts' }

declare module 'claude-code' {
  interface PluginState {
    peitsche: { turnCracks: PeitscheCount; isWorking: boolean; pending: string | null; befehl: PeitscheBefehl }
  }
}
