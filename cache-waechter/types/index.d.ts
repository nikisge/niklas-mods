export type CacheWaechterLimit = { percent: number; resetsAt: number | null }
export type CacheWaechterReading = {
  contextPercent: number
  contextTokens: number
  window: number
  fiveHour: CacheWaechterLimit | null
  week: CacheWaechterLimit | null
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-waechter': {
      reading: CacheWaechterReading | null
      lastReplyAt: number | null
      now: number
      isWorking: boolean
    }
  }
}
