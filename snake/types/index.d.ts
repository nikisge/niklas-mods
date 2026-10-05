export type SnakeStatus = 'bereit' | 'laeuft' | 'pause' | 'vorbei'
export type SnakeDir = 'hoch' | 'runter' | 'links' | 'rechts'
export type SnakeGame = {
  snake: [number, number][]
  dir: SnakeDir
  nextDir: SnakeDir
  food: [number, number]
  score: number
  status: SnakeStatus
  w: number
  h: number
  seed: number
}
export type SnakeClaude = 'idle' | 'arbeitet' | 'fertig'

declare module 'claude-code' {
  interface PluginState {
    snake: { game: SnakeGame | null; best: number; claude: SnakeClaude }
  }
}
