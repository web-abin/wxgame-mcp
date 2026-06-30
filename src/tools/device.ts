import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

export const deviceTools: ToolDef[] = [
  {
    name: 'wxgame_system_info',
    description:
      'wx.getSystemInfoSync —— 设备 / 微信版本 / 屏幕尺寸 / 像素比 / 网络制式 / API 基础库版本。复现线上 bug 必备。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.systemInfo() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_launch_options',
    description:
      '一次性拉 launchOptions / enterOptions / accountInfo —— 启动场景值、scene、query、shareTicket，以及小游戏 appId/envVersion。排查"为什么从某场景进入崩了"用。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.launchOptions() || { error: 'shim-not-installed' }`)
    },
  },
]
