# 发布流程

[English](./release-process.md) | 简体中文

1. 改 [package.json](../package.json) 的 `version`（两端与安装包版本在构建期取用这一处）
2. `pnpm changelog` 生成 CHANGELOG
3. `git add package.json CHANGELOG.md` → `git commit -m "chore: release vx.y.z"` → `git push`
4. `git tag vx.y.z` → `git push origin vx.y.z`，触发 [release.yml](../.github/workflows/release.yml)：先校验 tag 与根版本一致，再构建网页版；正式 tag 会部署到 Pages，预发布 tag 跳过部署。desktop 在 Windows / macOS / Linux 三个 runner 上并行打包；`publish` 等这些任务都完成后创建 Release（正文取 CHANGELOG 中 `## vx.y.z` 小节）
5. 打开验证

版本号带连字符后缀的 tag（`v1.2.3-beta.1`、`v1.2.3-rc.1`）会把 Release 发布为 **预发布版（pre-release）**，Pages 站点保持最新的正式版；不带后缀的 `v1.2.3` 发布为正式版并更新 Pages。根 `package.json` 写同一串值，后缀一并带上。

| 用途 | 地址 |
| --- | --- |
| 仓库 | https://github.com/zhang-brook/schema-editor |
| Pages | https://zhang-brook.github.io/schema-editor/ |
| 更新日志 | https://github.com/zhang-brook/schema-editor/blob/main/CHANGELOG.md |
| Release | https://github.com/zhang-brook/schema-editor/releases |

Release 资产：`schema-editor-vx.y.z.zip` / `.tar.gz`（网页版）；桌面端按系统与架构命名：

- `schema-editor-vx.y.z-windows-x64-setup.exe`（安装版）/ `-windows-x64-portable.exe`（免安装版）
- `schema-editor-vx.y.z-macos-universal.dmg`（手动安装）/ `.zip`（应用内更新）
- `schema-editor-vx.y.z-linux-x86_64.AppImage` / `-linux-amd64.deb`
- 各平台更新元数据 `latest.yml`、`latest-mac.yml`、`latest-linux.yml`；Windows 安装包与 macOS zip 另带 `.blockmap` 用于增量下载

文件名里的版本号取自根 `package.json`，与 tag 保持一致。

## 注意

- CHANGELOG 小节标题必须与 tag 一致，否则 Release 正文只有兜底文案
- 同版本号重复执行 `pnpm changelog` 会被守卫拦截（exit 1），需先删掉该小节或还原 CHANGELOG.md
- 只有推送 `v*` tag 才触发工作流，普通提交不会
- 预发布 tag 仍会发布网页 zip/tar.gz 与桌面安装包，但跳过 Pages 部署，Release 正文也不带 Live Preview 链接
- Pages 部署不等桌面打包；Release 要等三个平台的安装包都产出后一起挂载
- 打包固定 `--publish never`：安装包与 `latest*.yml` 由 `publish` job 统一挂载。electron-builder 在 tag 上构建会默认自行上传，CI 没有 `GH_TOKEN` 时整条打包会失败
- 未配置代码签名：Windows 首次安装会出现 SmartScreen 提示；macOS 包会被 Gatekeeper 拦截且暂不展示应用内更新入口，签名与公证完成后再开放
- 已发布的 Release 不要删掉 `latest.yml` / `latest-mac.yml` / `latest-linux.yml` 或改动画廊里的安装包，否则已安装的应用检查不到更新或校验失败
- 应用内更新只读 `releases/latest`，GitHub 会跳过草稿与预发布版本；标记为 prerelease 的 tag 打包再全，安装版也检查不到

