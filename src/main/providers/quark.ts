import type { CloudFile, DownloadRequest, ParseRequest, ParseResult } from '../../shared/types'
import { cloudSession, jsonRequest, isLoggedIn, quarkDownloadToken } from './session'
import type { CloudProviderAdapter } from './types'
import { kindOf } from './utils'

const QUARK_CLIENT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 QuarkPC/6.9.7.761 QuarkCloudDrivePC/6.9.7.761 quark-cloud-drive/2.5.40'

function shareIdFromUrl(url: string) {
  const match = new URL(url).pathname.match(/\/s\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('无法从链接中识别夸克分享 ID')
  return match[1]
}

function isFolder(item: any) {
  if (typeof item.file === 'boolean') return !item.file
  if (typeof item.dir === 'boolean') return item.dir
  return item.dir === 1 || item.file_type === 0
}

async function getShareToken(shareId: string, passcode?: string) {
  try {
    const payload = await jsonRequest(
      'quark',
      'https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
      { method: 'POST', body: JSON.stringify({ pwd_id: shareId, passcode: passcode || '' }) }
    )
    if (payload?.data?.stoken) return payload.data.stoken as string
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!passcode || /提取码|访问码|密码|passcode|password|pwd/i.test(message)) {
      throw new Error(
        `PASSCODE_REQUIRED:${passcode ? '提取码不正确，请重新输入' : '该分享需要提取码'}`
      )
    }
    throw error
  }
  if (!passcode) throw new Error('PASSCODE_REQUIRED:该分享需要提取码')
  throw new Error('提取码不正确或分享链接已失效')
}

export class QuarkProvider implements CloudProviderAdapter {
  readonly provider = 'quark' as const

  private async personalDownloadUrl(fid: string) {
    const payload = await jsonRequest(
      'quark',
      'https://drive-pc.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc',
      {
        method: 'POST',
        headers: this.downloadHeaders(),
        body: JSON.stringify({ fids: [fid] }),
        signal: AbortSignal.timeout(15000)
      }
    )
    const url = payload?.data?.[0]?.download_url
    if (!url) throw new Error('夸克未返回已转存文件的下载地址')
    return String(url)
  }

  private async transferAndDownload(
    request: DownloadRequest,
    shareId: string,
    stoken: string,
    shareFidToken: string
  ) {
    const cachedFid = String(request.file.meta?.savedFid || '')
    if (cachedFid) return this.personalDownloadUrl(cachedFid)

    const capacity = await jsonRequest(
      'quark',
      'https://drive-pc.quark.cn/1/clouddrive/member?pr=ucpro&fr=pc&fetch_subscribe=true&fetch_identity=true',
      { headers: this.downloadHeaders(), signal: AbortSignal.timeout(15000) }
    )
    const totalValue = capacity?.data?.total_capacity
    const usedValue = capacity?.data?.use_capacity
    const total = Number(totalValue)
    const used = Number(usedValue)
    if (
      totalValue == null ||
      usedValue == null ||
      !Number.isFinite(total) ||
      !Number.isFinite(used)
    )
      throw new Error('无法确认夸克网盘剩余空间，未执行转存')
    const free = Math.max(0, total - used)
    if (request.file.size > free) {
      throw new Error(
        `夸克分享直链受限（23018），转存需要 ${Math.ceil(request.file.size / 1048576)} MB，个人网盘仅剩 ${Math.floor(free / 1048576)} MB，未执行转存`
      )
    }

    const directory = await jsonRequest(
      'quark',
      'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/dir?pr=ucpro&fr=pc&uc_param_str=&aver=1',
      { headers: this.downloadHeaders(), signal: AbortSignal.timeout(15000) }
    )
    const destination = String(directory?.data?.pdir_fid || '')
    if (!destination) throw new Error('夸克未返回分享转存目录，未执行转存')

    const saved = await jsonRequest(
      'quark',
      'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc',
      {
        method: 'POST',
        headers: this.downloadHeaders(),
        body: JSON.stringify({
          fid_list: [request.file.id],
          fid_token_list: [shareFidToken],
          to_pdir_fid: destination,
          pwd_id: shareId,
          stoken,
          pdir_fid: '0',
          pdir_save_all: false,
          scene: 'link'
        }),
        signal: AbortSignal.timeout(15000)
      }
    )
    const taskId = String(saved?.data?.task_id || '')
    let savedFid = String(saved?.data?.task_resp?.data?.save_as?.save_as_top_fids?.[0] || '')
    if (!savedFid && !taskId) throw new Error('夸克转存未返回任务 ID 或文件 ID')

    for (let attempt = 0; !savedFid && attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const query = new URLSearchParams({ pr: 'ucpro', fr: 'pc', task_id: taskId })
      const task = await jsonRequest(
        'quark',
        `https://drive-pc.quark.cn/1/clouddrive/task?${query}`,
        {
          headers: this.downloadHeaders(),
          signal: AbortSignal.timeout(15000)
        }
      )
      savedFid = String(
        task?.data?.save_as?.save_as_top_fids?.[0] ||
          task?.data?.save_as?.save_as_select_top_fids?.[0] ||
          ''
      )
      if (task?.data?.status === 3) throw new Error('夸克转存任务失败，请检查个人网盘剩余空间')
      if (task?.data?.status === 2 && !savedFid) throw new Error('夸克转存完成但未返回文件 ID')
    }
    if (!savedFid) throw new Error('夸克转存等待超时，请在个人网盘确认转存结果')
    request.file.meta = { ...request.file.meta, savedFid }
    return this.personalDownloadUrl(savedFid)
  }

