import {
  AudioFilled,
  FileExcelFilled,
  FileFilled,
  FileImageFilled,
  FilePdfFilled,
  FilePptFilled,
  FileTextFilled,
  FileUnknownFilled,
  FileWordFilled,
  FileZipFilled,
  FolderFilled,
  VideoCameraFilled
} from '@ant-design/icons'
import type { CloudFile } from '../../../shared/types'

const wordExtensions = new Set(['doc', 'docx', 'odt', 'rtf'])
const sheetExtensions = new Set(['csv', 'xls', 'xlsx', 'ods'])
const slideExtensions = new Set(['ppt', 'pptx', 'odp'])
const textExtensions = new Set(['txt', 'md', 'json', 'xml', 'yaml', 'yml'])

export function FileTypeIcon({ file }: { file: CloudFile }) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  let icon = <FileFilled />
  let visualKind: string = file.kind

  if (file.isFolder) icon = <FolderFilled />
  else if (extension === 'pdf') {
    icon = <FilePdfFilled />
    visualKind = 'pdf'
  } else if (wordExtensions.has(extension)) {
    icon = <FileWordFilled />
    visualKind = 'word'
  } else if (sheetExtensions.has(extension)) {
    icon = <FileExcelFilled />
    visualKind = 'sheet'
  } else if (slideExtensions.has(extension)) {
    icon = <FilePptFilled />
    visualKind = 'slide'
  } else if (textExtensions.has(extension)) icon = <FileTextFilled />
  else if (file.kind === 'audio') icon = <AudioFilled />
  else if (file.kind === 'video') icon = <VideoCameraFilled />
  else if (file.kind === 'image') icon = <FileImageFilled />
  else if (file.kind === 'archive') icon = <FileZipFilled />
  else if (file.kind === 'other' && !extension) icon = <FileUnknownFilled />

  return <span className={`file-icon ${visualKind}`}>{icon}</span>
}
