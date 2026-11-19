export type PreviewKind =
  'text' | 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'sheet' | 'slides' | 'zip' | 'unsupported'
export function previewKind(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (
    'txt md markdown log json jsonl xml yaml yml toml ini conf cfg csv tsv srt vtt ass lrc js jsx ts tsx py go rs java c cpp h css html sh sql env'
      .split(' ')
      .includes(ext)
  )
    return 'text'
  if ('png jpg jpeg gif webp bmp svg avif ico'.split(' ').includes(ext)) return 'image'
  if ('mp4 m4v webm mov mkv avi flv ts mpeg mpg wmv'.split(' ').includes(ext)) return 'video'
  if ('mp3 m4a aac wav flac ogg opus wma ape'.split(' ').includes(ext)) return 'audio'
  if (ext === 'pdf' || ext === 'docx' || ext === 'zip') return ext
  if (ext === 'xlsx') return 'sheet'
  if (ext === 'pptx') return 'slides'
  return 'unsupported'
}
export interface PreviewSource {
  hls?: boolean
  id: string
  url: string
  kind: PreviewKind
}
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024
export const DOCUMENT_PREVIEW_LIMIT = 30 * 1024 * 1024
