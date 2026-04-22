<template>
  <div class="settings-container">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="界面设置" name="appearance">
        <el-form label-width="100px">
          <el-form-item label="主题">
            <el-select v-model="localSettings.theme">
              <el-option label="浅色" value="light" />
              <el-option label="深色" value="dark" />
              <el-option label="跟随系统" value="auto" />
            </el-select>
          </el-form-item>
          <el-form-item label="语言">
            <el-select v-model="localSettings.language">
              <el-option label="中文" value="zh-CN" />
              <el-option label="English" value="en-US" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="终端设置" name="terminal">
        <el-form label-width="100px">
          <el-form-item label="字体大小">
            <el-input-number v-model="localSettings.fontSize" :min="10" :max="24" />
          </el-form-item>
          <el-form-item label="字体家族">
            <el-select v-model="localSettings.fontFamily">
              <el-option label="Consolas" value="Consolas" />
              <el-option label="Monaco" value="Monaco" />
              <el-option label="Courier New" value="Courier New" />
            </el-select>
          </el-form-item>
          <el-form-item label="背景色">
            <el-color-picker v-model="localSettings.backgroundColor" />
          </el-form-item>
          <el-form-item label="前景色">
            <el-color-picker v-model="localSettings.foregroundColor" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="文件管理" name="file">
        <el-form label-width="100px">
          <el-form-item label="默认本地路径">
            <el-input v-model="localSettings.defaultLocalPath" placeholder="/home/user" />
          </el-form-item>
          <el-form-item label="并发数">
            <el-input-number v-model="localSettings.concurrentUploads" :min="1" :max="10" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="通用设置" name="general">
        <el-form label-width="100px">
          <el-form-item label="确认提示">
            <el-switch v-model="localSettings.confirmDelete" />
          </el-form-item>
          <el-form-item label="清除缓存">
            <el-button type="danger" @click="clearCache">清除所有本地数据</el-button>
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
            <div class="form-tip">清除所有连接、分组、设置等（与上方“清除缓存”类似，但更彻底）</div>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="save-button-wrapper">
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

const activeTab = ref('appearance')
const settingsStore = useSettingsStore()

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
  confirmDelete: true
})

// 从 store 加载数据到本地
const loadLocalSettings = async () => {
  await settingsStore.loadSettings()
  Object.assign(localSettings, settingsStore.appSettings.value)
  // 不再在此处直接调用 applyTheme，交给 App.vue 统一处理
}

// 保存所有设置
const saveAllSettings = async () => {
  await settingsStore.saveSettings(localSettings)
  // 触发全局事件，通知 App.vue 重新加载主题，通知终端重新应用设置
  window.dispatchEvent(new CustomEvent('settings-updated'))
  ElMessage.success('设置已保存')
}

const manualSave = async () => {
  await saveAllSettings()
}

const clearCache = async () => {
  await ElMessageBox.confirm('清除所有本地缓存将删除所有连接配置、设置和命令历史，确定吗？', '警告', { type: 'warning' })
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
      "confirmDelete": true
    },
    "sftp_col_widths": { "name": 300, "size": 100, "time": 160, "perm": 180 },
    "sftp_sort": { "field": "name", "order": "asc" },
    "sftp_overwrite_prefs": {},
    "sidebarWidth": 215,
    "expandedGroups": { "1776693493484": true }
  }
  await saveConfig(defaultConfig)
  ElMessage.success('缓存已清除，页面将刷新')
  setTimeout(() => location.reload(), 1000)
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
        "confirmDelete": true
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