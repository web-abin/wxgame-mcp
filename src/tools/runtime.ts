import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'
import { CACHE_DIR } from '../util/paths.js'

export const runtimeTools: ToolDef[] = [
  {
    name: 'wxgame_evaluate',
    description:
      '在小游戏 AppService 上下文里跑任意 JS。expression 是一个**表达式字符串**（不是语句），会被包成 (() => EXPR)() 运行，返回值要能 JSON 序列化。适合探状态/调试。',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '一段 JS 表达式，例如 `globalThis.PIXI?.VERSION` 或 `__WXMCP__.perfSnapshot()`' },
      },
      required: ['expression'],
    },
    handler: async (args) => {
      const mp = getMp()
      const fn = new Function('return (' + args.expression + ')')
      const src = fn.toString()
      // 用字符串形式传 —— miniprogram-automator 的 evaluate 支持 string | function
      const result = await mp.evaluate(`(${src})()`)
      return { result }
    },
  },
  {
    name: 'wxgame_screenshot',
    description: '截当前模拟器画面，写到本地 PNG 并返回绝对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: '是否截整个画布；默认 true' },
        outPath: { type: 'string', description: '指定输出路径；默认写到 ~/.wxgame-mcp/cache/shots/<timestamp>.png' },
      },
    },
    handler: async (args) => {
      const mp = getMp()
      const dir = join(CACHE_DIR, 'shots')
      mkdirSync(dir, { recursive: true })
      const outPath = args?.outPath ?? join(dir, `shot-${Date.now()}.png`)
      const res = await mp.screenshot({ fullPage: args?.fullPage ?? true, path: outPath })
      // 某些版本 screenshot 返回 Buffer（没写 path 时），写一下
      if (res instanceof Buffer) {
        writeFileSync(outPath, res)
      }
      return { path: outPath }
    },
  },
  {
    name: 'wxgame_call_wx',
    description: '转调 automator.callWxMethod —— 在小游戏上下文调一个 wx.* 方法。',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: '例如 getSystemInfoSync / getStorageSync' },
        args: { type: 'array', description: '方法参数，按顺序', items: {} },
      },
      required: ['method'],
    },
    handler: async (a) => {
      const mp = getMp()
      const result = await mp.callWxMethod(a.method, ...(a.args ?? []))
      return { result }
    },
  },
  {
    name: 'wxgame_mock_wx',
    description:
      '用一个 JS 函数字符串 mock wx.* 方法。表达式可以是箭头/普通函数体，例如 `() => ({ ok: true })` 或 `(opts) => { opts.success?.({ code: "x" }) }`。调 wxgame_unmock_wx 可撤销。',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string' },
        fn: { type: 'string', description: '函数源码字符串' },
      },
      required: ['method', 'fn'],
    },
    handler: async (a) => {
      const mp = getMp()
      // miniprogram-automator 的 mockWxMethod 接受一个 value（常量）或 function；这里走 function 路径
      // 先在小游戏侧通过 evaluate 构造一个函数，并把它挂到 __WXMCP_MOCKS__[method]，再让 mockWxMethod 调它
      await mp.evaluate(
        `(function(){ globalThis.__WXMCP_MOCKS__ = globalThis.__WXMCP_MOCKS__ || {}; globalThis.__WXMCP_MOCKS__[${JSON.stringify(a.method)}] = (${a.fn}); })()`,
      )
      await mp.mockWxMethod(a.method, function (this: any) {
        // eslint-disable-next-line prefer-rest-params
        const args = Array.prototype.slice.call(arguments)
        return (globalThis as any).__WXMCP_MOCKS__?.[a.method]?.apply(this, args)
      } as any)
      return { ok: true, method: a.method }
    },
  },
  {
    name: 'wxgame_unmock_wx',
    description: '把之前 mock 掉的 wx.* 恢复（若 automator 无原生 restore，用 mockWxMethod 再覆盖为 passthrough 不完美 —— 建议 restart 最彻底）。',
    inputSchema: {
      type: 'object',
      properties: { method: { type: 'string' } },
      required: ['method'],
    },
    handler: async (a) => {
      const mp = getMp()
      // 0.11 的 MiniProgram 有 restore 方法
      if (typeof (mp as any).restoreWxMethod === 'function') {
        await (mp as any).restoreWxMethod(a.method)
        return { ok: true, via: 'restoreWxMethod' }
      }
      return { ok: false, hint: 'automator 版本不支持原生 restore；建议 wxgame_restart 彻底恢复' }
    },
  },
]
