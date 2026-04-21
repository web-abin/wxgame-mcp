import { spawn, type ChildProcess } from 'node:child_process'
import { resolveCliPath } from '../util/paths.js'
import { log } from '../util/log.js'

export interface CliOptions {
  cliPath?: string
  cwd?: string
}

// 跑一次 CLI，返回 { code, stdout, stderr } —— 用在 open / close / quit 这种同步型命令
export function runCli(args: string[], opts: CliOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const cli = opts.cliPath ?? resolveCliPath()
  log.debug('cli run', cli, args.join(' '))
  return new Promise((resolve) => {
    const child = spawn(cli, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

// 启动常驻进程（auto 模式）；返回 child，调用方自己管理
export function spawnCli(args: string[], opts: CliOptions = {}): ChildProcess {
  const cli = opts.cliPath ?? resolveCliPath()
  log.info('cli spawn', cli, args.join(' '))
  const child = spawn(cli, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  child.stdout.on('data', (b) => log.debug('[cli stdout]', b.toString().trimEnd()))
  child.stderr.on('data', (b) => log.debug('[cli stderr]', b.toString().trimEnd()))
  child.on('exit', (code, sig) => log.info(`cli auto exited code=${code} sig=${sig ?? ''}`))
  return child
}
