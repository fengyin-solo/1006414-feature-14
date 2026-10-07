// 运行 tsc 编译产物前，把 '@/xxx' 解析到编译输出目录下的 src/xxx。
const path = require('node:path')
const Module = require('node:module')

const outDir = '/tmp/slag-verify'
const original = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(outDir, 'src', request.slice(2))
  }
  return original.call(this, request, ...args)
}

require(path.join(outDir, 'scripts/verify-slag.js'))
