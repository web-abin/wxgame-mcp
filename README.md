# wxgame-mcp

**MCP server for driving WeChat Mini-GAME DevTools.** Lets Claude Code (or any MCP client) launch/reuse the IDE, capture screenshots (incl. inline images), synthesize taps, read console / errors, **capture & mock network requests**, sample FPS / long-tasks / heap, introspect PIXI scenes (tree / hit-test / find / textures), track ad & audio instances, mock `wx.*` methods — all without touching your game's source.

Sibling of `mp-automator-mcp` (which targets mini-**programs**, not mini-**games**). If your project's `project.config.json` has `"compileType": "game"`, you want this one.

---

## Prerequisites

- **macOS** (Windows/Linux untested — set `WXGAME_MCP_CLI` env var if you want to try)
- **Node.js 20+**
- **WeChat DevTools Stable 2.01.2510xxx or newer**
- In DevTools → 设置 → 安全:
  - **服务端口** = ON
  - **自动化接口打开工具时默认信任项目** = ON

---

## Install & register

### Option A — npm (recommended)

No file to manage. Add this to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "wxgame": {
      "command": "npx",
      "args": ["-y", "wxgame-mcp"]
    }
  }
}
```

Restart Claude Code. Run `/mcp` — you should see `wxgame` listed with 46 tools.

### Option B — single-file bundle

Download `bundle.mjs` from GitHub Releases (`releases/latest/download/bundle.mjs`), drop it anywhere, then:

```json
{
  "mcpServers": {
    "wxgame": {
      "command": "node",
      "args": ["/absolute/path/to/bundle.mjs"]
    }
  }
}
```

---

## How it works

1. **Lifecycle reuse (no thrashing)**: On `wxgame_ensure`, the MCP first TCP-probes the configured auto port (`9421` by default). If it's open, the MCP **reuses** the existing IDE. Only if closed does it spawn `cli auto --project ... --auto-port 9421 --trust-project`. Repeated `wxgame_*` calls never relaunch the IDE.
2. **Runtime shim** (v2): On first connect, the MCP injects a small helper into your game's AppService context (`globalThis.__WXMCP__`). The shim hooks:
   - `console.*` / `wx.onError` / `wx.onUnhandledRejection` → ring buffers (console / error)
   - `wx.request` / `wx.downloadFile` / `wx.uploadFile` / `wx.connectSocket` → network ring buffer + request mocking table
   - `wx.createRewardedVideoAd` / `createInterstitialAd` / `createBannerAd` / `createCustomAd` → ad instance tracker (load/show/close/error counts + state)
   - `wx.createInnerAudioContext` → audio instance tracker
   - `wx.onTouchStart/Move/End/Cancel` → handler list so synthesized taps can fire them
   - rAF tick → FPS sampler + long-task (dt > 50ms) buffer

   The shim is **idempotent** and **zero-dependency** — it doesn't know anything about your engine or your code.
3. **Engine introspection (best-effort)**: The shim probes for PIXI / Laya / Cocos / Phaser / Three. For PIXI, if your app is exposed as `globalThis.__PIXI_APP__` or `globalThis.app`, the MCP can walk the stage, dump the scene tree, and run a UI audit (off-screen elements, tiny interactive hitboxes).

All debug facilities are opt-in per tool call. The MCP doesn't alter your game's behavior until you ask it to.

---

## Tools

### Lifecycle

| Tool | Purpose |
|---|---|
| `wxgame_ensure` | Launch or reuse IDE + open project + connect + inject shim. Call this before any other tool. Input: `projectPath` (required), `autoPort?` (default 9421), `cliPath?`, `waitTimeoutMs?`. |
| `wxgame_connect` | Connect to an already-running auto WS endpoint without lifecycle management. |
| `wxgame_status` | Current connection status + engine detection. |
| `wxgame_restart` | Restart the mini-game so the shim installs **before** any business code runs (needed for comprehensive `tap` handler capture). |
| `wxgame_close` | Disconnect automator; keeps IDE alive for reuse. |
| `wxgame_quit` | `cli quit` — fully exit DevTools. |
| `wxgame_close_project` | `cli close --project <path>` — close the project tab but keep IDE open. |

### Runtime

| Tool | Purpose |
|---|---|
| `wxgame_evaluate` | Run an arbitrary JS expression in AppService context. Escape hatch for anything not covered by other tools. |
| `wxgame_screenshot` | Capture the simulator canvas to a PNG. Returns absolute path. With `inline: true`, also returns the PNG as MCP image content so the LLM can directly see the frame. |
| `wxgame_call_wx` | Proxy for `automator.callWxMethod`. |
| `wxgame_mock_wx` | Mock a `wx.*` method with a JS function string. |
| `wxgame_unmock_wx` | Restore the mock (best-effort; use `wxgame_restart` to be sure). |

### Console & errors

| Tool | Purpose |
|---|---|
| `wxgame_console_tail` | Last N console messages captured by the shim. Filter by `level` / regex `match` / `sinceTs`. |
| `wxgame_errors` | Last N `wx.onError` / `wx.onUnhandledRejection` events. Filter by `sinceTs`. |
| `wxgame_clear_console` | Clear console / error / **network** / **long-task** buffers. |
| `wxgame_system_log` | Pull logs from the IDE side (works even before shim was injected). |

### Input (best-effort)

| Tool | Purpose |
|---|---|
| `wxgame_tap` | Synthesize a `touchstart`+`touchend` at `(x, y)` (simulator logical coords). |
| `wxgame_swipe` | Swipe from `(x1,y1)` to `(x2,y2)` over `durationMs` (default 300). |
| `wxgame_tap_node` | (PIXI) `pixi_find(name)` + `tap(center)` — tap a node by its `name` instead of pixel coords. |

> **Limitation**: Synthesized touches reach only `wx.onTouch*` callbacks registered **after** the shim was injected. If you connect to an already-running game, call `wxgame_restart` before relying on taps.

### Performance

| Tool | Purpose |
|---|---|
| `wxgame_perf_snapshot` | Instantaneous FPS (last 60 frames) + JS heap (when available). |
| `wxgame_perf_record` | Sample every frame for `durationMs` (default 1000). Returns `{ samples, fps: { avg, min, max, p95 }, dtsMs, heap }`. |
| `wxgame_long_tasks_tail` | Frames whose `dt >= thresholdMs` (default 50ms). Useful for "where did we jank" — cross-reference with `wxgame_console_tail` / `wxgame_network_tail` by timestamp. |
| `wxgame_heap_sample` | Sample `performance.memory.usedJSHeapSize` every `intervalMs` for `durationMs` (defaults 100/2000). Returns time series + `deltaMB`. Run while user performs the suspected leak action. |

### Engine / UI introspection

| Tool | Purpose |
|---|---|
| `wxgame_detect_engine` | PIXI / Laya / Cocos / Phaser / Three / unknown. |
| `wxgame_pixi_tree` | For PIXI: recursive stage dump to `maxDepth` (default 3). Requires `globalThis.__PIXI_APP__` or `globalThis.app` to point at an Application instance. |
| `wxgame_pixi_audit` | For PIXI: flag off-screen elements and tiny interactive hitboxes. |
| `wxgame_pixi_hit_test` | For PIXI: list all visible nodes at `(x, y)`, topmost first. Add `onlyInteractive: true` to ignore decorative layers. |
| `wxgame_pixi_find` | For PIXI: recursive name search across stage. Returns paths + bounds + centers. Pipe `center` into `wxgame_tap`. |
| `wxgame_pixi_textures` | For PIXI: enumerate textures referenced by stage, estimate VRAM, show top 30 by size. For "what's blowing up our memory budget". |

### Network (capture + mock)

| Tool | Purpose |
|---|---|
| `wxgame_network_tail` | Last N captured calls (`wx.request` / `downloadFile` / `uploadFile` / `connectSocket`). Per-call: method/url/status/durationMs/payload preview (truncated 2KB)/response preview. Filter by `api` / `status` / `urlMatch` (regex) / `sinceTs`. |
| `wxgame_network_clear` | Clear network buffer (also clears console / errors / long-tasks). |
| `wxgame_mock_request` | Intercept `wx.request` URLs matching a regex `pattern`; return canned `response` / `statusCode` / `header`, or simulate `fail: <errMsg>`. Optional `delayMs`. Returns `mockId`. |
| `wxgame_unmock_request` | Remove one mock by `id`, or omit `id` to clear all mocks. |
| `wxgame_list_request_mocks` | List all active mocks. |

> **Limitation**: Same as taps — requests issued before the shim was injected are not captured/mockable. Call `wxgame_restart` if you need full coverage.

### Wait / sync helpers

| Tool | Purpose |
|---|---|
| `wxgame_wait_for_expression` | Poll a JS expression in AppService until truthy or `timeoutMs` (default 10000, interval 200ms). Useful for "wait until scene loaded" without manual sleep loops. |
| `wxgame_wait_for_console` | Poll the console ring buffer until a log matching regex `match` shows up (filter by `level` / `sinceTs`). |
| `wxgame_wait_for_error` | Poll the error buffer until a new `wx.onError` / unhandled rejection arrives. |

### Device / launch

| Tool | Purpose |
|---|---|
| `wxgame_system_info` | `wx.getSystemInfoSync()` — device / WeChat version / screen / pixel ratio / network / base lib version. Reproducing online bugs starts here. |
| `wxgame_launch_options` | `wx.getLaunchOptionsSync` + `getEnterOptionsSync` + `getAccountInfoSync` — scene value, query, shareTicket, appId, envVersion. For "why does it crash when entering from scene X". |

### Media (ads + audio)

| Tool | Purpose |
|---|---|
| `wxgame_ad_list` | All ad instances created since shim was injected: kind (rewardedVideo/interstitial/banner/custom) / adUnitId / state / load/show/close/error counts / last error / style. **The first thing to check for IAA bugs** — "why isn't my rewarded video showing", "why are revenues zero". |
| `wxgame_audio_list` | All `InnerAudioContext` instances: src / state / volume / loop / play/error counts / `destroyed` flag. Standard fix for "memory grows endlessly" — find audio you forgot to destroy. |

### Storage

| Tool | Purpose |
|---|---|
| `wxgame_storage_get` / `_set` / `_remove` / `_clear` / `_info` | `wx.storage` proxies. |

---

## Typical Claude prompts

Once registered, you can just ask Claude naturally. It'll pick the right tools:

> Ensure DevTools is attached to `~/WeChatProjects/my-game/dist`, then screenshot the current scene and list any console errors from the last minute.

> I changed `src/ui/home.ts`. Reload the simulator, screenshot the home page, and scan the scene for off-screen popups.

> Sample FPS for 3 seconds while I'm playing — report min/avg/p95 and tell me if we have janks worse than 30 fps.

> Mock `wx.login` to return a fixed code, then walk through the login flow.

> The user says a button isn't responding. Dump the PIXI tree, find the button by name, and synthesize a tap at its center.

> Restart the game, then capture all `wx.request` calls for the first 10 seconds and tell me which endpoints failed.

> Mock `https://api.example.com/login` to return `{ ok: true, token: "x" }`, then run through the login flow and screenshot the home page.

