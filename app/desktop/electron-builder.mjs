import { readFileSync } from 'node:fs'

// The version lives only in the repo root package.json and is injected into app metadata at packaging time (used by installers and "About this app")
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
// Artifact names share the prefix of the web package in Releases and make OS and arch explicit
// `${arch}` / `${ext}` are substituted per target by electron-builder; the macOS universal build uses "universal"
const artifactName = (platform, kind) =>
  `schema-editor-v${version}-${platform}-\${arch}${kind ? `-${kind}` : ''}.\${ext}`

export default {
  appId: 'com.zhangbrook.schemaeditor',
  productName: 'Schema Editor',
  directories: {
    output: 'release',
  },
  files: ['dist/**', 'renderer/**', 'build/icon.png', 'package.json'],
  extraMetadata: { version },
  // Source of the online update metadata: clients read latest.yml from that release; publishing itself is done by CI
  publish: { provider: 'github', owner: 'zhang-brook', repo: 'schema-editor' },
  win: {
    icon: 'build/icon.png',
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
    icon: 'build/icon.png',
    // dmg is for manual installs; zip is the target required for in-app updates
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    artifactName: artifactName('macos'),
  },
  linux: {
    icon: 'build/icon.png',
    target: ['AppImage', 'deb'],
    category: 'Development',
    maintainer: 'zhang-brook <zhang-brook@users.noreply.github.com>',
    artifactName: artifactName('linux'),
  },
}