  downloadHeaders() {
    return {
      'user-agent': QUARK_CLIENT_USER_AGENT,
      origin: 'https://pan.quark.cn',
      referer: 'https://pan.quark.cn/'
    }
  }

  private async getDirectory(shareId: string, stoken: string, folderId: string, path: string) {
    const files: CloudFile[] = []
    for (let page = 1; page <= 100; page += 1) {
      const query = new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc',
        pwd_id: shareId,
        stoken,
        pdir_fid: folderId,
        force: '0',
        _page: String(page),
        _size: '100',
        _fetch_share: '1',
        _fetch_total: '1',
        _sort: 'file_type:asc,updated_at:desc'
      })
      const payload = await jsonRequest(
        'quark',
        `https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail?${query}`
      )
      const items: any[] = payload?.data?.list || []
      for (const item of items) {
        if (!item.fid) continue
        const name = item.file_name || item.name || '未命名'
        const folder = isFolder(item)
        files.push({
          id: String(item.fid),
          name,
          path,
          size: Number(item.size || 0),
          isFolder: folder,
          kind: kindOf(name, folder),
          downloadUrl: item.download_url || item.dlink,
          meta: {
            shareId,
            stoken,
            shareFidToken: String(item.share_fid_token || ''),
            pdirFid: String(item.pdir_fid || folderId)
          }
        })
      }
      if (items.length < 100) break
    }
    return files
  }

  async parse(input: ParseRequest): Promise<ParseResult> {
    const shareId = shareIdFromUrl(input.url)
    const stoken = await getShareToken(shareId, input.passcode)
    const files = await this.getDirectory(shareId, stoken, '0', '')

    const requiresLogin = !(await isLoggedIn('quark'))
    return {
      provider: 'quark',
      title: files[0]?.name || '夸克分享',
      shareId,
      files,
      requiresLogin,
      notice: requiresLogin ? '下载前请先登录自己的夸克账号。' : undefined
    }
  }

  async listFolder(folder: CloudFile) {
    const shareId = String(folder.meta?.shareId || '')
    const stoken = String(folder.meta?.stoken || '')
    if (!shareId || !stoken) throw new Error('文件夹缺少分享凭证，请重新解析')
    const path = folder.path ? `${folder.path}/${folder.name}` : folder.name
    return this.getDirectory(shareId, stoken, folder.id, path)
  }

  async resolveDownloadUrl(request: DownloadRequest) {
    const savedFid = String(request.file.meta?.savedFid || '')
    if (savedFid) return this.personalDownloadUrl(savedFid)
    const shareId = String(request.file.meta?.shareId || '')
    let stoken = String(request.file.meta?.stoken || '')
    let shareFidToken = String(request.file.meta?.shareFidToken || '')
    if (!shareId || !stoken || !shareFidToken)
      throw new Error('分享文件缺少下载凭证，请重新解析后再下载')

    let token = ''
    try {
      const result = await quarkDownloadToken()
      token = result.token
    } catch {}

    const requestLink = async () => {
      const response = await cloudSession('quark').fetch(
        'https://drive-pc.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&sys=win32&ve=6.9.7.761',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'user-agent': QUARK_CLIENT_USER_AGENT,
            origin: 'https://pan.quark.cn',
            referer: 'https://pan.quark.cn/'
          },
          body: JSON.stringify({
            fids: [request.file.id],
            fids_token: [shareFidToken],
            pwd_id: shareId,
            stoken,
            speedup_session: '',
            token
          })
        }
      )
      const download = (await response.json()) as {
        code?: number
        message?: string
        data?: Array<{ download_url?: string }>
      }
      return { response, download }
    }

    let { response, download } = await requestLink()
    if (download.code === 41016 || download.code === 41020) {
      stoken = await getShareToken(shareId, request.passcode)
      const parentId = String(request.file.meta?.pdirFid || '0')
      const files = await this.getDirectory(shareId, stoken, parentId, request.file.path || '')
      const refreshed = files.find((file) => file.id === request.file.id)
      shareFidToken = String(refreshed?.meta?.shareFidToken || '')
      if (!shareFidToken) throw new Error('分享文件凭证已过期，刷新后未找到文件，请重新解析链接')
      request.file.meta = { ...request.file.meta, stoken, shareFidToken }
      const retried = await requestLink()
      response = retried.response
      download = retried.download
    }
    if (!response.ok || (download.code !== undefined && download.code !== 0)) {
      if (download.code === 23018) {
        return this.transferAndDownload(request, shareId, stoken, shareFidToken)
      }
      throw new Error(
        `夸克获取分享文件下载地址失败（错误码 ${download.code ?? response.status}）：${download.message || '未知错误'}`
      )
    }
    const url = download?.data?.[0]?.download_url
    if (!url) throw new Error(download?.message || '夸克未返回分享文件下载地址')
    return String(url)
  }
}
