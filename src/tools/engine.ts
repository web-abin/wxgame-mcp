import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

export const engineTools: ToolDef[] = [
  {
    name: 'wxgame_detect_engine',
    description: '探测在跑的游戏引擎：PIXI / Laya / Cocos / Phaser / Three / unknown。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.detectEngine() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_pixi_tree',
    description:
      '仅 PIXI：返回 stage 子树。需要能找到 activeApp —— 若业务没有把 app 挂 globalThis，本工具会返回 no-pixi-app-found，建议在业务入口加 `globalThis.__PIXI_APP__ = app`（仅 dev）或通过 wxgame_evaluate 一次性手动暴露。',
    inputSchema: {
      type: 'object',
      properties: { maxDepth: { type: 'number', description: '递归深度，默认 3' } },
    },
    handler: async (a) => {
      const mp = getMp()
      const d = a?.maxDepth ?? 3
      return await mp.evaluate(`globalThis.__WXMCP__?.pixiTree(${d}) || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_pixi_audit',
    description: '仅 PIXI：扫描 stage 找越屏元素、小尺寸 interactive 元素，给 UI 审计用。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.pixiAudit() || { error: 'shim-not-installed' }`)
    },
  },
]
