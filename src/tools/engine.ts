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
  {
    name: 'wxgame_pixi_hit_test',
    description:
      '仅 PIXI：在屏幕坐标 (x, y) 做命中测试，从 stage 后序遍历，返回该点上**所有** visible 节点（最上层排第一）。onlyInteractive=true 时只返回 interactive 节点。用来定位"我点的那个像素位置上盖了哪些东西"。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        onlyInteractive: { type: 'boolean', description: '默认 false' },
      },
      required: ['x', 'y'],
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(p){ return globalThis.__WXMCP__?.pixiHitTest(p.x, p.y, { onlyInteractive: !!p.onlyInteractive }) || { error: 'shim-not-installed' } })(${JSON.stringify(a)})`,
      )
    },
  },
  {
    name: 'wxgame_pixi_find',
    description:
      '仅 PIXI：递归在 stage 上找 name 匹配 needle 的节点（默认不区分大小写、子串匹配）。返回每个匹配项的 path / bounds / center。center 可以直接喂给 wxgame_tap。',
    inputSchema: {
      type: 'object',
      properties: {
        needle: { type: 'string', description: '要搜的 name 子串（或 exact=true 时为精确匹配）' },
        exact: { type: 'boolean', description: '精确匹配；默认 false' },
        visibleOnly: { type: 'boolean', description: '是否只搜 visible !== false 的节点；默认 true' },
        limit: { type: 'number', description: '最多返回多少个，默认 50' },
      },
      required: ['needle'],
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(p){ return globalThis.__WXMCP__?.pixiFind(p.needle, { exact: !!p.exact, visibleOnly: p.visibleOnly !== false, limit: p.limit }) || { error: 'shim-not-installed' } })(${JSON.stringify(a)})`,
      )
    },
  },
  {
    name: 'wxgame_pixi_textures',
    description:
      '仅 PIXI：枚举 stage 上引用到的所有 BaseTexture/TextureSource，估算 VRAM、找最大的几张图。排查"包体大 / 显存爆 / 单图过大"用。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.pixiTextures() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_tap_node',
    description:
      '组合 pixiFind + tap：按 name 找到第一个匹配的节点，对其中心点合成一次 tap。**仅 PIXI**。若想精确控制，用 wxgame_pixi_find 拿到 center 再调 wxgame_tap。',
    inputSchema: {
      type: 'object',
      properties: {
        needle: { type: 'string' },
        exact: { type: 'boolean' },
        visibleOnly: { type: 'boolean' },
      },
      required: ['needle'],
    },
    handler: async (a) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(p){ return globalThis.__WXMCP__?.tapNode(p.needle, { exact: !!p.exact, visibleOnly: p.visibleOnly !== false }) || { error: 'shim-not-installed' } })(${JSON.stringify(a)})`,
      )
    },
  },
]
