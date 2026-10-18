import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { i18n } from './i18n'
import App from './App.vue'
import { initTheme } from './composables/useTheme'
import { initDensity } from './composables/useDensity'
import { installDesktopFsa } from './platform/desktop-fsa'

// Under the desktop shell, replace the browser's directory picker and file watching with the bridge implementation
if (window.schemaEditorDesktop) installDesktopFsa(window.schemaEditorDesktop)

initTheme()
initDensity()

const app = createApp(App)
app.use(createPinia())
app.use(i18n)

// Set the HTML lang and page title from the detected locale
document.documentElement.lang = i18n.global.locale.value
document.title = i18n.global.t('app.title')

app.mount('#app')
