import automator from 'miniprogram-automator'
import { ensureDevTools, type EnsureOptions, type EnsureResult } from './lifecycle.js'
import { SHIM_SOURCE } from '../shim/runtime.js'
import { log } from '../util/log.js'

// miniprogram-automator 的 MiniProgram 类型 —— 它没对外导 d.ts 的详细类型，用宽松签名
export type MiniProgram = {
  disconnect(): Promise<void>
  close(): Promise<void>
  evaluate<T = any>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>
  screenshot(opts?: { fullPage?: boolean; path?: string }): Promise<string | Buffer>
  callWxMethod(method: string, ...args: any[]): Promise<any>
  mockWxMethod(method: string, fn: any, ...args: any[]): Promise<void>
  systemLog?(filter?: any): Promise<any>
  restart?(): Promise<void>
  exposeFunction?(name: string, fn: (...args: any[]) => any): Promise<void>
}

interface Session {
  mp: MiniProgram
  projectPath: string
  autoPort: number
  wsEndpoint: string
  connectedAt: number
  shimInjected: boolean
}

let current: Session | null = null

export interface SessionStatus {
  connected: boolean
  projectPath?: string
  autoPort?: number
  wsEndpoint?: string
  connectedAt?: number
  shimInjected?: boolean
}

export function status(): SessionStatus {
  if (!current) return { connected: false }
  return {
    connected: true,
    projectPath: current.projectPath,
    autoPort: current.autoPort,
    wsEndpoint: current.wsEndpoint,
    connectedAt: current.connectedAt,
    shimInjected: current.shimInjected,
  }
}

export async function getOrCreate(opts: EnsureOptions): Promise<{ mp: MiniProgram; ensure: EnsureResult; shimInjected: boolean }> {
  // 已有 session 且 projectPath 一致 → 直接返回
  if (current && current.projectPath === opts.projectPath) {
    try {
      // 活性检查：evaluate 一次最简单语句
      await current.mp.evaluate(() => 1)
      return { mp: current.mp, ensure: { autoPort: current.autoPort, wsEndpoint: current.wsEndpoint, reused: true }, shimInjected: current.shimInjected }
    } catch (e) {
      log.warn('existing session dead, reconnecting:', (e as Error).message)
      current = null
    }
  }

  // projectPath 变了 → 先断开旧的
  if (current) {
    try {
      await current.mp.disconnect()
    } catch {}
    current = null
  }

  const ensure = await ensureDevTools(opts)
  log.info(`connecting to ${ensure.wsEndpoint} (reused=${ensure.reused})`)
  const mp = (await automator.connect({ wsEndpoint: ensure.wsEndpoint })) as unknown as MiniProgram

  // 首次连接注入 shim（幂等，重复 evaluate 安全）
  let shimInjected = false
  try {
    await mp.evaluate(SHIM_SOURCE)
    shimInjected = true
    log.info('shim injected')
  } catch (e) {
    log.warn('shim inject failed:', (e as Error).message)
  }

  current = {
    mp,
    projectPath: opts.projectPath,
    autoPort: ensure.autoPort,
    wsEndpoint: ensure.wsEndpoint,
    connectedAt: Date.now(),
    shimInjected,
  }
  return { mp, ensure, shimInjected }
}

export async function reinjectShim(): Promise<boolean> {
  if (!current) throw new Error('no session — call wxgame_ensure first')
  try {
    await current.mp.evaluate(SHIM_SOURCE)
    current.shimInjected = true
    return true
  } catch (e) {
    log.error('reinject shim failed:', e)
    return false
  }
}

export function getMp(): MiniProgram {
  if (!current) throw new Error('not connected — call wxgame_ensure first')
  return current.mp
}

export async function disconnect(): Promise<void> {
  if (!current) return
  try {
    await current.mp.disconnect()
  } catch {}
  current = null
}
