import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

// 网络抓包 = shim 在 wx.request / downloadFile / uploadFile / connectSocket 上的 monkey-patch。
// 限制：跟 tap 一样，只能抓到 shim 注入之后发起的请求。要全量抓必须先 wxgame_restart。

export const networkTools: ToolDef[] = [
  {
    name: 'wxgame_network_tail',
    description:
      '读最近的网络请求（wx.request / downloadFile / uploadFile / connectSocket），包含 method/url/状态码/耗时/请求体/响应预览（默认截断到 2KB）。可按 api/status/urlMatch/sinceTs 过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '默认 50' },
        api: { type: 'string', enum: ['request', 'downloadFile', 'uploadFile', 'connectSocket'], description: '只看某一种 API' },
        status: { type: 'string', enum: ['pending', 'ok', 'fail', 'throw', 'aborted', 'connecting', 'open', 'closed', 'error'], description: '只看某种状态' },
        urlMatch: { type: 'string', description: 'URL 正则（JS RegExp 源码字符串），例如 "/api/login"' },
        sinceTs: { type: 'number', description: 'startedAt >= 这个时间戳（ms）' },
      },
    },
    handler: async (args) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(o){ return globalThis.__WXMCP__?.readNet(o) || { error: 'shim-not-installed' } })(${JSON.stringify(args ?? {})})`,
      )
    },
  },
  {
    name: 'wxgame_network_clear',
    description: '清空网络请求环形缓冲。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      // clearBuffers 会一起清掉 console/error/net/longTasks
      return await mp.evaluate(`globalThis.__WXMCP__?.clearBuffers() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_mock_request',
    description:
      '拦截匹配某个 URL 正则的 wx.request：直接返回 mock 响应或模拟 fail，不真打后端。pattern 是 JS RegExp 源码（例如 "^https://api\\\\.example\\\\.com/login"）。可以 mock 多条，按注册顺序匹配。返回 mockId，用于 unmock。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'URL 正则源码字符串' },
        flags: { type: 'string', description: '正则 flags，默认空' },
        response: { description: 'success 回调里 res.data 的内容（任意 JSON）' },
        statusCode: { type: 'number', description: 'res.statusCode；默认 200' },
        header: { type: 'object', description: 'res.header；默认 {}' },
        delayMs: { type: 'number', description: '模拟延迟，默认 0' },
        fail: { type: 'string', description: '若设置，则触发 fail({ errMsg }) 而非 success；这里写 errMsg 字符串' },
      },
      required: ['pattern'],
    },
    handler: async (args) => {
      const mp = getMp()
      return await mp.evaluate(
        `(function(o){ return globalThis.__WXMCP__?.addRequestMock(o) || { error: 'shim-not-installed' } })(${JSON.stringify(args)})`,
      )
    },
  },
  {
    name: 'wxgame_unmock_request',
    description: '移除一条或全部 request mock。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'wxgame_mock_request 返回的 mockId；省略则清空所有 mock' },
      },
    },
    handler: async (args) => {
      const mp = getMp()
      if (args?.id) {
        return await mp.evaluate(
          `(function(id){ return globalThis.__WXMCP__?.removeRequestMock(id) || { error: 'shim-not-installed' } })(${JSON.stringify(args.id)})`,
        )
      }
      return await mp.evaluate(`globalThis.__WXMCP__?.clearRequestMocks() || { error: 'shim-not-installed' }`)
    },
  },
  {
    name: 'wxgame_list_request_mocks',
    description: '列出当前生效的所有 request mock。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.listRequestMocks() || { error: 'shim-not-installed' }`)
    },
  },
]
