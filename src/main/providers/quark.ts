import type { CloudFile, DownloadRequest, ParseRequest, ParseResult } from '../../shared/types'
import { jsonRequest, isLoggedIn } from './session'
import type { CloudProviderAdapter } from './types'
import { kindOf } from './utils'

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
      notice: requiresLogin
        ? '下载前请先登录自己的夸克账号；平台可能要求先转存到个人网盘。'
        : undefined
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
    if (request.file.downloadUrl) return request.file.downloadUrl
    const shareId = String(request.file.meta?.shareId || '')
    const stoken = String(request.file.meta?.stoken || '')
    const shareFidToken = String(request.file.meta?.shareFidToken || '')
    const pdirFid = String(request.file.meta?.pdirFid || '0')
    if (!shareId || !stoken || !shareFidToken) {
      throw new Error('分享文件缺少转存凭证，请重新解析后再下载')
    }

    const save = await jsonRequest(
      'quark',
      `https://drive-h.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc&__t=${Date.now()}`,
      {
        method: 'POST',
        body: JSON.stringify({
          fid_list: [request.file.id],
          fid_token_list: [shareFidToken],
          to_pdir_fid: '0',
          pwd_id: shareId,
          stoken,
          pdir_fid: pdirFid,
          scene: 'link'
        })
      }
    )
    const taskId = save?.data?.task_id
    if (!taskId) throw new Error(save?.message || '夸克未返回转存任务')

    let savedFid = ''
    for (let retry = 0; retry < 30; retry += 1) {
      const query = new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc',
        task_id: String(taskId),
        retry_index: String(retry)
      })
      const task = await jsonRequest('quark', `https://drive-h.quark.cn/1/clouddrive/task?${query}`)
      if (task?.data?.status === 2) {
        savedFid = String(task?.data?.save_as?.save_as_top_fids?.[0] || '')
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!savedFid) throw new Error('等待夸克转存完成超时，请稍后重试')

    const download = await jsonRequest(
      'quark',
      'https://drive-h.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc',
      { method: 'POST', body: JSON.stringify({ fids: [savedFid] }) }
    )
    const url = download?.data?.[0]?.download_url
    if (!url) throw new Error(download?.message || '夸克未返回下载地址')
    return String(url)
  }
}
