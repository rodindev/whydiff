import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, extname, join } from 'node:path'

// Serves the pages on the origin the snapshots name, the side's own files over the shared ones.
const pages = new URL('pages/', import.meta.url).pathname
const side = process.env.WHYDIFF_README_SIDE ?? 'before'
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
}

createServer((request, response) => {
  const name = basename(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  readFile(join(pages, side, name))
    .catch(() => readFile(join(pages, name)))
    .then(
      (body) => {
        response.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'text/plain' })
        response.end(body)
      },
      () => {
        response.writeHead(404)
        response.end()
      }
    )
}).listen(4173, '127.0.0.1', () => {
  console.log(`serving the ${side} pages on http://127.0.0.1:4173`)
})
