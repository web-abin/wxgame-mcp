import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

// 广告 / 音频实例追踪：shim 在 wx.createRewardedVideoAd / Interstitial / Banner / Custom / createInnerAudioContext 上 hook。
// 同样只能抓到 shim 注入之后创建的实例 —— 业务很可能在启动早期就创建了广告对象，建议 wxgame_restart 后再看。

export const mediaTools: ToolDef[] = [
  {
    name: 'wxgame_ad_list',
    description:
      '列出所有被 shim 追踪到的广告实例：kind (rewardedVideo/interstitial/banner/custom) / adUnitId / 当前 state / loadCount / showCount / closeCount / errorCount / lastError。IAA 调优排查"激励视频不出/拉不到/曝光为 0"必用。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.adList() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_audio_list',
    description:
      '列出所有被 shim 追踪到的 InnerAudioContext 实例：src / state / 是否 destroyed / 错误信息。常用来排查"音频泄漏"（创建多但不 destroy → 内存涨 / OOM）。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.audioList() || { error: 'shim-not-installed' }`)
    },
  },
]
