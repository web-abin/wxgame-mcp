import { createConnection } from 'node:net'

// tcp 探活：能连上就算开
export function probePort(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host })
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {}
      resolve(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(timeoutMs, () => done(false))
  })
}

// 轮询直到端口 open 或超时
export async function waitForPort(port: number, timeoutMs = 60_000, intervalMs = 500): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await probePort(port)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`)
}
