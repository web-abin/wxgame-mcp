import type { ToolDef } from './types.js'
import { lifecycleTools } from './lifecycle.js'
import { runtimeTools } from './runtime.js'
import { consoleTools } from './console.js'
import { inputTools } from './input.js'
import { perfTools } from './perf.js'
import { engineTools } from './engine.js'
import { storageTools } from './storage.js'
import { networkTools } from './network.js'
import { waitTools } from './wait.js'
import { deviceTools } from './device.js'
import { mediaTools } from './media.js'

export const ALL_TOOLS: ToolDef[] = [
  ...lifecycleTools,
  ...runtimeTools,
  ...consoleTools,
  ...inputTools,
  ...perfTools,
  ...engineTools,
  ...storageTools,
  ...networkTools,
  ...waitTools,
  ...deviceTools,
  ...mediaTools,
]

export const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]))
