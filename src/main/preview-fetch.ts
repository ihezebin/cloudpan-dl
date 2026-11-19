import { net } from 'electron'
import { assertDownloadUrl, cloudSession } from './providers'
import type { Provider } from '../shared/types'

// Electron's fetch can cancel CDN redirects before exposing their response.
// ClientRequest allows validating each redirect before following it.
export function fetchPreviewFile(
  provider: Provider,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const request = net.request({
      url,
      session: cloudSession(provider),
      credentials: 'include',
      redirect: 'manual',
      headers
    })
    let failStream: ((error: unknown) => void) | undefined
    const fail = (error: unknown) => {
      failStream?.(error)
      reject(error)
    }
    const abort = () => {
      fail(signal.reason || new Error('预览已关闭'))
      request.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    let redirects = 0
    request.on('redirect', (_status, _method, target) => {
      try {
        if (++redirects > 6) throw new Error('文件地址跳转次数过多')
        assertDownloadUrl(provider, target)
        request.followRedirect()
      } catch (error) {
        reject(error)
        request.abort()
      }
    })
    request.once('error', fail)
    request.once('close', () => signal.removeEventListener('abort', abort))
    request.once('response', (response) => {
      try {
        const outputHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (
            ['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(
              key.toLowerCase()
            ) &&
            value !== undefined
          )
            outputHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
        let ended = false
        resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                failStream = (error) => {
                  if (!ended) {
                    ended = true
                    controller.error(error)
                  }
                }
                response.on('data', (chunk) => {
                  if (!ended) controller.enqueue(new Uint8Array(chunk))
                })
                response.once('end', () => {
                  if (!ended) {
                    ended = true
                    controller.close()
                  }
                })
                response.once('error', fail)
                response.once('aborted', () => fail(new Error('文件读取中断，请重试')))
              },
              cancel() {
                ended = true
                request.abort()
              }
            }),
            {
              status: response.statusCode,
              headers: outputHeaders
            }
          )
        )
      } catch (error) {
        fail(error)
        request.abort()
      }
    })
    request.end()
  })
}
