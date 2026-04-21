import type { ToolDef } from './types.js'
import { getOrCreate, status, disconnect, reinjectShim, getMp } from '../devtools/session.js'
import { closeProject, quitDevTools } from '../devtools/lifecycle.js'
import { DEFAULT_AUTO_PORT } from '../util/paths.js'
import automator from 'miniprogram-automator'
import { SHIM_SOURCE } from '../shim/runtime.js'
import type { MiniProgram } from '../devtools/session.js'

export const lifecycleTools: ToolDef[] = [
  {
    name: 'wxgame_ensure',
    description:
      '启动或复用微信开发者工具，打开指定项目目录，连上自动化通道，并注入运行时 shim。反复调用是幂等的：若 IDE 已在同端口上跑，就复用；否则 spawn cli auto。调用任何其他 wxgame_* 工具之前先调这个。',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: '小游戏项目目录绝对路径（需包含 project.config.json，或对于本仓库是 dist/）' },
        autoPort: { type: 'number', description: `自动化端口，默认 ${DEFAULT_AUTO_PORT}` },
        cliPath: { type: 'string', description: '自定义 cli 路径；默认定位 /Applications/wechatwebdevtools.app/Contents/MacOS/cli' },
        waitTimeoutMs: { type: 'number', description: '等待端口开放的超时（ms），默认 60000' },
      },
      required: ['projectPath'],
    },
    handler: async (args) => {
      const res = await getOrCreate({
        projectPath: args.projectPath,
        autoPort: args.autoPort,
        cliPath: args.cliPath,
        waitTimeoutMs: args.waitTimeoutMs,
      })
      return { reused: res.ensure.reused, autoPort: res.ensure.autoPort, wsEndpoint: res.ensure.wsEndpoint, shimInjected: res.shimInjected }
    },
  },
  {
    name: 'wxgame_connect',
    description: '连接一个已经在跑的 auto ws 端点（手动场景，比如 IDE 是用 --auto-port 自己启动的）。',
    inputSchema: {
      type: 'object',
      properties: {
        wsEndpoint: { type: 'string', description: '例如 ws://127.0.0.1:9421' },
      },
      required: ['wsEndpoint'],
    },
    handler: async (args) => {
      const mp = (await automator.connect({ wsEndpoint: args.wsEndpoint })) as unknown as MiniProgram
      try {
        await mp.evaluate(SHIM_SOURCE)
      } catch {}
      // 注意：这里没进 session 单例 —— 这条路径是"一次性"的临时连接。
      return { ok: true, wsEndpoint: args.wsEndpoint }
    },
  },
  {
    name: 'wxgame_status',
    description: '返回当前连接状态、项目路径、引擎探测结果。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const s = status()
      if (!s.connected) return s
      try {
        const engine = await getMp().evaluate(() => (globalThis as any).__WXMCP__?.detectEngine?.())
        return { ...s, engine }
      } catch (e) {
        return { ...s, engine: { error: (e as Error).message } }
      }
    },
  },
  {
    name: 'wxgame_restart',
    description:
      '重启小游戏（用 automator.restart 或 wx.restartMiniProgram 兜底）。重启后 shim 会在业务代码之前完成注入，让 tap/swipe 能抓全触摸 handler。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      try {
        if (typeof (mp as any).restart === 'function') {
          await (mp as any).restart()
        } else {
          await mp.evaluate(() => {
            try { (globalThis as any).wx?.restartMiniProgram?.({ success: () => {}, fail: () => {} }) } catch (_) {}
            return true
          })
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
      // 重启后需要重新注入 shim
      try {
        await new Promise((r) => setTimeout(r, 1000))
        await reinjectShim()
      } catch {}
      return { ok: true, shimReinjected: true }
    },
  },
  {
    name: 'wxgame_close',
    description: '断开 automator 连接，但保持 IDE 进程存活（供下次 ensure 复用）。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await disconnect()
      return { ok: true }
    },
  },
  {
    name: 'wxgame_quit',
    description: '完全退出微信开发者工具（cli quit）。下次再用需重新启动。',
    inputSchema: {
      type: 'object',
      properties: {
        cliPath: { type: 'string' },
      },
    },
    handler: async (args) => {
      try {
        await disconnect()
      } catch {}
      await quitDevTools(args?.cliPath)
      return { ok: true }
    },
  },
  {
    name: 'wxgame_close_project',
    description: 'cli close --project <path>：关项目但不退 IDE。',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string' },
        cliPath: { type: 'string' },
      },
      required: ['projectPath'],
    },
    handler: async (args) => {
      await closeProject(args.projectPath, args.cliPath)
      return { ok: true }
    },
  },
]
