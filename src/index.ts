import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS, TOOL_BY_NAME } from './tools/index.js'
import { log } from './util/log.js'

const server = new Server(
  { name: 'wxgame-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = req.params.arguments ?? {}
  const tool = TOOL_BY_NAME[name]
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] }
  }
  try {
    const result = await tool.handler(args)
    // handler 可返回 { __mcp_content: [...] } 来直接给出 MCP content（如截图内联 image）
    if (result && typeof result === 'object' && Array.isArray((result as any).__mcp_content)) {
      return { content: (result as any).__mcp_content }
    }
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] }
  } catch (e) {
    const err = e as Error
    log.error(`tool ${name} failed:`, err)
    return { isError: true, content: [{ type: 'text', text: `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 10).join('\n')}` }] }
  }
})

const transport = new StdioServerTransport()
server.connect(transport).then(
  () => log.info(`wxgame-mcp ready, ${ALL_TOOLS.length} tools registered`),
  (e) => {
    log.error('failed to start:', e)
    process.exit(1)
  },
)
