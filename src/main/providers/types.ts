import type {
  CloudFile,
  DownloadRequest,
  ParseRequest,
  ParseResult,
  Provider
} from '../../shared/types'

export interface CloudProviderAdapter {
  readonly provider: Provider
  parse(input: ParseRequest): Promise<ParseResult>
  listFolder?(folder: CloudFile): Promise<CloudFile[]>
  resolveDownloadUrl?(request: DownloadRequest): Promise<string>
  downloadHeaders?(request: DownloadRequest): Record<string, string>
}
