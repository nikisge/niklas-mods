export type CacheWatcherLimit = { percent: number; resetsAt: number | null }
export type CacheWatcherReading = {
  contextPercent: number
  contextTokens: number
  window: number
  fiveHour: CacheWatcherLimit | null
  week: CacheWatcherLimit | null
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-watcher': {
      reading: CacheWatcherReading | null
      lastReplyAt: number | null
      now: number
      isWorking: boolean
    }
  }
}
