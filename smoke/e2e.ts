// smoke/e2e.ts —— 全流程：ensure → screenshot → console_tail → perf_record → disconnect
// 用法：pnpm smoke:e2e -- <projectPath>

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getOrCreate, disconnect, getMp } from '../src/devtools/session.js'
import { SHIM_SOURCE } from '../src/shim/runtime.js'

async function main() {
  const projectPath = process.argv[2]
  if (!projectPath) {
    console.error('usage: pnpm smoke:e2e -- <projectPath>')
    process.exit(1)
  }
  const outDir = join(process.cwd(), 'out')
  mkdirSync(outDir, { recursive: true })

  console.log('[e2e] ensure')
  const { ensure } = await getOrCreate({ projectPath })
  console.log('    reused:', ensure.reused, 'port:', ensure.autoPort)

  const mp = getMp()

  // 重复注 shim 幂等
  console.log('[e2e] re-inject shim (should be idempotent)')
  const reinject = await mp.evaluate(SHIM_SOURCE)
  console.log('   →', reinject)

  console.log('[e2e] screenshot')
  const shotPath = join(outDir, `shot-${Date.now()}.png`)
  await mp.screenshot({ fullPage: true, path: shotPath })
  console.log('   → ', shotPath)

  console.log('[e2e] trigger a console.log + an error for buffers')
  await mp.evaluate(() => {
    console.log('[smoke-probe] hello from e2e')
    console.warn('[smoke-probe] a warning')
    try { (globalThis as any).__doesNotExist.boom() } catch (e) { console.error('[smoke-probe] caught error', e) }
  })

  await new Promise((r) => setTimeout(r, 200))

  const logs = await mp.evaluate(`globalThis.__WXMCP__?.readConsole({ limit: 10 })`)
  console.log('[e2e] console tail (last 10):', logs)

  const perf = await mp.evaluate(`globalThis.__WXMCP__?.perfRecord(1000)`)
  console.log('[e2e] perf record (1s):', perf)

  await disconnect()
  console.log('[e2e] done (IDE still up — use cli quit to close)')
}

main().catch((e) => {
  console.error('[e2e] FAIL:', e.stack || e.message)
  process.exit(1)
})
