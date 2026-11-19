// Keep signed CDN URLs and playlist keys in the main process. Both segment lines
// and URI attributes (keys, init segments, alternate playlists) use opaque URLs.
export function rewritePlaylist(text: string, base: string, register: (url: string) => string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      if (!line.startsWith('#')) return register(new URL(line.trim(), base).toString())
      return line.replace(
        /URI="([^"]+)"/g,
        (_, value) => `URI="${register(new URL(value, base).toString())}"`
      )
    })
    .join('\n')
}
