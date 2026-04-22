<template>
  <div class="settings-container" v-if="loaded">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="终端设置" name="terminal">
        <el-form label-width="100px">
          <el-form-item label="字体大小">
            <el-input-number v-model="localSettings.fontSize" :min="10" :max="24" style="width: 160px;" />
          </el-form-item>
          <el-form-item label="字体家族">
            <el-select v-model="localSettings.fontFamily" style="width: 160px;">
              <el-option label="Consolas" value="Consolas" />
              <el-option label="Monaco" value="Monaco" />
              <el-option label="Courier New" value="Courier New" />
            </el-select>
          </el-form-item>
          <el-row :gutter="10">
            <el-col :span="12">
              <el-form-item label="背景颜色">
                <el-color-picker v-model="localSettings.backgroundColor" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="字体颜色" label-width="80px">
                <el-color-picker v-model="localSettings.foregroundColor" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="右键粘贴">
            <el-switch v-model="localSettings.rightClickPaste" style="width: 140px;" />
          </el-form-item>
          <el-form-item>
            <el-button type="default" @click="resetToDefault">还原默认</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="数据管理" name="data">
        <el-form label-width="100px">
          <el-form-item label="导出配置">
            <el-button type="primary" @click="exportConfig">导出为 JSON 文件</el-button>
            <div class="form-tip">将当前所有连接、分组、设置等保存到本地文件</div>
          </el-form-item>
          <el-form-item label="导入配置">
            <el-upload
                ref="uploadRef"
                action="#"
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleImportFile"
                accept=".json"
            >
              <el-button type="warning">选择 JSON 文件并导入</el-button>
            </el-upload>
            <div class="form-tip">导入后将覆盖当前所有配置，请先导出备份</div>
          </el-form-item>
          <el-form-item label="清除所有数据">
            <el-button type="danger" @click="clearAllData">清除所有本地数据</el-button>
            <div class="form-tip">清除所有连接、分组、设置等</div>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="save-button-wrapper" v-if="activeTab === 'terminal'">
      <el-button type="primary" @click="manualSave">保存设置</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadProps } from 'element-plus'
import { getConfig, saveConfig, saveConfigKey } from '../api/config'
import { useSettingsStore } from '../stores/settingsStore'

const activeTab = ref('terminal')
const settingsStore = useSettingsStore()
const loaded = ref(false)

// 本地表单数据
const localSettings = reactive({
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
})

// 从后端加载最新设置
const loadLocalSettings = async () => {
  // 直接从后端获取，确保最新
  const config = await getConfig()
  const appSettings = config?.appSettings || {}
  Object.assign(localSettings, {
    fontSize: appSettings.fontSize ?? 14,
    fontFamily: appSettings.fontFamily ?? 'Consolas',
    backgroundColor: appSettings.backgroundColor ?? '#1e1e1e',
    foregroundColor: appSettings.foregroundColor ?? '#d4d4d4',
    rightClickPaste: appSettings.rightClickPaste ?? false
  })
  // 同时更新 store（可选）
  settingsStore.appSettings.value = { ...settingsStore.appSettings.value, ...appSettings }
  loaded.value = true
}
const resetToDefault = () => {
  localSettings.fontSize = 14
  localSettings.fontFamily = 'Consolas'
  localSettings.backgroundColor = '#1e1e1e'
  localSettings.foregroundColor = '#d4d4d4'
  localSettings.rightClickPaste = false
  ElMessage.info('已恢复默认设置，请点击“保存设置”生效')
}
// 保存所有设置（只保存终端相关字段）
const saveAllSettings = async () => {
  const settingsToSave = {
    fontSize: localSettings.fontSize,
    fontFamily: localSettings.fontFamily,
    backgroundColor: localSettings.backgroundColor,
    foregroundColor: localSettings.foregroundColor,
    rightClickPaste: localSettings.rightClickPaste
  }
  await settingsStore.saveSettings(settingsToSave)
  window.dispatchEvent(new CustomEvent('settings-updated'))
  ElMessage.success('设置已保存')
}

const manualSave = async () => {
  await saveAllSettings()
}

const exportConfig = async () => {
  const config = await getConfig()
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `liteshell-config-${new Date().toISOString().slice(0,19)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success('配置已导出')
}

const handleImportFile: UploadProps['onChange'] = (file) => {
  if (!file.raw) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target?.result as string)
      await saveConfig(imported)
      ElMessage.success('导入成功，即将刷新页面')
      setTimeout(() => location.reload(), 1000)
    } catch (err) {
      ElMessage.error('配置文件格式错误')
    }
  }
  reader.readAsText(file.raw)
}

const clearAllData = async () => {
  try {
    await ElMessageBox.confirm('清除所有本地数据将删除所有连接、分组、设置等，此操作不可恢复。确定吗？', '警告', { type: 'warning' })
    const defaultConfig = {
      "connections": [],
      "groups": [{ "id": "1776693493484", "name": "默认分组" }],
      "appSettings": {
        "theme": "auto",
        "language": "zh-CN",
        "fontSize": 14,
        "fontFamily": "Consolas",
        "backgroundColor": "#1e1e1e",
        "foregroundColor": "#d4d4d4",
        "defaultLocalPath": "",
        "concurrentUploads": 3,
        "confirmDelete": true,
        "rightClickPaste": false
      },
      "sftp_col_widths": { "name": 300, "size": 100, "time": 160, "perm": 180 },
      "sftp_sort": { "field": "name", "order": "asc" },
      "sftp_overwrite_prefs": {},
      "sidebarWidth": 215,
      "expandedGroups": { "1776693493484": true }
    }
    await saveConfig(defaultConfig)
    ElMessage.success('已清除所有数据，页面即将刷新')
    setTimeout(() => location.reload(), 1000)
  } catch { /* 取消 */ }
}

onMounted(async () => {
  await loadLocalSettings()
})
</script>

<style scoped>
.settings-container {
  padding: 16px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.save-button-wrapper {
  margin-top: 24px;
  text-align: center;
  padding: 16px 0;
  border-top: 1px solid var(--el-border-color);
}
</style>