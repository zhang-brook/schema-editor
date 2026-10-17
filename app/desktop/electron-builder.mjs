import { readFileSync } from 'node:fs'

// 版本号只在仓库根 package.json 维护，打包时注入应用元数据（安装包与「关于此应用」取用）
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

export default {
  appId: 'com.zhangbrook.schemaeditor',
  productName: 'Schema Editor',
  directories: {
    output: 'release',
  },
  files: ['dist/**', 'renderer/**', 'package.json'],
  extraMetadata: { version },
  win: {
    icon: '../web/public/logo.png',
    target: ['nsis', 'portable'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'Schema Editor',
  },
}
