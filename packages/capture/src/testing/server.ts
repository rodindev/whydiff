import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'

const PAGES = new URL('../../fixtures/pages/', import.meta.url)
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.css': 'text/css' }

export interface FixtureServer {
  readonly port: number
  url(path: string): string
  close(): Promise<void>
}

/** Serves the fixture pages on both loopback names so a page can embed a cross-site frame. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    const path = normalize(new URL(request.url ?? '/', 'http://fixture').pathname)
    const port = String(address(server))
    readFile(join(PAGES.pathname, path), 'utf8')
      .then((text) => {
        response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/plain' })
        response.end(text.replaceAll('__PORT__', port))
      })
      .catch(() => {
        response.writeHead(404)
        response.end()
      })
  })
  // without IPv6 both loopback names resolve to 127.0.0.1, which the IPv4 wildcard serves
  await listen(server, '::').catch(() => listen(server, '0.0.0.0'))
  const port = address(server)
  return {
    port,
    url: (path) => `http://127.0.0.1:${String(port)}${path}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

function listen(server: Server, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function address(server: Server): number {
  const info = server.address()
  return typeof info === 'object' && info !== null ? info.port : 0
}
