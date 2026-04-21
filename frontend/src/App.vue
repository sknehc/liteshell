<template>
  <div class="app-container">
    <div class="sidebar" :style="{ width: sidebarWidth + 'px' }">
      <ConnectionList 
        @select-connection="handleSelectConnection"
        @new-connection="openNewConnectionDialog"
        @edit-connection="handleEditConnection"
      />
    </div>
    
    <div class="resizer" @mousedown.prevent="startResize"></div>
    
    <div class="main-content">
      <div class="tabs-header">
        <div class="tabs">
          <div 
            v-for="tab in tabs" 
            :key="tab.id"
            class="tab"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <el-icon><Monitor /></el-icon>
            <span>{{ tab.name }}</span>
            <el-icon class="close-tab" @click.stop="closeTab(tab.id)"><Close /></el-icon>
          </div>
        </div>
        <div class="header-actions">
          <el-button :icon="isDark ? Sunny : Moon" circle size="small" @click="toggleTheme" />
          <el-button :icon="Setting" circle size="small" @click="showSettings = true" />
          <el-button :icon="Refresh" circle size="small" @click="refreshCurrentTab" />
        </div>
      </div>
      
      <div class="content-area">
        <template v-for="tab in tabs" :key="tab.id">
          <div v-show="activeTab === tab.id" class="tab-content">
            <SSHTerminal 
              v-if="tab.type === 'ssh' && tab.connection"
              :connection="tab.connection"
              :session-id="tab.sessionId"
              @close="closeTab(tab.id)"
            />
            <RDPViewer 
              v-else-if="tab.type === 'rdp' && tab.connection"
              :connection="tab.connection"
            />
            <div v-else class="empty-placeholder">
              <el-empty description="选择一个连接开始" />
            </div>
          </div>
        </template>
      </div>
    </div>
    
    <!-- 新建/编辑连接对话框 -->
    <el-dialog v-model="connectionDialogVisible" :title="isEditMode ? '编辑连接' : '新建连接'" width="500px">
      <el-form :model="formData" label-width="100px">
        <el-form-item label="连接类型" required>
          <el-select v-model="formData.type" placeholder="请选择连接类型" :disabled="isEditMode">
            <el-option label="SSH" value="ssh" />
            <el-option label="RDP" value="rdp" />
          </el-select>
        </el-form-item>
        <el-form-item label="连接名称" required>
          <el-input v-model="formData.name" placeholder="例如：我的服务器" />
        </el-form-item>
        <!-- 分组字段：非必填，支持选择或输入 -->
        <el-form-item label="分组">
          <el-autocomplete
            v-model="formData.group"
            :fetch-suggestions="queryGroupSearch"
            placeholder="请选择或输入新分组名（不选则归入默认分组）"
            clearable
            @select="handleGroupSelect"
          />
        </el-form-item>
        <el-form-item label="主机地址" required>
          <el-input v-model="formData.host" placeholder="IP地址或域名" />
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="formData.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名" required>
          <el-input v-model="formData.username" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="认证方式">
          <el-radio-group v-model="formData.authType">
            <el-radio label="password">密码</el-radio>
            <el-radio label="key">私钥</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="formData.authType === 'password'" label="密码">
          <el-input v-model="formData.password" type="password" show-password />
        </el-form-item>
        <el-form-item v-if="formData.authType === 'key'" label="私钥">
          <el-input v-model="formData.privateKey" type="textarea" rows="3" placeholder="粘贴私钥内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="connectionDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveConnectionHandler">{{ isEditMode ? '更新' : '保存' }}</el-button>
      </template>
    </el-dialog>
    
    <el-drawer v-model="showSettings" title="系统设置" direction="rtl" size="400px">
      <Settings />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Monitor, Setting, Refresh, Close, Sunny, Moon } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ConnectionList from './components/ConnectionList.vue'
import SSHTerminal from './components/SSHTerminal.vue'
import RDPViewer from './components/RDPViewer.vue'
import Settings from './components/Settings.vue'
import { useConnectionStore } from './stores/connectionStore'
import { getConfig, saveConfigKey } from './api/config'
import { v4 as uuidv4 } from './utils/uuid'

