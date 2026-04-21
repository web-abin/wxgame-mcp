// MCP 工具定义的通用形状。SDK 需要 inputSchema 是 JSON Schema。
// handler 返回的对象会被 JSON.stringify 作为 text content 返回给 client。
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: any) => Promise<unknown>
}
