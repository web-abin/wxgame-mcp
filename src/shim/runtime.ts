// 这份源码以**字符串**形式 evaluate 进小游戏 AppService 上下文。
// 保持纯 ES5-ish 语法 + 不依赖任何业务项目符号；只依赖 wx.*、console.*、globalThis、performance、requestAnimationFrame。
// 幂等：版本号一致就跳过；版本号升级会重新装。
//
// 注入后，外部通过 automator.evaluate((args) => globalThis.__WXMCP__.xxx(args)) 调用。

export const SHIM_SOURCE = String.raw`
(function installWxgameMcpShim() {
  var VERSION = 2
  if (globalThis.__WXMCP__ && globalThis.__WXMCP__.__version === VERSION) return 'already-installed'

  var CONSOLE_BUF_MAX = 500
  var ERROR_BUF_MAX = 300
  var NET_BUF_MAX = 300
  var LONG_TASK_BUF_MAX = 200
  var LONG_TASK_THRESHOLD_MS = 50

  // ----- console 环形缓冲 -----
  var consoleBuf = []
  var origConsole = {}
  function safeSerialize(a) {
    if (a instanceof Error) return { __err: true, name: a.name, message: a.message, stack: (a.stack || '').split('\n').slice(0, 20).join('\n') }
    if (typeof a === 'function') return '[Function ' + (a.name || 'anonymous') + ']'
    if (typeof a === 'object' && a !== null) {
      try { return JSON.parse(JSON.stringify(a)) } catch (_) { return String(a) }
    }
    return a
  }
  function hookConsole(level) {
    var orig = console[level] || console.log
    origConsole[level] = orig
    console[level] = function () {
      try {
        var args = []
        for (var i = 0; i < arguments.length; i++) args.push(safeSerialize(arguments[i]))
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

  // ----- FPS 采样 + 长任务检测 -----
  var fpsSamples = []
  var longTaskBuf = []
  var lastFrame = 0
  var FPS_SAMPLE_MAX = 600
  function tick() {
    var now = (performance && performance.now) ? performance.now() : Date.now()
    if (lastFrame) {
      var dt = now - lastFrame
      fpsSamples.push({ ts: now, dt: dt })
      if (fpsSamples.length > FPS_SAMPLE_MAX) fpsSamples.splice(0, fpsSamples.length - FPS_SAMPLE_MAX)
      if (dt > LONG_TASK_THRESHOLD_MS) {
        longTaskBuf.push({ ts: Date.now(), dt: Math.round(dt * 10) / 10 })
        if (longTaskBuf.length > LONG_TASK_BUF_MAX) longTaskBuf.splice(0, longTaskBuf.length - LONG_TASK_BUF_MAX)
      }
    }
    lastFrame = now
    try { requestAnimationFrame(tick) } catch (_) {}
  }
  try { requestAnimationFrame(tick) } catch (_) {}

  // ----- 网络抓包 (wx.request / downloadFile / uploadFile / connectSocket) -----
  var netBuf = []
  function pushNet(rec) {
    netBuf.push(rec)
    if (netBuf.length > NET_BUF_MAX) netBuf.splice(0, netBuf.length - NET_BUF_MAX)
  }
  function truncate(v, max) {
    try {
      if (v == null) return v
      if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…(+' + (v.length - max) + ')' : v
      var s = JSON.stringify(v)
      if (s == null) return String(v)
      return s.length > max ? s.slice(0, max) + '…(+' + (s.length - max) + ')' : JSON.parse(s)
    } catch (_) { return String(v) }
  }
  var nextNetId = 1
  // 请求 mock 表：[{ id, pattern: RegExp, response, statusCode, header, delayMs, fail }]
  var requestMocks = []
  function matchMock(url) {
    for (var i = 0; i < requestMocks.length; i++) {
      try { if (requestMocks[i].pattern.test(url)) return requestMocks[i] } catch (_) {}
    }
    return null
  }
  function patchRequestLike(name, urlKey) {
    if (typeof wx === 'undefined' || !wx[name] || wx[name].__wxmcp) return
    var orig = wx[name]
    var wrapper = function (opts) {
      opts = opts || {}
      var id = nextNetId++
      var startTs = Date.now()
      var startPerf = (performance && performance.now) ? performance.now() : startTs
      var url = opts[urlKey] || opts.url || ''
      var rec = {
        id: id, api: name, method: opts.method || (name === 'request' ? 'GET' : name),
        url: url, header: opts.header || null,
        data: name === 'request' ? truncate(opts.data, 2048) : null,
        filePath: opts.filePath || null,
        name: opts.name || null,
        formData: opts.formData ? truncate(opts.formData, 1024) : null,
        startedAt: startTs, status: 'pending',
      }
      pushNet(rec)
      // mock 命中：拦截、走 success
      if (name === 'request') {
        var mock = matchMock(url)
        if (mock) {
          rec.mocked = true
          setTimeout(function () {
            try {
              var endPerf = (performance && performance.now) ? performance.now() : Date.now()
              rec.durationMs = Math.round((endPerf - startPerf) * 10) / 10
              if (mock.fail) {
                rec.status = 'fail'; rec.errMsg = mock.fail
                if (opts.fail) opts.fail({ errMsg: mock.fail })
              } else {
                rec.status = 'ok'; rec.statusCode = mock.statusCode || 200
                rec.responsePreview = truncate(mock.response, 2048)
                if (opts.success) opts.success({ data: mock.response, statusCode: mock.statusCode || 200, header: mock.header || {} })
              }
              if (opts.complete) opts.complete({})
            } catch (_) {}
          }, mock.delayMs || 0)
          return { abort: function () { rec.status = 'aborted' } }
        }
      }
      var origSuccess = opts.success, origFail = opts.fail, origComplete = opts.complete
      opts.success = function (res) {
        var endPerf = (performance && performance.now) ? performance.now() : Date.now()
        rec.durationMs = Math.round((endPerf - startPerf) * 10) / 10
        rec.status = 'ok'
        rec.statusCode = res && res.statusCode
        if (name === 'request') rec.responsePreview = truncate(res && res.data, 2048)
        else if (name === 'downloadFile') rec.tempFilePath = res && res.tempFilePath
        else if (name === 'uploadFile') rec.responsePreview = truncate(res && res.data, 2048)
        if (origSuccess) try { origSuccess(res) } catch (e) { rec.callbackError = String(e) }
      }
      opts.fail = function (e) {
        var endPerf = (performance && performance.now) ? performance.now() : Date.now()
        rec.durationMs = Math.round((endPerf - startPerf) * 10) / 10
        rec.status = 'fail'
        rec.errMsg = e && e.errMsg
        if (origFail) try { origFail(e) } catch (er) { rec.callbackError = String(er) }
      }
      opts.complete = function (r) {
        if (origComplete) try { origComplete(r) } catch (_) {}
      }
      try { return orig.call(wx, opts) } catch (e) {
        rec.status = 'throw'; rec.errMsg = String(e)
        throw e
      }
    }
    wrapper.__wxmcp = true
    try { wx[name] = wrapper } catch (_) {}
  }
  patchRequestLike('request', 'url')
  patchRequestLike('downloadFile', 'url')
  patchRequestLike('uploadFile', 'url')

  // WebSocket: 包 connectSocket，记录 send / 收到的 message / 关闭
  if (typeof wx !== 'undefined' && wx.connectSocket && !wx.connectSocket.__wxmcp) {
    var origConnectSocket = wx.connectSocket
    var wsWrapper = function (opts) {
      opts = opts || {}
      var id = nextNetId++
      var rec = {
        id: id, api: 'connectSocket', method: 'WS', url: opts.url,
        header: opts.header || null, protocols: opts.protocols || null,
        startedAt: Date.now(), status: 'connecting',
        sent: [], received: [],
      }
      pushNet(rec)
      var task
      try { task = origConnectSocket.call(wx, opts) } catch (e) { rec.status = 'throw'; rec.errMsg = String(e); throw e }
      if (task) {
        try {
          if (task.onOpen) task.onOpen(function (r) { rec.status = 'open'; rec.openedAt = Date.now(); rec.openHeader = r && r.header })
          if (task.onMessage) task.onMessage(function (m) {
            rec.received.push({ ts: Date.now(), data: truncate(m && m.data, 1024) })
            if (rec.received.length > 50) rec.received.splice(0, rec.received.length - 50)
          })
          if (task.onClose) task.onClose(function (r) { rec.status = 'closed'; rec.closedAt = Date.now(); rec.closeCode = r && r.code; rec.closeReason = r && r.reason })
          if (task.onError) task.onError(function (e) { rec.status = 'error'; rec.errMsg = e && e.errMsg })
          var origSend = task.send
          if (origSend) {
            task.send = function (sendOpts) {
              sendOpts = sendOpts || {}
              rec.sent.push({ ts: Date.now(), data: truncate(sendOpts.data, 1024) })
              if (rec.sent.length > 50) rec.sent.splice(0, rec.sent.length - 50)
              return origSend.call(task, sendOpts)
            }
          }
        } catch (_) {}
      }
      return task
    }
    wsWrapper.__wxmcp = true
    try { wx.connectSocket = wsWrapper } catch (_) {}
  }

  // ----- 广告实例追踪 -----
  var adInstances = []
  var nextAdId = 1
  function patchAdFactory(name, kind) {
    if (typeof wx === 'undefined' || !wx[name] || wx[name].__wxmcp) return
    var orig = wx[name]
    var wrapper = function (cfg) {
      cfg = cfg || {}
      var inst
      try { inst = orig.call(wx, cfg) } catch (e) { throw e }
      var meta = {
        id: nextAdId++, kind: kind, adUnitId: cfg.adUnitId, style: cfg.style || null,
        createdAt: Date.now(), state: 'created',
        loadCount: 0, showCount: 0, closeCount: 0, errorCount: 0,
        lastError: null, lastClose: null, destroyed: false,
      }
      adInstances.push(meta)
      if (adInstances.length > 100) adInstances.splice(0, adInstances.length - 100)
      try {
        if (inst.onLoad) inst.onLoad(function () { meta.loadCount++; meta.state = 'loaded'; meta.loadedAt = Date.now() })
        if (inst.onError) inst.onError(function (e) { meta.errorCount++; meta.state = 'error'; meta.lastError = { errMsg: e && e.errMsg, errCode: e && e.errCode, ts: Date.now() } })
        if (inst.onClose) inst.onClose(function (r) { meta.closeCount++; meta.state = 'closed'; meta.lastClose = { isEnded: r && r.isEnded, ts: Date.now() } })
        var origShow = inst.show
        if (origShow) {
          inst.show = function () {
            meta.showCount++; meta.lastShowAt = Date.now()
            try { return origShow.apply(inst, arguments) } catch (e) { meta.state = 'show-throw'; meta.lastError = { errMsg: String(e), ts: Date.now() }; throw e }
          }
        }
        var origDestroy = inst.destroy
        if (origDestroy) {
          inst.destroy = function () { meta.destroyed = true; meta.destroyedAt = Date.now(); return origDestroy.apply(inst, arguments) }
        }
      } catch (_) {}
      return inst
    }
    wrapper.__wxmcp = true
    try { wx[name] = wrapper } catch (_) {}
  }
  patchAdFactory('createRewardedVideoAd', 'rewardedVideo')
  patchAdFactory('createInterstitialAd', 'interstitial')
  patchAdFactory('createBannerAd', 'banner')
  patchAdFactory('createCustomAd', 'custom')

  // ----- 音频实例追踪 -----
  var audioInstances = []
  var nextAudioId = 1
  if (typeof wx !== 'undefined' && wx.createInnerAudioContext && !wx.createInnerAudioContext.__wxmcp) {
    var origCreateAudio = wx.createInnerAudioContext
    var audioWrapper = function (opts) {
      var ctx
      try { ctx = origCreateAudio.call(wx, opts) } catch (e) { throw e }
      var meta = {
        id: nextAudioId++, createdAt: Date.now(), state: 'idle',
        src: null, autoplay: false, loop: false, volume: 1,
        playCount: 0, errorCount: 0, lastError: null, destroyed: false,
      }
      audioInstances.push(meta)
      if (audioInstances.length > 200) audioInstances.splice(0, audioInstances.length - 200)
      try {
        // 用 getter/setter 包装常用属性
        var realSrc = '', realLoop = false, realAutoplay = false, realVolume = 1
        try {
          Object.defineProperty(ctx, 'src', {
            get: function () { return realSrc },
            set: function (v) { realSrc = v; meta.src = v }
          })
          Object.defineProperty(ctx, 'loop', { get: function () { return realLoop }, set: function (v) { realLoop = v; meta.loop = v } })
          Object.defineProperty(ctx, 'autoplay', { get: function () { return realAutoplay }, set: function (v) { realAutoplay = v; meta.autoplay = v } })
          Object.defineProperty(ctx, 'volume', { get: function () { return realVolume }, set: function (v) { realVolume = v; meta.volume = v } })
        } catch (_) {
          // 平台不允许 defineProperty 时退化：通过 onPlay 时读 ctx.src 抓
        }
        if (ctx.onPlay) ctx.onPlay(function () { meta.playCount++; meta.state = 'playing'; try { meta.src = meta.src || ctx.src } catch (_) {} })
        if (ctx.onPause) ctx.onPause(function () { meta.state = 'paused' })
        if (ctx.onStop) ctx.onStop(function () { meta.state = 'stopped' })
        if (ctx.onEnded) ctx.onEnded(function () { meta.state = 'ended' })
        if (ctx.onError) ctx.onError(function (e) { meta.errorCount++; meta.state = 'error'; meta.lastError = { errCode: e && e.errCode, errMsg: e && e.errMsg, ts: Date.now() } })
        var origDestroy = ctx.destroy
        if (origDestroy) ctx.destroy = function () { meta.destroyed = true; meta.destroyedAt = Date.now(); return origDestroy.apply(ctx, arguments) }
      } catch (_) {}
      return ctx
    }
    audioWrapper.__wxmcp = true
    try { wx.createInnerAudioContext = audioWrapper } catch (_) {}
  }

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
    if (pixiApp && pixiApp.stage) return pixiApp
    if (!globalThis.PIXI) return null
    try {
      if (globalThis.__PIXI_APP__ && globalThis.__PIXI_APP__.stage) { pixiApp = globalThis.__PIXI_APP__; return pixiApp }
      if (globalThis.app && globalThis.app.stage && globalThis.app.renderer) { pixiApp = globalThis.app; return pixiApp }
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

  function safeBounds(o) {
    try {
      if (!o || !o.getBounds) return null
      var b = o.getBounds()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch (_) { return null }
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
      interactive: !!(o.interactive || o.eventMode === 'static' || o.eventMode === 'dynamic'),
    }
    out.bounds = safeBounds(o)
    if (o.children && o.children.length && depth < maxDepth) {
      out.children = []
      for (var i = 0; i < o.children.length; i++) out.children.push(serializeDO(o.children[i], depth + 1, maxDepth))
    } else if (o.children && o.children.length) {
      out.childrenCount = o.children.length
    }
    return out
  }

  function pathOf(o, idx) {
    return '/' + (o.name || (o.constructor && o.constructor.name) || idx)
  }

  // hit-test：从 stage 后序遍历，找最顶层 visible 且 bounds 包含点的节点
  function pixiHitTest(x, y, opts) {
    opts = opts || {}
    var onlyInteractive = !!opts.onlyInteractive
    var app = findPixiApp()
    if (!app) return { error: 'no-pixi-app-found' }
    var hits = []
    function walk(o, path) {
      if (!o || o.visible === false) return
      if (o.children) for (var i = o.children.length - 1; i >= 0; i--) walk(o.children[i], path + pathOf(o.children[i], i))
      var b = safeBounds(o)
      if (b && b.width > 0 && b.height > 0 && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        var isInteractive = !!(o.interactive || o.eventMode === 'static' || o.eventMode === 'dynamic')
        if (onlyInteractive && !isInteractive) return
        hits.push({ path: path, name: o.name, type: o.constructor && o.constructor.name, bounds: b, interactive: isInteractive })
      }
    }
    walk(app.stage, 'stage')
    return { x: x, y: y, hits: hits.slice(0, 20), total: hits.length }
  }

  // find：递归搜节点 name 包含 needle（不区分大小写）
  function pixiFind(needle, opts) {
    opts = opts || {}
    var limit = opts.limit || 50
    var exact = !!opts.exact
    var visibleOnly = opts.visibleOnly !== false
    var app = findPixiApp()
    if (!app) return { error: 'no-pixi-app-found' }
    var n = String(needle || '').toLowerCase()
    var found = []
    function walk(o, path) {
      if (!o) return
      if (visibleOnly && o.visible === false) return
      var name = (o.name || '').toLowerCase()
      var hit = exact ? name === n : (name.indexOf(n) >= 0)
      if (hit && o.name) {
        var b = safeBounds(o)
        found.push({
          path: path, name: o.name,
          type: o.constructor && o.constructor.name,
          bounds: b,
          center: b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null,
          interactive: !!(o.interactive || o.eventMode === 'static' || o.eventMode === 'dynamic'),
          visible: !!o.visible, alpha: o.alpha,
        })
        if (found.length >= limit) return
      }
      if (o.children) for (var i = 0; i < o.children.length; i++) {
        if (found.length >= limit) return
        walk(o.children[i], path + pathOf(o.children[i], i))
      }
    }
    walk(app.stage, 'stage')
    return { needle: needle, matches: found, total: found.length }
  }

  // textures：枚举 stage 上引用到的所有 BaseTexture / TextureSource，估算 VRAM
  function pixiTextures() {
    var app = findPixiApp()
    if (!app) return { error: 'no-pixi-app-found' }
    var seen = {}
    var list = []
    var totalBytes = 0
    function visitTexture(tex) {
      if (!tex) return
      // PIXI v7- 用 baseTexture / v8 用 source
      var src = tex.source || tex.baseTexture || null
      if (!src) return
      var key = src.uid || src._uid || src.cacheId || src.resource && src.resource.url || src.label || src.id
      if (!key) {
        key = '__' + Object.keys(seen).length
        Object.defineProperty(src, '__wxmcpKey', { value: key, enumerable: false, configurable: true })
      }
      if (seen[key]) { seen[key].refs++; return }
      var w = src.width || src.pixelWidth || 0
      var h = src.height || src.pixelHeight || 0
      var bytes = w * h * 4
      totalBytes += bytes
      var entry = {
        key: String(key),
        width: w, height: h,
        bytes: bytes,
        url: (src.resource && src.resource.url) || src.label || src.cacheId || null,
        refs: 1,
      }
      seen[key] = entry
      list.push(entry)
    }
    function walk(o) {
      if (!o) return
      try {
        if (o.texture) visitTexture(o.texture)
        if (o._texture) visitTexture(o._texture)
        // Sprite 数组 / TilingSprite / Mesh 都走 .texture
      } catch (_) {}
      if (o.children) for (var i = 0; i < o.children.length; i++) walk(o.children[i])
    }
    walk(app.stage)
    list.sort(function (a, b) { return b.bytes - a.bytes })
    return {
      total: list.length,
      estVramMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
      top: list.slice(0, 30),
    }
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

  function tapAt(x, y) {
    if (touchStartCbs.length + touchEndCbs.length === 0) {
      return { warn: 'no-touch-handlers-captured', hint: 'shim was installed after wx.onTouchStart calls; call wxgame_restart then retry' }
    }
    var ts = (performance && performance.now) ? performance.now() : Date.now()
    dispatchAll(touchStartCbs, makeTouchEvent(x, y, ts))
    dispatchAll(touchEndCbs, makeTouchEvent(x, y, ts + 50))
    return { ok: true, x: x, y: y, startHandlers: touchStartCbs.length, endHandlers: touchEndCbs.length }
  }

  // ----- 对外 API -----
  var API = {
    __version: VERSION,
    ping: function () { return { ok: true, ts: Date.now(), version: VERSION } },

    readConsole: function (opts) {
      opts = opts || {}
      var limit = opts.limit || 100
      var level = opts.level
      var since = opts.sinceTs || 0
      var match = opts.match
      var arr = consoleBuf
      if (level && level.length) {
        var set = {}
        for (var i = 0; i < level.length; i++) set[level[i]] = 1
        arr = arr.filter(function (x) { return set[x.level] })
      }
      if (since) arr = arr.filter(function (x) { return x.ts >= since })
      if (match) {
        var re
        try { re = new RegExp(match) } catch (_) { re = null }
        if (re) arr = arr.filter(function (x) {
          try {
            for (var j = 0; j < x.args.length; j++) {
              var v = x.args[j]
              if (typeof v === 'string' && re.test(v)) return true
              if (v && typeof v === 'object' && re.test(JSON.stringify(v))) return true
            }
          } catch (_) {}
          return false
        })
      }
      return arr.slice(-limit)
    },
    readErrors: function (opts) {
      opts = opts || {}
      var since = opts.sinceTs || 0
      var arr = since ? errorBuf.filter(function (x) { return x.ts >= since }) : errorBuf
      return arr.slice(-(opts.limit || 50))
    },
    clearBuffers: function () { consoleBuf.length = 0; errorBuf.length = 0; netBuf.length = 0; longTaskBuf.length = 0; return { ok: true } },

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
    longTasks: function (opts) {
      opts = opts || {}
      var limit = opts.limit || 50
      var thresholdMs = opts.thresholdMs || LONG_TASK_THRESHOLD_MS
      return longTaskBuf.filter(function (x) { return x.dt >= thresholdMs }).slice(-limit)
    },
    heapSample: function (ms, intervalMs) {
      ms = ms || 2000
      intervalMs = intervalMs || 100
      return new Promise(function (resolve) {
        var samples = []
        var endAt = Date.now() + ms
        function step() {
          try {
            if (performance && performance.memory) samples.push({ ts: Date.now(), used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize })
            else samples.push({ ts: Date.now(), used: null })
          } catch (_) { samples.push({ ts: Date.now(), used: null }) }
          if (Date.now() < endAt) setTimeout(step, intervalMs)
          else {
            var used = samples.map(function (s) { return s.used }).filter(function (v) { return v != null })
            var deltaMB = null
            if (used.length >= 2) deltaMB = Math.round((used[used.length - 1] - used[0]) / 1024 / 1024 * 100) / 100
            resolve({ samples: samples, deltaMB: deltaMB, windowMs: ms })
          }
        }
        step()
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
              var isInteractive = !!(o.interactive || o.eventMode === 'static' || o.eventMode === 'dynamic')
              if (isInteractive && (b.width < 10 || b.height < 10)) {
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
    pixiHitTest: pixiHitTest,
    pixiFind: pixiFind,
    pixiTextures: pixiTextures,
    tapNode: function (needle, opts) {
      var res = pixiFind(needle, opts)
      if (res.error) return res
      if (!res.matches || !res.matches.length) return { error: 'node-not-found', needle: needle }
      var hit = res.matches[0]
      if (!hit.center) return { error: 'node-has-no-bounds', match: hit }
      var r = tapAt(hit.center.x, hit.center.y)
      return { matched: hit, tap: r }
    },

    tap: function (x, y) { return tapAt(x, y) },
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

    // ----- 网络 -----
    readNet: function (opts) {
      opts = opts || {}
      var limit = opts.limit || 50
      var arr = netBuf
      if (opts.api) arr = arr.filter(function (r) { return r.api === opts.api })
      if (opts.status) arr = arr.filter(function (r) { return r.status === opts.status })
      if (opts.urlMatch) {
        var re
        try { re = new RegExp(opts.urlMatch) } catch (_) { re = null }
        if (re) arr = arr.filter(function (r) { return re.test(r.url || '') })
      }
      if (opts.sinceTs) arr = arr.filter(function (r) { return r.startedAt >= opts.sinceTs })
      return arr.slice(-limit)
    },
    addRequestMock: function (cfg) {
      var re
      try { re = new RegExp(cfg.pattern, cfg.flags || '') } catch (e) { return { error: 'bad-pattern: ' + e.message } }
      var entry = { id: 'mock-' + (Date.now()) + '-' + Math.floor(Math.random() * 1000), pattern: re, response: cfg.response, statusCode: cfg.statusCode || 200, header: cfg.header, delayMs: cfg.delayMs || 0, fail: cfg.fail || null }
      requestMocks.push(entry)
      return { ok: true, id: entry.id, total: requestMocks.length }
    },
    removeRequestMock: function (id) {
      var before = requestMocks.length
      requestMocks = requestMocks.filter(function (m) { return m.id !== id })
      return { ok: true, removed: before - requestMocks.length }
    },
    clearRequestMocks: function () { requestMocks = []; return { ok: true } },
    listRequestMocks: function () { return requestMocks.map(function (m) { return { id: m.id, pattern: m.pattern.source, flags: m.pattern.flags, statusCode: m.statusCode, delayMs: m.delayMs, fail: m.fail } }) },

    // ----- 广告 / 音频 -----
    adList: function () {
      return adInstances.map(function (a) {
        return {
          id: a.id, kind: a.kind, adUnitId: a.adUnitId,
          state: a.state, destroyed: a.destroyed,
          loadCount: a.loadCount, showCount: a.showCount, closeCount: a.closeCount, errorCount: a.errorCount,
          lastError: a.lastError, lastClose: a.lastClose, style: a.style,
          createdAt: a.createdAt, loadedAt: a.loadedAt, lastShowAt: a.lastShowAt, destroyedAt: a.destroyedAt,
        }
      })
    },
    audioList: function () {
      return audioInstances.map(function (a) {
        return {
          id: a.id, state: a.state, src: a.src, autoplay: a.autoplay, loop: a.loop, volume: a.volume,
          playCount: a.playCount, errorCount: a.errorCount, lastError: a.lastError,
          destroyed: a.destroyed, createdAt: a.createdAt, destroyedAt: a.destroyedAt,
        }
      })
    },

    // ----- 设备信息 -----
    systemInfo: function () {
      try { return wx.getSystemInfoSync() } catch (e) { return { error: String(e) } }
    },
    launchOptions: function () {
      var out = {}
      try { out.launch = wx.getLaunchOptionsSync && wx.getLaunchOptionsSync() } catch (e) { out.launchErr = String(e) }
      try { out.enter = wx.getEnterOptionsSync && wx.getEnterOptionsSync() } catch (e) { out.enterErr = String(e) }
      try { out.account = wx.getAccountInfoSync && wx.getAccountInfoSync() } catch (e) { out.accountErr = String(e) }
      return out
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
  return 'installed-v' + VERSION
})()
`
