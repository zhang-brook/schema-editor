import { readFileSync } from 'node:fs'

// 版本号只在仓库根 package.json 维护，打包时注入应用元数据（安装包与「关于此应用」取用）
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
// 产物名与 Release 里的 Web 包同前缀，并显式区分系统与架构
// `${arch}` / `${ext}` 由 electron-builder 按目标替换，mac 通用包为 universal
const artifactName = (platform, kind) =>
  `schema-editor-v${version}-${platform}-\${arch}${kind ? `-${kind}` : ''}.\${ext}`

export default {
  appId: 'com.zhangbrook.schemaeditor',
  productName: 'Schema Editor',
  directories: {
    output: 'release',
  },
  files: ['dist/**', 'renderer/**', 'package.json'],
  extraMetadata: { version },
  // 在线更新的元数据来源：客户端从该 Release 读取 latest.yml，发布本身由 CI 完成
  publish: { provider: 'github', owner: 'zhang-brook', repo: 'schema-editor' },
  win: {
    icon: '../web/public/logo.png',
    target: ['nsis', 'portable'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'Schema Editor',
    artifactName: artifactName('windows', 'setup'),
  },
  portable: {
    artifactName: artifactName('windows', 'portable'),
  },
  mac: {
    icon: '../web/public/logo.png',
    // dmg 供手动安装，zip 是应用内更新所需的目标
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    artifactName: artifactName('macos'),
  },
  linux: {
    icon: '../web/public/logo.png',
    target: ['AppImage', 'deb'],
    category: 'Development',
    maintainer: 'zhang-brook <zhang-brook@users.noreply.github.com>',
    artifactName: artifactName('linux'),
  },
}
