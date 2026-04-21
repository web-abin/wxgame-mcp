import { spawnCli, runCli } from './cli.js'
import { DEFAULT_AUTO_PORT } from '../util/paths.js'
import { probePort, waitForPort } from '../util/port.js'
import { log } from '../util/log.js'
import type { ChildProcess } from 'node:child_process'

export interface EnsureOptions {
  projectPath: string
  autoPort?: number
  cliPath?: string
  waitTimeoutMs?: number
}

export interface EnsureResult {
  autoPort: number
  wsEndpoint: string
  reused: boolean
}

// 记录我们自己启动的 cli auto 子进程，便于后面需要时 kill
let spawned: ChildProcess | null = null

export async function ensureDevTools(opts: EnsureOptions): Promise<EnsureResult> {
  const autoPort = opts.autoPort ?? DEFAULT_AUTO_PORT
  const wsEndpoint = `ws://127.0.0.1:${autoPort}`

  // 1. 端口探活 —— 已开则复用
  if (await probePort(autoPort)) {
    log.info(`auto port ${autoPort} already open — reusing existing IDE`)
    return { autoPort, wsEndpoint, reused: true }
  }

  // 2. 启动 cli auto —— 用 v2 子命令格式（miniprogram-automator 内置 launch 用的是旧 v1，对新版 IDE 会报 code 31）
  const args = [
    'auto',
    '--project', opts.projectPath,
    '--auto-port', String(autoPort),
    '--trust-project',
  ]
  spawned = spawnCli(args, { cliPath: opts.cliPath })

  // 3. 等端口起来
  try {
    await waitForPort(autoPort, opts.waitTimeoutMs ?? 60_000)
  } catch (e) {
    throw new Error(
      `${(e as Error).message}\n` +
        `—— 可能原因：\n` +
        `    1) 开发者工具里 设置 → 安全 → "服务端口" 未打开\n` +
        `    2) 设置 → 安全 → "自动化接口打开工具时默认信任项目" 未打开\n` +
        `    3) 传入的 projectPath 不是合法小程序/小游戏项目目录（需有 project.config.json）\n` +
        `    4) WXGAME_MCP_CLI 指向的 cli 已过期`,
    )
  }

  return { autoPort, wsEndpoint, reused: false }
}

// 优雅关 IDE（只在用户显式调 quit 时）
export async function quitDevTools(cliPath?: string): Promise<void> {
  await runCli(['quit'], { cliPath })
  if (spawned && !spawned.killed) {
    try {
      spawned.kill()
    } catch {}
  }
  spawned = null
}

export async function closeProject(projectPath: string, cliPath?: string): Promise<void> {
  await runCli(['close', '--project', projectPath], { cliPath })
}
