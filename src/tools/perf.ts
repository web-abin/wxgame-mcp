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
  {
    name: 'wxgame_long_tasks_tail',
    description:
      '读最近的"长帧"——shim 在 rAF tick 里记录的 dt 超过 thresholdMs（默认 50ms）的帧。能告诉你大概什么时候卡了，配合 wxgame_console_tail / wxgame_network_tail 看相近 ts 的事件来归因。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '默认 50' },
        thresholdMs: { type: 'number', description: '只看 dt >= 此值的帧；默认 50' },
      },
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(o){ return globalThis.__WXMCP__?.longTasks(o) || [] })(${JSON.stringify(a ?? {})})`,
      )
    },
  },
  {
    name: 'wxgame_heap_sample',
    description:
      '在 N ms 内按 intervalMs 周期采 performance.memory.usedJSHeapSize，返回时序 + 净增长（deltaMB）。用来抓内存泄漏 —— 让用户做一个可疑动作的同时跑此工具。',
    inputSchema: {
      type: 'object',
      properties: {
        durationMs: { type: 'number', description: '默认 2000' },
        intervalMs: { type: 'number', description: '默认 100' },
      },
    },
    handler: async (a) => {
      const mp = getMp()
      const ms = a?.durationMs ?? 2000
      const interval = a?.intervalMs ?? 100
      return await mp.evaluate(`globalThis.__WXMCP__?.heapSample(${ms}, ${interval})`)
    },
  },
]
