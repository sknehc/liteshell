<template>
  <div class="ssh-terminal-container">
    <div class="terminal-toolbar">
      <div class="connection-info">
        <el-tag size="small" :type="connected ? 'success' : 'info'">
          {{ connected ? '已连接' : '连接中...' }}
        </el-tag>
        <span>{{ connection.name }} ({{ connection.host }}:{{ connection.port }})</span>
      </div>
      <div class="toolbar-actions">
        <el-button size="small" @click="reconnect" :disabled="connected || isConnecting" :icon="RefreshRight">
          重新连接
        </el-button>
        <el-button size="small" :icon="Close" @click="$emit('close')">断开</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="inner-tabs">
      <el-tab-pane label="终端" name="terminal">
        <div ref="terminalRef" class="terminal-container"></div>
      </el-tab-pane>
      <el-tab-pane label="SFTP 文件管理" name="sftp" :disabled="!connected">
        <SFTPManager
            v-if="connected"
            :connection="connection"
            :session-id="sessionId"
            :ws="ws"
            :ssh-ready="connected"
        />
        <div v-else class="sftp-placeholder">
          <el-empty description="请等待 SSH 连接成功" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Close, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import SFTPManager from './SFTPManager.vue'
import { useSettingsStore } from '../stores/settingsStore'

const props = defineProps<{
  connection: any
  sessionId: string
}>()

const emit = defineEmits(['close'])

const terminalRef = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
const ws = ref<WebSocket | null>(null)
const connected = ref(false)
const activeTab = ref('terminal')
const isConnecting = ref(false)
let copyTimeout: number | null = null

const settingsStore = useSettingsStore()

// 安全获取设置（兜底默认值）
const getSafeSettings = () => {
  const settings = settingsStore.appSettings.value
  if (settings && typeof settings.fontSize === 'number') {
    return settings
  }
  return {
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    backgroundColor: '#1e1e1e',
    foregroundColor: '#d4d4d4'
  }
}

// 应用终端设置（字体、颜色等）- 使用 setOption + 强制刷新内部渲染器
const applyTerminalSettings = () => {
  if (!terminal) {
    console.warn('terminal 未初始化，跳过应用设置')
    return
  }
  const settings = getSafeSettings()
  const { fontSize, fontFamily, backgroundColor, foregroundColor } = settings
  try {
    // 方法1：使用官方 setOption（xterm@5.3.0 支持）
    if (typeof terminal.setOption === 'function') {
      terminal.setOption('fontSize', fontSize)
      terminal.setOption('fontFamily', fontFamily)
      terminal.setOption('theme', {
        background: backgroundColor,
        foreground: foregroundColor,
        cursor: '#aeafad'
      })
    } else {
      // 降级：直接修改 options
      terminal.options.fontSize = fontSize
      terminal.options.fontFamily = fontFamily
      terminal.options.theme = {
        background: backgroundColor,
        foreground: foregroundColor,
        cursor: '#aeafad'
      }
    }

    // 强制内部渲染器更新主题和尺寸
    const core = (terminal as any)._core
    if (core && core._renderService && core._renderService._renderer) {
      const renderer = core._renderService._renderer
      if (typeof renderer.onThemeChange === 'function') {
        renderer.onThemeChange()
      }
      if (typeof renderer.onDevicePixelRatioChange === 'function') {
        renderer.onDevicePixelRatioChange()
      }
    }

    // 强制重绘所有行
    if (typeof terminal.refresh === 'function') {
      terminal.refresh(0, terminal.rows - 1)
    }

    // 重新适应容器大小（会触发 resize 和重绘）
    if (fitAddon) {
      fitAddon.fit()
    }

    console.log('终端设置已应用:', { fontSize, fontFamily, backgroundColor, foregroundColor })
  } catch (err) {
    console.warn('应用终端设置失败', err)
  }
}