const connectionStore = useConnectionStore()
const activeTab = ref<string>('')
const showSettings = ref(false)

// 连接对话框控制
const connectionDialogVisible = ref(false)
const isEditMode = ref(false)
const editingConnectionId = ref<string | null>(null)

const formData = ref({
  type: 'ssh',
  name: '',
  group: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKey: ''
})

const groupNames = computed(() => {
  return connectionStore.groups.map(g => ({ value: g.name }))
})

const queryGroupSearch = (queryString: string, cb: Function) => {
  let results = groupNames.value
  if (queryString) {
    results = results.filter(item => item.value.toLowerCase().includes(queryString.toLowerCase()))
  }
  cb(results)
}

const handleGroupSelect = (item: any) => {
  formData.value.group = item.value
}

const openNewConnectionDialog = () => {
  isEditMode.value = false
  editingConnectionId.value = null
  formData.value = {
    type: 'ssh',
    name: '',
    group: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: '',
    privateKey: ''
  }
  connectionDialogVisible.value = true
}

const handleEditConnection = (conn: any) => {
  isEditMode.value = true
  editingConnectionId.value = conn.id
  formData.value = {
    type: conn.type,
    name: conn.name,
    group: conn.group || '',
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authType: conn.authType || 'password',
    password: conn.password || '',
    privateKey: conn.privateKey || ''
  }
  connectionDialogVisible.value = true
}

const saveConnectionHandler = async () => {
  if (!formData.value.name || !formData.value.host || !formData.value.username) {
    ElMessage.warning('请填写完整信息')
    return
  }
  let groupName = formData.value.group.trim()
  if (!groupName) groupName = '默认分组'
  const existingGroup = connectionStore.groups.find(g => g.name === groupName)
  if (!existingGroup) {
    await connectionStore.addGroup(groupName)
  }
  const connectionData = {
    id: isEditMode.value ? editingConnectionId.value! : Date.now().toString(),
    type: formData.value.type,
    name: formData.value.name,
    group: groupName,
    host: formData.value.host,
    port: formData.value.port || (formData.value.type === 'rdp' ? 3389 : 22),
    username: formData.value.username,
    authType: formData.value.authType,
    password: formData.value.authType === 'password' ? formData.value.password : undefined,
    privateKey: formData.value.authType === 'key' ? formData.value.privateKey : undefined
  }
  if (isEditMode.value) {
    await connectionStore.updateConnection(editingConnectionId.value!, connectionData)
    ElMessage.success('连接已更新')
  } else {
    await connectionStore.addConnection(connectionData as any)
    ElMessage.success('连接已保存')
  }
  connectionDialogVisible.value = false
}

// 侧边栏宽度
const sidebarWidth = ref(280)
let isResizing = false
let startX = 0
let startWidth = 0

const loadSidebarWidth = async () => {
  const config = await getConfig()
  sidebarWidth.value = config.sidebarWidth || 280
}
const saveSidebarWidth = async () => {
  await saveConfigKey('sidebarWidth', sidebarWidth.value)
}

const startResize = (e: MouseEvent) => {
  isResizing = true
  startX = e.clientX
  startWidth = sidebarWidth.value
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', stopResize)
  e.preventDefault()
}
const onMouseMove = (e: MouseEvent) => {
  if (!isResizing) return
  const delta = e.clientX - startX
  let newWidth = startWidth + delta
  if (newWidth < 200) newWidth = 200
  if (newWidth > 600) newWidth = 600
  sidebarWidth.value = newWidth
}
const stopResize = () => {
  isResizing = false
  saveSidebarWidth()
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopResize)
}

// 主题切换
const isDark = ref(false)
const applyTheme = (theme: string) => {
  const html = document.documentElement
  if (theme === 'dark') {
    html.classList.add('dark-theme')
    isDark.value = true
  } else if (theme === 'light') {
    html.classList.remove('dark-theme')
    isDark.value = false
  } else if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      html.classList.add('dark-theme')
      isDark.value = true
    } else {
      html.classList.remove('dark-theme')
      isDark.value = false
    }
  }
}
const loadTheme = async () => {
  const config = await getConfig()
  const theme = config.appSettings?.theme || 'auto'
  applyTheme(theme)
}
const toggleTheme = async () => {
  const config = await getConfig()
  let currentTheme = config.appSettings?.theme || 'auto'
  let newTheme = currentTheme === 'light' ? 'dark' : (currentTheme === 'dark' ? 'auto' : 'light')
  await saveConfigKey('appSettings', { ...config.appSettings, theme: newTheme })
  applyTheme(newTheme)
  ElMessage.success(`主题已切换至 ${newTheme === 'light' ? '亮色' : newTheme === 'dark' ? '暗色' : '跟随系统'}`)
}

