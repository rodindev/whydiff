import type { Page } from 'playwright-core'

import { openSessions } from './sessions.js'

describe('openSessions', () => {
  it('names the browser problem when CDP is not available', async () => {
    const page = {
      context: () => ({
        newCDPSession: () => Promise.reject(new Error('CDP session is only available in Chromium')),
      }),
    } as unknown as Page // only `context` is reached before the error
    await expect(openSessions(page)).rejects.toMatchObject({
      code: 'unsupported-browser',
      message: expect.stringContaining('Chromium') as string,
    })
  })
})
