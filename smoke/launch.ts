// smoke/launch.ts —— 走完：启/复用 IDE → 连上 → 注 shim → evaluate 一次 → 断开
// 用法：pnpm smoke:launch -- <projectPath> [autoPort]

import { getOrCreate, disconnect, status } from '../src/devtools/session.js'

async function main() {
  const projectPath = process.argv[2]
  const autoPort = process.argv[3] ? Number(process.argv[3]) : undefined
  if (!projectPath) {
    console.error('usage: pnpm smoke:launch -- <projectPath> [autoPort]')
    process.exit(1)
  }
  console.log('[smoke] ensure:', projectPath, 'port:', autoPort ?? '(default)')
  const { mp, ensure, shimInjected } = await getOrCreate({ projectPath, autoPort })
  console.log('[smoke] ensure ok:', { reused: ensure.reused, autoPort: ensure.autoPort, shimInjected })
  console.log('[smoke] status:', status())

  const arithmetic = await mp.evaluate(() => 1 + 2 + 3)
  console.log('[smoke] evaluate 1+2+3 =', arithmetic)

  try {
    const engine = await mp.evaluate(() => (globalThis as any).__WXMCP__?.detectEngine?.())
    console.log('[smoke] engine:', engine)
  } catch (e) {
    console.log('[smoke] detectEngine failed:', (e as Error).message)
  }

  await disconnect()
  console.log('[smoke] disconnected, IDE still running')
}

main().catch((e) => {
  console.error('[smoke] FAIL:', e.stack || e.message)
  process.exit(1)
})
