// MCP 的 stdio 通道 stdout 跑协议，stderr 才是日志通道 —— 绝不能 console.log
const LEVEL: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const current = LEVEL[process.env.WXGAME_MCP_LOG?.toLowerCase() ?? 'info'] ?? 20

function write(level: keyof typeof LEVEL, ...args: unknown[]) {
  if (LEVEL[level] < current) return
  const ts = new Date().toISOString().slice(11, 23)
  const line = `[wxgame-mcp ${ts} ${level}] ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  process.stderr.write(line + '\n')
}

export const log = {
  debug: (...a: unknown[]) => write('debug', ...a),
  info: (...a: unknown[]) => write('info', ...a),
  warn: (...a: unknown[]) => write('warn', ...a),
  error: (...a: unknown[]) => write('error', ...a),
}
