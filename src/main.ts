import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { i18n } from './i18n'
import App from './App.vue'
import './assets/editor-styles.css'

const app = createApp(App)
app.use(createPinia())
app.use(i18n)

// 根据检测到的 locale 设置 HTML lang 和页面标题
document.documentElement.lang = i18n.global.locale.value
document.title = i18n.global.t('app.title')

app.mount('#app')