// 初始化终端
const initTerminal = () => {
  const settings = getSafeSettings()
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    theme: {
      background: settings.backgroundColor,
      foreground: settings.foregroundColor,
      cursor: '#aeafad'
    },
    allowProposedApi: true
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  terminal.open(terminalRef.value!)
  fitAddon.fit()
  terminal.focus()

  terminal.onSelectionChange(() => {
    if (!terminal) return
    const selectedText = terminal.getSelection()
    if (selectedText && selectedText.trim().length > 0) {
      if (copyTimeout) clearTimeout(copyTimeout)
      copyTimeout = window.setTimeout(() => {
        navigator.clipboard.writeText(selectedText).then(() => {
          ElMessage.success(`已复制 ${selectedText.length} 个字符`)
        }).catch(err => {
          console.error('复制失败:', err)
          ElMessage.warning('复制失败，请手动复制')
        })
        copyTimeout = null
      }, 100)
    }
  })

  terminal.onData((data) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({
        type: 'ssh-data',
        sessionId: props.sessionId,
        data: data
      }))
    }
  })

  terminal.onResize(({ cols, rows }) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({
        type: 'ssh-resize',
        sessionId: props.sessionId,
        cols: cols,
        rows: rows
      }))
    }
  })
}

// SSH 连接
const connectSSH = () => {
  if (ws.value) {
    if (ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({
        type: 'ssh-disconnect',
        sessionId: props.sessionId
      }))
    }
    ws.value.close()
    ws.value = null
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.hostname}:3001`

  ws.value = new WebSocket(wsUrl)

  ws.value.onopen = () => {
    ws.value?.send(JSON.stringify({
      type: 'ssh-connect',
      sessionId: props.sessionId,
      host: props.connection.host,
      port: props.connection.port,
      username: props.connection.username,
      password: props.connection.authType === 'password' ? props.connection.password : undefined,
      privateKey: props.connection.authType === 'key' ? props.connection.privateKey : undefined
    }))
  }

  ws.value.onmessage = (event) => {
    const message = JSON.parse(event.data)
    switch (message.type) {
      case 'ssh-connected':
        connected.value = true
        isConnecting.value = false
        ElMessage.success('SSH连接成功')
        applyTerminalSettings()
        if (terminal && activeTab.value === 'terminal') terminal.focus()
        break
      case 'ssh-data':
        if (terminal) terminal.write(message.data)
        break
      case 'ssh-error':
        ElMessage.error('SSH错误: ' + message.error)
        connected.value = false
        isConnecting.value = false
        break
      case 'ssh-disconnected':
        ElMessage.warning('SSH连接已断开')
        connected.value = false
        isConnecting.value = false
        break
    }
  }

  ws.value.onerror = (error) => {
    console.error('WebSocket error:', error)
    ElMessage.error('连接失败')
    connected.value = false
    isConnecting.value = false
  }

  ws.value.onclose = () => {
    if (connected.value) ElMessage.warning('连接已关闭')
    connected.value = false
    isConnecting.value = false
  }
}

const handleResize = () => {
  if (fitAddon && activeTab.value === 'terminal' && terminalRef.value) {
    fitAddon.fit()
    terminal?.focus()
  }
}

const reconnect = async () => {
  if (isConnecting.value || connected.value) return
  isConnecting.value = true
  ElMessage.info('正在重新连接...')
  if (terminal) terminal.clear()
  connectSSH()
}

// 监听设置变化（深度监听）
watch(
    () => settingsStore.appSettings.value,
    (newSettings, oldSettings) => {
      if (terminal) {
        applyTerminalSettings()
      }
    },
    { deep: true, immediate: false }
)

// 手动触发设置更新的事件监听
const onSettingsUpdated = () => {
  if (terminal) {
    applyTerminalSettings()
  }
}

onMounted(async () => {
  await settingsStore.loadSettings()
  console.log('设置加载完成:', settingsStore.appSettings.value)
  initTerminal()
  connectSSH()
  window.addEventListener('resize', handleResize)
  window.addEventListener('settings-updated', onSettingsUpdated)
})

onUnmounted(() => {
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify({
      type: 'ssh-disconnect',
      sessionId: props.sessionId
    }))
    ws.value.close()
  }
  if (terminal) terminal.dispose()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('settings-updated', onSettingsUpdated)
  if (copyTimeout) clearTimeout(copyTimeout)
})

watch(activeTab, (newVal) => {
  if (newVal === 'terminal') {
    setTimeout(() => {
      if (fitAddon) {
        fitAddon.fit()
        terminal?.focus()
      }
    }, 100)
  }
})
</script>

<style scoped>
.ssh-terminal-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.terminal-toolbar {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color-page);
}
.connection-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.inner-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  padding-left: 12px;
}
.inner-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
}
.inner-tabs :deep(.el-tabs__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.inner-tabs :deep(.el-tab-pane) {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.terminal-container {
  height: 100%;
  padding: 4px;
}
.sftp-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>