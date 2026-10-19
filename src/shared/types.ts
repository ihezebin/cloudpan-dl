export type Provider = 'quark' | 'baidu'
export type FileKind = 'folder' | 'video' | 'audio' | 'image' | 'archive' | 'document' | 'other'

export interface CloudFile {
  id: string
  name: string
  size: number
  kind: FileKind
  isFolder: boolean
  path?: string
  downloadUrl?: string
  meta?: Record<string, string | number | boolean>
}

export interface ParseRequest {
  url: string
  passcode?: string
}
export interface ParseResult {
  provider: Provider
  title: string
  shareId: string
  files: CloudFile[]
  requiresLogin: boolean
  notice?: string
}

export type TaskStatus =
  'queued' | 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'
export interface DownloadRequest {
  provider: Provider
  shareUrl: string
  passcode?: string
  file: CloudFile
  savePath?: string
}
export interface DownloadTask {
  id: string
  provider: Provider
  fileName: string
  savePath: string
  size: number
  received: number
  speed: number
  status: TaskStatus
  viaTransfer?: boolean
  error?: string
  createdAt: number
}

export interface AuthState {
  provider: Provider
  loggedIn: boolean
  hasSession: boolean
  label: string
}
export interface AppSettings {
  defaultDownloadPath: string
  concurrency: number
  maxConcurrency: number
  theme: 'system' | 'light' | 'dark'
  font: 'zhuque_fangsong' | 'lxgw_wenkai' | 'xiaolai'
}

export interface CloudPanAPI {
  platform: string
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  isWindowMaximized(): Promise<boolean>
  onWindowMaximized(listener: (maximized: boolean) => void): () => void
  parse(input: ParseRequest): Promise<ParseResult>
  listFolder(provider: Provider, folder: CloudFile): Promise<CloudFile[]>
  login(provider: Provider): Promise<AuthState>
  openPage(provider: Provider): Promise<AuthState>
  logout(provider: Provider): Promise<AuthState>
  authStates(): Promise<AuthState[]>
  addDownloads(items: DownloadRequest[]): Promise<DownloadTask[]>
  taskAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'delete'): Promise<void>
  getTasks(): Promise<DownloadTask[]>
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  selectDirectory(): Promise<string | null>
  onTasks(listener: (tasks: DownloadTask[]) => void): () => void
}
