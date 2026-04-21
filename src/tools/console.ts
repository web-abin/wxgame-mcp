import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

export const consoleTools: ToolDef[] = [
  {
    name: 'wxgame_console_tail',
    description:
      '读小游戏 console 最近的日志（shim 挂的环形缓冲，最多保留 500 条）。仅能抓到 shim 注入之后发生的日志 —— 更早的要用 wxgame_system_log。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最大返回条数，默认 100' },
        level: {
          type: 'array',
          items: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
          description: '仅返回这些级别；省略返回全部',
        },
      },
    },
    handler: async (args) => {
      const mp = getMp()
      const opts = { limit: args?.limit ?? 100, level: args?.level }
      const result = await mp.evaluate(
        `(function(o){ return globalThis.__WXMCP__?.readConsole(o) || { error: 'shim-not-installed' } })(${JSON.stringify(opts)})`,
      )
      return result
    },
  },
  {
    name: 'wxgame_errors',
    description: '读最近的 wx.onError / wx.onUnhandledRejection 事件（最多 300 条）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '默认 50' } },
    },
    handler: async (args) => {
      const mp = getMp()
      const opts = { limit: args?.limit ?? 50 }
      return await mp.evaluate(
        `(function(o){ return globalThis.__WXMCP__?.readErrors(o) || { error: 'shim-not-installed' } })(${JSON.stringify(opts)})`,
      )
    },
  },
  {
    name: 'wxgame_clear_console',
    description: '清空 shim 的 console / error 环形缓冲。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.clearBuffers() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_system_log',
    description:
      '调 miniprogram-automator 的 systemLog —— 从 IDE 侧（而非 AppService 侧）拉日志。能拿到 shim 注入之前发生的日志，但格式和 console_tail 不一样。',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'object', description: '可选过滤条件（参考 automator 文档）' },
      },
    },
    handler: async (args) => {
      const mp = getMp() as any
      if (typeof mp.systemLog !== 'function') return { error: 'automator 当前版本不支持 systemLog' }
      const result = await mp.systemLog(args?.filter)
      return { result }
    },
  },
]
