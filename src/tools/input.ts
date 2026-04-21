import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

// 小游戏 tap/swipe 的合成策略见 src/shim/runtime.ts：
// 通过 monkey-patch wx.onTouch* 保存所有 callback，直接向 callback 分发合成事件。
// 限制：shim 注入之前已经调过 wx.onTouchStart 的 callback 抓不到 —— 调 wxgame_restart 可解决。

export const inputTools: ToolDef[] = [
  {
    name: 'wxgame_tap',
    description:
      '在模拟器逻辑坐标 (x, y) 合成一次 tap（start + end）。best-effort：若 shim 没抓到 touch handler 会返回 warn，可先调 wxgame_restart。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(p){ return globalThis.__WXMCP__?.tap(p.x, p.y) || { error: 'shim-not-installed' } })(${JSON.stringify({ x: a.x, y: a.y })})`,
      )
    },
  },
  {
    name: 'wxgame_swipe',
    description: '从 (x1,y1) 到 (x2,y2) 合成一次 swipe，分 8 步。同样 best-effort。',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' },
        y1: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
        durationMs: { type: 'number', description: '默认 300' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(p){ return globalThis.__WXMCP__?.swipe(p.x1, p.y1, p.x2, p.y2, p.durationMs) || { error: 'shim-not-installed' } })(${JSON.stringify(a)})`,
      )
    },
  },
]
