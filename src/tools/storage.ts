import type { ToolDef } from './types.js'
import { getMp } from '../devtools/session.js'

export const storageTools: ToolDef[] = [
  {
    name: 'wxgame_storage_get',
    description: 'wx.getStorage 代理，读一个 key。',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    handler: async (a) => {
      const mp = getMp()
      return { value: await mp.evaluate(`globalThis.__WXMCP__?.storage.get(${JSON.stringify(a.key)})`) }
    },
  },
  {
    name: 'wxgame_storage_set',
    description: 'wx.setStorage 代理，写一个 key。',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {} },
      required: ['key', 'value'],
    },
    handler: async (a) => {
      const mp = getMp()
      await mp.evaluate(`globalThis.__WXMCP__?.storage.set(${JSON.stringify(a.key)}, ${JSON.stringify(a.value)})`)
      return { ok: true }
    },
  },
  {
    name: 'wxgame_storage_remove',
    description: 'wx.removeStorage 代理。',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    handler: async (a) => {
      const mp = getMp()
      await mp.evaluate(`globalThis.__WXMCP__?.storage.remove(${JSON.stringify(a.key)})`)
      return { ok: true }
    },
  },
  {
    name: 'wxgame_storage_clear',
    description: 'wx.clearStorage 代理。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      await mp.evaluate(`globalThis.__WXMCP__?.storage.clear()`)
      return { ok: true }
    },
  },
  {
    name: 'wxgame_storage_info',
    description: 'wx.getStorageInfo 代理，返回 keys/size。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const mp = getMp()
      return await mp.evaluate(`globalThis.__WXMCP__?.storage.info()`)
    },
  },
]