> Sample heap for 30 seconds while I open and close the inventory 5 times — is there a leak?

> List all `RewardedVideoAd` instances — why does my game show "广告加载失败"? Cross-reference with `wxgame_network_tail` for the same window.

> Wait until console prints `"scene-ready"`, then screenshot with inline=true so I can see the result directly.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `port 9421 did not open within 60000ms` | DevTools CLI couldn't enable auto mode | Enable 设置 → 安全 → "自动化接口打开工具时默认信任项目" **and** "服务端口". Quit IDE once and retry. |
| `缺失参数 'project / appid' (code 31)` | CLI v1 syntax on new IDE | This MCP uses v2 (`cli auto --project ... --auto-port ...`); if you still see this, your IDE moved the flags again — file an issue. |
| `shim-not-installed` in every tool response | Shim inject failed at connect time | Call `wxgame_restart`. If persistent, check DevTools console for a JS error during shim evaluation. |
| `no-touch-handlers-captured` on `wxgame_tap` | Game registered `wx.onTouchStart` **before** the shim was injected | Call `wxgame_restart` so the shim patches `wx.onTouch*` before business code runs. |
| `no-pixi-app-found` on `wxgame_pixi_tree` | MCP can't locate your `PIXI.Application` instance | Add `globalThis.__PIXI_APP__ = app` in your dev-only bootstrap, or pass the app explicitly via `wxgame_evaluate`. |
| IDE keeps relaunching between calls | Your other tooling kills the IDE / auto port doesn't match | Stick to a single `autoPort` value across calls; check no other tool (e.g. `mp-automator-mcp`) is on the same port (default 9420). |
| `webapi_getwxaasyncsecinfo:fail access_token missing` | WeChat SDK internal (err 41001) — not from this MCP | Ignore. Happens when game isn't bound to an AppID or you're in unbound debug. |

