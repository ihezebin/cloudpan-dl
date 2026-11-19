import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function recordPreviewFailure(
  provider: string,
  fileName: string,
  stage: string,
  message: string
) {
  // Never persist cookies, signed resource URLs, or sharing credentials.
  const safeMessage = message.replace(/(?:https?|cloud-preview):\/\/[^\s]+/g, '[URL]')
  try {
    if (!app?.isReady()) return
    const directory = app.getPath('logs')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'preview-errors.log')
    try {
      if (statSync(path).size > 256 * 1024) writeFileSync(path, '')
    } catch {}
    appendFileSync(
      path,
      JSON.stringify({
        time: new Date().toISOString(),
        provider,
        fileName,
        stage,
        message: safeMessage
      }) + '\n',
      { mode: 0o600 }
    )
  } catch {
    /* Diagnostics must not replace the actual playback error. */
  }
}
