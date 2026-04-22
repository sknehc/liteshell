import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getConfig, saveConfigKey } from '../api/config'

const DEFAULT_SETTINGS = {
    theme: 'auto',
    language: 'zh-CN',
    fontSize: 14,
    fontFamily: 'Consolas',
    backgroundColor: '#1e1e1e',
    foregroundColor: '#d4d4d4',
    defaultLocalPath: '',
    concurrentUploads: 3,
    confirmDelete: true,
    rightClickPaste: false
}

export const useSettingsStore = defineStore('settings', () => {
    // 初始化为默认值，永不为 undefined
    const appSettings = ref({ ...DEFAULT_SETTINGS })

    async function loadSettings() {
        try {
            const config = await getConfig()
            if (config?.appSettings) {
                appSettings.value = { ...DEFAULT_SETTINGS, ...config.appSettings }
            } else {
                // 异步保存默认值，不阻塞
                saveConfigKey('appSettings', DEFAULT_SETTINGS).catch(e => console.warn)
            }
        } catch (err) {
            console.error('加载设置失败，使用默认值', err)
        }
        return appSettings.value
    }

    async function saveSettings(settings: any) {
        appSettings.value = { ...appSettings.value, ...settings }
        await saveConfigKey('appSettings', appSettings.value)
    }

    return { appSettings, loadSettings, saveSettings }
})