---

## Environment variables

| Var | Purpose |
|---|---|
| `WXGAME_MCP_CLI` | Override the WeChat DevTools CLI path. Default: `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`. |
| `WXGAME_MCP_CACHE` | Override cache dir (screenshots, etc.). Default: `~/.wxgame-mcp/cache`. |
| `WXGAME_MCP_LOG` | Log level to stderr: `debug` / `info` / `warn` / `error`. Default `info`. |

---

## Development

```bash
git clone ...
cd wxgame-mcp
pnpm install
pnpm build          # tsc → dist/*.js
pnpm bundle         # esbuild → dist/bundle.mjs (~2 MB, self-contained)
pnpm smoke:launch -- ~/WeChatProjects/my-game/dist
pnpm smoke:e2e     -- ~/WeChatProjects/my-game/dist
```

Point your local `~/.claude.json` at `dist/bundle.mjs` (or `dist/index.js` for faster iteration, but then you need `node_modules` present).

### Project layout

```
src/
├── index.ts              MCP stdio server, tool registry wiring
├── devtools/
│   ├── cli.ts            spawn wrapper for WeChat DevTools CLI
│   ├── lifecycle.ts      ensure() with port probe + auto-launch
│   └── session.ts        single MP connection + shim injection + reconnect
├── shim/runtime.ts       code injected into AppService (string form)
├── tools/*.ts            one file per tool category
└── util/                 port probe / path resolution / stderr logger
smoke/
├── launch.ts             bare: ensure → connect → evaluate → disconnect
└── e2e.ts                full: ensure → screenshot → console → perf → disconnect
```

---

## License

MIT.
