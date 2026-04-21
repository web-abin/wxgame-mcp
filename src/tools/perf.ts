import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

export const perfTools: ToolDef[] = [
  {
    name: 'wxgame_perf_snapshot',
    description: '瞬时 FPS（最近 60 帧均值）+ JS heap（可用时）。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.perfSnapshot() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_perf_record',
    description:
      'N ms 窗口内每帧采样，返回 { samples, fps: { avg, min, max, p95 }, dtsMs: {...}, heap }。用来量化卡顿。',
    inputSchema: {
      type: 'object',
      properties: {
        durationMs: { type: 'number', description: '采样时长（ms），默认 1000' },
      },
    },
    handler: async (a) => {
      const mp = getMp()
      const ms = a?.durationMs ?? 1000
      // 这里 evaluate 要 await —— shim 的 perfRecord 返回 Promise
      return await mp.evaluate(`globalThis.__WXMCP__?.perfRecord(${ms})`)
    },
  },
]
