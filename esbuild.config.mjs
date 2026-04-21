import { build } from 'esbuild'
import { readFileSync, writeFileSync, chmodSync } from 'node:fs'

const OUT = 'dist/bundle.mjs'

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  sourcemap: false,
  banner: {
    // 注意：shebang 后必须换行，否则 Node 会把整行当 shebang 吞掉
    js: [
      "#!/usr/bin/env node",
      "import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{dirname}from'node:path';const require=createRequire(import.meta.url);const __filename=fileURLToPath(import.meta.url);const __dirname=dirname(__filename);"
    ].join('\n')
  },
  external: [
    'fsevents'
  ],
  logLevel: 'info'
})

chmodSync(OUT, 0o755)

const size = readFileSync(OUT).length
console.log(`bundle.mjs size: ${(size / 1024).toFixed(1)} KB`)
