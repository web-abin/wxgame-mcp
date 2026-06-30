import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

// 所有 wait_* 工具都是 MCP 端轮询的：每隔 intervalMs evaluate 一次。
// 不在 shim 里写 setTimeout 链是为了避免 evaluate 卡住 IDE 通道。

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface WaitOpts {
  timeoutMs?: number
  intervalMs?: number
}
const DEFAULT_TIMEOUT = 10_000
const DEFAULT_INTERVAL = 200

export const waitTools: ToolDef[] = [
  {
    name: 'wxgame_wait_for_expression',
    description:
      '反复在 AppService 里 eval 同一段表达式，直到返回 truthy 或超时。表达式可访问 globalThis / __WXMCP__ / wx。返回最后一次表达式的值；超时则 { timeout: true }。',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '一段 JS 表达式，例如 `globalThis.app?.stage?.children.length > 0`' },
        timeoutMs: { type: 'number', description: `最大等待时间，默认 ${DEFAULT_TIMEOUT}` },
        intervalMs: { type: 'number', description: `轮询间隔，默认 ${DEFAULT_INTERVAL}` },
      },
      required: ['expression'],
    },
    handler: async (a: { expression: string } & WaitOpts) => {
      const mp = getMp()
      const timeoutMs = a.timeoutMs ?? DEFAULT_TIMEOUT
      const intervalMs = a.intervalMs ?? DEFAULT_INTERVAL
      const startAt = Date.now()
      let lastVal: unknown
      while (Date.now() - startAt < timeoutMs) {
        try {
          lastVal = await mp.evaluate(`(function(){ try { return (${a.expression}) } catch (e) { return { __evalErr: String(e) } } })()`)
          if (lastVal && (typeof lastVal !== 'object' || !(lastVal as any).__evalErr)) {
            // truthy 且非错误对象 → resolve
            if (lastVal) return { ok: true, value: lastVal, elapsedMs: Date.now() - startAt }
          }
        } catch (e) {
          lastVal = { __mcpErr: (e as Error).message }
        }
        await sleep(intervalMs)
      }
      return { timeout: true, lastValue: lastVal, elapsedMs: Date.now() - startAt }
    },
  },
  {
    name: 'wxgame_wait_for_console',
    description: '等到 shim console 缓冲里出现匹配 regex 的日志。常用：等 "登录成功" 字样、等 "进入大厅"。',
    inputSchema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'JS RegExp 源码字符串' },
        level: {
          type: 'array',
          items: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
          description: '只看这些级别，省略则全部',
        },
        sinceTs: { type: 'number', description: '只看 ts >= 此时间戳的日志；省略则用当前时间' },
        timeoutMs: { type: 'number', description: `默认 ${DEFAULT_TIMEOUT}` },
        intervalMs: { type: 'number', description: `默认 ${DEFAULT_INTERVAL}` },
      },
      required: ['match'],
    },
    handler: async (a: { match: string; level?: string[]; sinceTs?: number } & WaitOpts) => {
      const mp = getMp()
      const timeoutMs = a.timeoutMs ?? DEFAULT_TIMEOUT
      const intervalMs = a.intervalMs ?? DEFAULT_INTERVAL
      const since = a.sinceTs ?? Date.now()
      const startAt = Date.now()
      while (Date.now() - startAt < timeoutMs) {
        const opts = { limit: 100, level: a.level, sinceTs: since, match: a.match }
        const hits = (await mp.evaluate(
          `(function(o){ return globalThis.__WXMCP__?.readConsole(o) || [] })(${JSON.stringify(opts)})`,
        )) as unknown[]
        if (Array.isArray(hits) && hits.length > 0) {
          return { ok: true, matches: hits, elapsedMs: Date.now() - startAt }
        }
        await sleep(intervalMs)
      }
      return { timeout: true, elapsedMs: Date.now() - startAt }
    },
  },
  {
    name: 'wxgame_wait_for_error',
    description: '等到 shim error 缓冲里出现新的错误（wx.onError / unhandled rejection）。',
    inputSchema: {
      type: 'object',
      properties: {
        sinceTs: { type: 'number', description: '只看 ts >= 此时间戳的错误；省略则用当前时间' },
        timeoutMs: { type: 'number', description: `默认 ${DEFAULT_TIMEOUT}` },
        intervalMs: { type: 'number', description: `默认 ${DEFAULT_INTERVAL}` },
      },
    },
    handler: async (a: { sinceTs?: number } & WaitOpts) => {
      const mp = getMp()
      const timeoutMs = a.timeoutMs ?? DEFAULT_TIMEOUT
      const intervalMs = a.intervalMs ?? DEFAULT_INTERVAL
      const since = a.sinceTs ?? Date.now()
      const startAt = Date.now()
      while (Date.now() - startAt < timeoutMs) {
        const errs = (await mp.evaluate(
          `(function(o){ return globalThis.__WXMCP__?.readErrors(o) || [] })(${JSON.stringify({ limit: 50, sinceTs: since })})`,
        )) as unknown[]
        if (Array.isArray(errs) && errs.length > 0) {
          return { ok: true, errors: errs, elapsedMs: Date.now() - startAt }
        }
        await sleep(intervalMs)
      }
      return { timeout: true, elapsedMs: Date.now() - startAt }
    },
  },
]
