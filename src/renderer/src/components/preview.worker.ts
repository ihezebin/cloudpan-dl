import { unzipSync, strFromU8 } from 'fflate'
self.onmessage = ({ data }: MessageEvent<{ bytes: ArrayBuffer; kind: string }>) => {
  try {
    const names: string[] = []
    let total = 0
    const files = unzipSync(new Uint8Array(data.bytes), {
      filter: (file) => {
        names.push(`${file.name} (${file.originalSize.toLocaleString()} 字节)`)
        if (names.length > 10000) throw new Error('压缩包文件数超过预览上限')
        const needed =
          data.kind !== 'zip' &&
          /^(word\/document.xml|ppt\/slides\/slide\d+.xml|xl\/(workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|worksheets\/sheet\d+.xml))$/.test(
            file.name
          )
        if (needed) {
          total += file.originalSize
          if (total > 40 * 1024 * 1024) throw new Error('文档解压内容过大，请下载后打开')
        }
        return needed
      }
    })
    self.postMessage({
      names,
      files: Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, strFromU8(value)])
      )
    })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
