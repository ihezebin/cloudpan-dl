# 云盘提速下载器

基于 Electron + React + electron-vite 的 macOS / Windows 桌面端网盘解析和下载器。目前提供夸克网盘、百度网盘分享链接识别，网页登录态隔离、文件选择、下载队列、断点续传、暂停/继续和本地下载目录设置。

> 这个项目不会破解会员、绕过账号权限、验证码或平台风控。所谓“减少客户端限速影响”的实现边界，是在平台已向当前账号返回合法下载直链后，由桌面端用 HTTP Range 和任务并发下载；实际速度仍取决于网盘服务端对账号和链接的限制。

## 启动

```bash
npm install
npm run dev
```

类型检查与生产构建：

```bash
npm run typecheck
npm run build
```

打包：

打包命令与 `codex-switcher` 保持同一风格，构建时不会自动发布：

```bash
npm run dist:mac
npm run dist:win
```

`package:mac` / `package:win` 仍作为兼容别名保留。electron-builder 配置集中在
`electron-builder.yml`，Windows 同时生成 NSIS 安装包和 portable 版本。

Windows 包应在 Windows 或配置了 Wine/交叉打包环境的构建机上生成。正式分发前还需要配置 macOS Developer ID / notarization 与 Windows 代码签名。

## 使用流程

1. 在主界面登录对应网盘。登录页使用独立的 Electron 持久 Session，Cookie 不进入 React 页面和 localStorage。
2. 粘贴分享链接，必要时填写提取码，点击“解析链接”。
3. 双击文件夹或点击“进入”逐层浏览，勾选文件后下载。夸克分享文件没有直链时，应用会把用户选中的文件转存到当前登录账号的网盘根目录，再取得平台下载地址。这是夸克官方接口生成合法下载地址所需的步骤。
4. 下载页可暂停、继续、取消，已完成任务可打开所在目录。未完成文件以 `.part` 保存，继续时使用 Range 请求。

## 代码结构

- `src/main/providers/`：provider 注册表、持久会话和各平台适配器。新增平台时实现
  `CloudProviderAdapter` 并注册，不需要修改 UI 的解析流程。
- `src/renderer/src/components/`：页面与交互组件，优先使用 Ant Design。
- `src/renderer/src/hooks/useCloudPan.ts`：解析、登录、选择和下载任务的页面状态。
- `src/shared/types.ts`：主进程、preload 和 renderer 共用的收窄类型契约。

提交前可执行：

```bash
npm run format
npm run typecheck
npm run build
```

## 设计与参考

Provider 层参考了以下开源项目所验证过的平台边界，但没有复制其代码：

- [OpenList](https://github.com/OpenListTeam/OpenList)：多网盘 driver 分层、登录态与下载链接分离。
- [Alist](https://github.com/alist-org/alist)：网盘适配器与统一文件模型。
- [BaiduPCS-Go](https://github.com/qjfoidnh/BaiduPCS-Go)：百度网盘登录态、PCS 下载与分片下载思路。
- [Motrix](https://github.com/agalwood/Motrix)：桌面下载任务队列与 aria2 风格交互。
- [CloudSaver](https://github.com/jiangrui1994/CloudSaver)：夸克分享的 `stoken`、
  `share_fid_token`、目录类型及转存参数结构。本项目仅参考公开接口边界与字段含义，
  没有复制其业务代码。

网盘私有接口可能随时变化。`src/main/providers.ts` 把平台差异集中在适配器内；生产维护时应补充真实账号下的集成测试，并遵守平台服务条款。

## 安全边界

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- 只允许 `https:` 且属于对应平台域名的下载地址。
- 文件名经过清理，最终路径固定在用户选择的目录下。
- 网盘凭证保存在 `persist:cloudpan-quark` / `persist:cloudpan-baidu` 会话中。
- Renderer 只能通过收窄的 preload API 调用主进程。