// 标签页管理
interface Tab { id: string; name: string; type: string; connection: any; sessionId?: string }
const tabs = ref<Tab[]>([])
const handleSelectConnection = (connection: any) => {
  if (connection.type === 'sftp') {
    ElMessage.info('SFTP 功能已集成到 SSH 终端中，请打开对应的 SSH 连接')
    return
  }
  const existingTab = tabs.value.find(tab => tab.connection.id === connection.id && tab.type === connection.type)
  if (existingTab) {
    activeTab.value = existingTab.id
    return
  }
  const tabId = uuidv4()
  tabs.value.push({ id: tabId, name: connection.name, type: connection.type, connection, sessionId: uuidv4() })
  activeTab.value = tabId
}
const closeTab = (tabId: string) => {
  const index = tabs.value.findIndex(tab => tab.id === tabId)
  if (index !== -1) {
    tabs.value.splice(index, 1)
    if (activeTab.value === tabId && tabs.value.length > 0) activeTab.value = tabs.value[Math.max(0, index - 1)].id
    else if (tabs.value.length === 0) activeTab.value = ''
  }
}
const refreshCurrentTab = () => ElMessage.info('刷新功能开发中')

onMounted(async () => {
  await connectionStore.loadConfig()
  await loadSidebarWidth()
  await loadTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    loadTheme()
  })
})
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--el-bg-color);
  position: relative;
}
.sidebar {
  flex-shrink: 0;
  border-right: 1px solid var(--el-border-color);
  overflow-y: auto;
  transition: none;
}
.resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.2s;
  flex-shrink: 0;
}
.resizer:hover {
  background: var(--el-color-primary);
}
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tabs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color);
  padding: 0 12px;
  background: var(--el-bg-color-page);
}
.tabs {
  display: flex;
  flex: 1;
  overflow-x: auto;
  gap: 2px;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  white-space: nowrap;
}
.tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.close-tab {
  margin-left: 4px;
  cursor: pointer;
  opacity: 0.6;
  font-size: 12px;
}
.close-tab:hover {
  opacity: 1;
}
.header-actions {
  display: flex;
  gap: 8px;
  padding-left: 12px;
}
.content-area {
  flex: 1;
  overflow: hidden;
  position: relative;
}
.tab-content {
  height: 100%;
  width: 100%;
}
.empty-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

<style>
/* 全局样式覆盖 */
.connection-list .list-header {
  border-bottom: none !important;
}
.ssh-terminal-container .terminal-toolbar {
  border-bottom: none !important;
}
.connection-list .list-header,
.ssh-terminal-container .terminal-toolbar {
  padding-bottom: 8px;
}
/* 暗色主题基本样式 */
.dark-theme {
  --el-bg-color: #1e1e1e;
  --el-bg-color-page: #141414;
  --el-bg-color-overlay: #1e1e1e;
  --el-text-color-primary: #ffffff;
  --el-text-color-regular: #f0f0f0;
  --el-text-color-secondary: #c0c0c0;
  --el-text-color-placeholder: #a0a0a0;
  --el-border-color: #3a3a3a;
  --el-border-color-lighter: #2a2a2a;
  --el-fill-color-light: #2a2a2a;
  --el-fill-color-lighter: #222222;
  --el-color-primary-light-9: #1a2a3a;
}
.dark-theme .el-button {
  color: #ffffff !important;
  background-color: #3a3a3a !important;
  border-color: #4a4a4a !important;
}
.dark-theme .el-button:hover {
  background-color: #4a4a4a !important;
}
.dark-theme .el-input__wrapper {
  background-color: #2a2a2a !important;
}
.dark-theme .el-input__inner {
  color: #ffffff !important;
}
</style>