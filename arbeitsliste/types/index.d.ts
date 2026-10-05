export type ArbeitslisteTodo = { id: string; text: string; status: 'offen' | 'laeuft' | 'erledigt' }
export type ArbeitslisteAktuell = { text: string; source: 'todo' | 'chat'; startedAt: number }
export type ArbeitslistePlanItem = { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    arbeitsliste: {
      queue: ArbeitslisteTodo[]
      plan: ArbeitslistePlanItem[]
      isPaused: boolean
      isWorking: boolean
      draft: string
      aktuell: ArbeitslisteAktuell | null
      activity: string
      now: number
    }
  }
}
