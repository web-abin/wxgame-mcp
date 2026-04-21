import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// macOS 默认 CLI 路径；可用 WXGAME_MCP_CLI 覆盖
const CLI_CANDIDATES = [
  process.env.WXGAME_MCP_CLI,
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  // 部分用户把 IDE 放在别处
  join(homedir(), 'Applications/wechatwebdevtools.app/Contents/MacOS/cli'),
].filter(Boolean) as string[]

export function resolveCliPath(): string {
  for (const p of CLI_CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `WeChat DevTools CLI not found. Tried:\n  ${CLI_CANDIDATES.join('\n  ')}\nSet WXGAME_MCP_CLI env var to override.`,
  )
}

// 默认自动化端口；和老的 mp-automator-mcp (9420) 错开
export const DEFAULT_AUTO_PORT = 9421

// 截图等产物写到这里
export const CACHE_DIR = join(process.env.WXGAME_MCP_CACHE ?? join(homedir(), '.wxgame-mcp'), 'cache')
