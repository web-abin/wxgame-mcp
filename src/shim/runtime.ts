// 这份源码以**字符串**形式 evaluate 进小游戏 AppService 上下文。
// 保持纯 ES5-ish 语法 + 不依赖任何业务项目符号；只依赖 wx.*、console.*、globalThis、performance、requestAnimationFrame。
// 幂等：多次注入只安装一次（通过 globalThis.__WXMCP__ 占位判断）。
//
// 注入后，外部通过 automator.evaluate((args) => globalThis.__WXMCP__.xxx(args)) 调用。

export const SHIM_SOURCE = String.raw`
(function installWxgameMcpShim() {
  if (globalThis.__WXMCP__ && globalThis.__WXMCP__.__version >= 1) return 'already-installed'

  var VERSION = 1
  var CONSOLE_BUF_MAX = 500
  var ERROR_BUF_MAX = 300

  // ----- console 环形缓冲 -----
  var consoleBuf = []
  var origConsole = {}
  function hookConsole(level) {
    var orig = console[level] || console.log
    origConsole[level] = orig
    console[level] = function () {
      try {
        var args = []
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i]
          if (a instanceof Error) args.push({ __err: true, name: a.name, message: a.message, stack: (a.stack || '').split('\n').slice(0, 20).join('\n') })
          else if (typeof a === 'function') args.push('[Function ' + (a.name || 'anonymous') + ']')
          else if (typeof a === 'object' && a !== null) {
            try { args.push(JSON.parse(JSON.stringify(a))) } catch (_) { args.push(String(a)) }
          }
          else args.push(a)
        }
        consoleBuf.push({ ts: Date.now(), level: level, args: args })
        if (consoleBuf.length > CONSOLE_BUF_MAX) consoleBuf.splice(0, consoleBuf.length - CONSOLE_BUF_MAX)
      } catch (_) { /* shim 本身永不抛 */ }
      try { return orig.apply(console, arguments) } catch (_) {}
    }
  }
  ;['log', 'info', 'warn', 'error', 'debug'].forEach(hookConsole)

  // ----- 错误缓冲 -----
  var errorBuf = []
  function pushError(kind, payload) {
    errorBuf.push({ ts: Date.now(), kind: kind, payload: payload })
    if (errorBuf.length > ERROR_BUF_MAX) errorBuf.splice(0, errorBuf.length - ERROR_BUF_MAX)
  }
  try { wx.onError && wx.onError(function (e) { pushError('error', typeof e === 'string' ? { message: e } : { message: e && e.message, stack: e && e.stack }) }) } catch (_) {}
  try { wx.onUnhandledRejection && wx.onUnhandledRejection(function (e) { pushError('unhandled-rejection', { reason: e && (e.reason && (e.reason.message || e.reason)) || String(e) }) }) } catch (_) {}

  // ----- FPS 采样 -----
  var fpsSamples = [] // 每一帧的 dt(ms)
  var lastFrame = 0
  var FPS_SAMPLE_MAX = 600 // ~10s@60fps
  function tick() {
    var now = (performance && performance.now) ? performance.now() : Date.now()
    if (lastFrame) {
      var dt = now - lastFrame
      fpsSamples.push({ ts: now, dt: dt })
      if (fpsSamples.length > FPS_SAMPLE_MAX) fpsSamples.splice(0, fpsSamples.length - FPS_SAMPLE_MAX)
    }
    lastFrame = now
    try { requestAnimationFrame(tick) } catch (_) {}
  }
  try { requestAnimationFrame(tick) } catch (_) {}

  // ----- 引擎探测 -----
  function detectEngine() {
    try {
      if (globalThis.PIXI && globalThis.PIXI.Application) return { name: 'pixi', version: globalThis.PIXI.VERSION || 'unknown' }
      if (globalThis.Laya) return { name: 'laya', version: (globalThis.Laya.version || 'unknown') }
      if (globalThis.cc) return { name: 'cocos', version: (globalThis.cc.ENGINE_VERSION || 'unknown') }
      if (globalThis.Phaser) return { name: 'phaser', version: (globalThis.Phaser.VERSION || 'unknown') }
      if (globalThis.THREE) return { name: 'three', version: (globalThis.THREE.REVISION || 'unknown') }
    } catch (_) {}
    return { name: 'unknown' }
  }

  // ----- 找出活跃的 PIXI.Application（尽力） -----
  var pixiApp = null
  function findPixiApp() {
    if (pixiApp) return pixiApp
    if (!globalThis.PIXI) return null
    try {
      // 用户若自己把 app 挂到 globalThis.app / globalThis.__PIXI_APP__ 最省事
      if (globalThis.__PIXI_APP__ && globalThis.__PIXI_APP__.stage) { pixiApp = globalThis.__PIXI_APP__; return pixiApp }
      if (globalThis.app && globalThis.app.stage && globalThis.app.renderer) { pixiApp = globalThis.app; return pixiApp }
      // 遍历 Ticker.shared 上挂的 context 中找 Application
      var t = globalThis.PIXI.Ticker && globalThis.PIXI.Ticker.shared
      if (t && t._head) {
        var node = t._head.next
        while (node) {
          if (node.context && node.context.stage && node.context.renderer) { pixiApp = node.context; return pixiApp }
          node = node.next
        }
      }
    } catch (_) {}
    return null
  }

  function serializeDO(o, depth, maxDepth) {
    if (!o) return null
    var out = {
      name: o.name || null,
      type: o.constructor && o.constructor.name || typeof o,
      visible: !!o.visible,
      alpha: typeof o.alpha === 'number' ? o.alpha : null,
      x: o.x, y: o.y,
      scaleX: o.scale && o.scale.x, scaleY: o.scale && o.scale.y,
      interactive: !!o.interactive,
    }
    try {
      if (o.getBounds) {
        var b = o.getBounds()
        out.bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
      }
    } catch (_) { out.bounds = null }
    if (o.children && o.children.length && depth < maxDepth) {
      out.children = []
      for (var i = 0; i < o.children.length; i++) out.children.push(serializeDO(o.children[i], depth + 1, maxDepth))
    } else if (o.children && o.children.length) {
      out.childrenCount = o.children.length
    }
    return out
  }

  // ----- 合成 tap（best-effort；只能抓到 shim 注入之后注册的 wx.onTouch*） -----
  var touchStartCbs = [], touchMoveCbs = [], touchEndCbs = [], touchCancelCbs = []
  function patchTouch() {
    if (!wx) return
    var reg = function (list, name) {
      var orig = wx[name]
      if (!orig || orig.__wxmcp) return
      var wrapper = function (cb) { try { list.push(cb) } catch (_) {}; try { return orig.call(wx, cb) } catch (_) {} }
      wrapper.__wxmcp = true
      try { wx[name] = wrapper } catch (_) {}
    }
    reg(touchStartCbs, 'onTouchStart')
    reg(touchMoveCbs, 'onTouchMove')
    reg(touchEndCbs, 'onTouchEnd')
    reg(touchCancelCbs, 'onTouchCancel')
  }
  patchTouch()

  function makeTouchEvent(x, y, ts) {
    var t = { identifier: 0, pageX: x, pageY: y, clientX: x, clientY: y, screenX: x, screenY: y, force: 1 }
    return { timeStamp: ts, touches: [t], changedTouches: [t], targetTouches: [t] }
  }
  function dispatchAll(list, ev) { for (var i = 0; i < list.length; i++) { try { list[i](ev) } catch (_) {} } }

  // ----- 对外 API -----
  var API = {
    __version: VERSION,
    ping: function () { return { ok: true, ts: Date.now(), version: VERSION } },

    readConsole: function (opts) {
      opts = opts || {}
      var limit = opts.limit || 100
      var level = opts.level
      var arr = consoleBuf
      if (level && level.length) {
        var set = {}
        for (var i = 0; i < level.length; i++) set[level[i]] = 1
        arr = arr.filter(function (x) { return set[x.level] })
      }
      return arr.slice(-limit)
    },
    readErrors: function (opts) {
      opts = opts || {}
      return errorBuf.slice(-(opts.limit || 50))
    },
    clearBuffers: function () { consoleBuf.length = 0; errorBuf.length = 0; return { ok: true } },

    perfSnapshot: function () {
      var n = fpsSamples.length
      var avgDt = 0
      var take = Math.min(60, n)
      for (var i = n - take; i < n; i++) avgDt += fpsSamples[i].dt
      var fps = take > 0 ? (1000 / (avgDt / take)) : 0
      var heap = null
      try { if (performance && performance.memory) heap = { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } } catch (_) {}
      return { fps: Math.round(fps * 10) / 10, samples: take, heap: heap }
    },
    perfRecord: function (ms) {
      ms = ms || 1000
      return new Promise(function (resolve) {
        var start = fpsSamples.length
        var endAt = Date.now() + ms
        function finish() {
          var slice = fpsSamples.slice(start)
          var n = slice.length
          if (n === 0) { resolve({ samples: 0, fps: { avg: 0, min: 0, max: 0, p95: 0 } }); return }
          var sumDt = 0, maxDt = 0, minDt = Infinity
          var dts = []
          for (var i = 0; i < n; i++) {
            var d = slice[i].dt
            dts.push(d)
            sumDt += d
            if (d > maxDt) maxDt = d
            if (d < minDt) minDt = d
          }
          dts.sort(function (a, b) { return a - b })
          var p95dt = dts[Math.floor(n * 0.95)]
          resolve({
            samples: n,
            windowMs: ms,
            fps: { avg: Math.round(1000 / (sumDt / n) * 10) / 10, min: Math.round(1000 / maxDt * 10) / 10, max: Math.round(1000 / minDt * 10) / 10, p95: Math.round(1000 / p95dt * 10) / 10 },
            dtsMs: { avg: sumDt / n, min: minDt, max: maxDt, p95: p95dt },
            heap: (function () { try { return performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null } catch (_) { return null } })(),
          })
        }
        var remain = endAt - Date.now()
        if (remain > 0) setTimeout(finish, remain); else finish()
      })
    },

    detectEngine: detectEngine,

    pixiTree: function (maxDepth) {
      maxDepth = maxDepth || 3
      var app = findPixiApp()
      if (!app) return { error: 'no-pixi-app-found', hint: 'expose app as globalThis.__PIXI_APP__ or globalThis.app' }
      var rendererInfo = null
      try {
        var r = app.renderer
        rendererInfo = {
          width: r.width, height: r.height, resolution: r.resolution,
          type: r.type === 1 ? 'webgl' : 'canvas',
          bgColor: r.backgroundColor,
        }
      } catch (_) {}
      return {
        renderer: rendererInfo,
        stage: serializeDO(app.stage, 0, maxDepth),
      }
    },
    pixiAudit: function () {
      var app = findPixiApp()
      if (!app) return { error: 'no-pixi-app-found' }
      var issues = []
      var screenW = app.renderer.width, screenH = app.renderer.height
      function walk(o, path) {
        if (!o) return
        try {
          if (o.visible === false) return
          if (o.getBounds) {
            var b = o.getBounds()
            if (b.width > 0 && b.height > 0) {
              if (b.x + b.width < 0 || b.y + b.height < 0 || b.x > screenW || b.y > screenH) {
                issues.push({ kind: 'off-screen', path: path, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
              }
              if (o.interactive && (b.width < 10 || b.height < 10)) {
                issues.push({ kind: 'tiny-interactive', path: path, bounds: b })
              }
            }
          }
        } catch (_) {}
        if (o.children) for (var i = 0; i < o.children.length; i++) walk(o.children[i], path + '/' + (o.children[i].name || o.children[i].constructor.name || i))
      }
      walk(app.stage, 'stage')
      return { screen: { w: screenW, h: screenH }, issues: issues }
    },

    tap: function (x, y) {
      if (touchStartCbs.length + touchEndCbs.length === 0) {
        return { warn: 'no-touch-handlers-captured', hint: 'shim was installed after wx.onTouchStart calls; call wxgame_restart then retry' }
      }
      var ts = (performance && performance.now) ? performance.now() : Date.now()
      dispatchAll(touchStartCbs, makeTouchEvent(x, y, ts))
      dispatchAll(touchEndCbs, makeTouchEvent(x, y, ts + 50))
      return { ok: true, startHandlers: touchStartCbs.length, endHandlers: touchEndCbs.length }
    },
    swipe: function (x1, y1, x2, y2, durationMs) {
      if (touchStartCbs.length + touchMoveCbs.length + touchEndCbs.length === 0) {
        return { warn: 'no-touch-handlers-captured' }
      }
      durationMs = durationMs || 300
      var ts0 = (performance && performance.now) ? performance.now() : Date.now()
      dispatchAll(touchStartCbs, makeTouchEvent(x1, y1, ts0))
      var steps = 8
      for (var i = 1; i <= steps; i++) {
        ;(function (i) {
          setTimeout(function () {
            var t = i / steps
            var x = x1 + (x2 - x1) * t
            var y = y1 + (y2 - y1) * t
            dispatchAll(touchMoveCbs, makeTouchEvent(x, y, ts0 + durationMs * t))
            if (i === steps) dispatchAll(touchEndCbs, makeTouchEvent(x2, y2, ts0 + durationMs))
          }, durationMs * (i / steps))
        })(i)
      }
      return { ok: true, steps: steps, durationMs: durationMs }
    },

    storage: {
      get: function (key) { return new Promise(function (resolve, reject) { wx.getStorage({ key: key, success: function (r) { resolve(r.data) }, fail: function (e) { resolve(null) } }) }) },
      set: function (key, value) { return new Promise(function (resolve, reject) { wx.setStorage({ key: key, data: value, success: function () { resolve(true) }, fail: function (e) { reject(e) } }) }) },
      remove: function (key) { return new Promise(function (resolve, reject) { wx.removeStorage({ key: key, success: function () { resolve(true) }, fail: function (e) { reject(e) } }) }) },
      clear: function () { return new Promise(function (resolve, reject) { wx.clearStorage({ success: function () { resolve(true) }, fail: function (e) { reject(e) } }) }) },
      info: function () { return new Promise(function (resolve) { wx.getStorageInfo({ success: resolve, fail: function (e) { resolve({ error: e }) } }) }) },
    },
  }

  globalThis.__WXMCP__ = API
  return 'installed'
})()
`
