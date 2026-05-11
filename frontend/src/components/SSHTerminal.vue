<template>
  <div class="ssh-terminal-container">
    <div class="terminal-toolbar">
      <div class="connection-info">
        <el-tag size="default" :type="connected ? 'success' : 'info'">
          {{ connected ? '已连接' : '连接中...' }}
        </el-tag>
        <span>{{ connection.name }} ({{ connection.host }}:{{ connection.port }})</span>
      </div>
      <div class="toolbar-actions">
        <el-button size="default" :icon="FullScreen" @click="toggleFullscreen" title="全屏" />
        <el-button size="default" :icon="CopyDocument" @click="openNewTab" title="基于当前配置打开新窗口">
          多开窗口
        </el-button>
        <el-button size="default" @click="reconnect" :disabled="connected || isConnecting" :icon="RefreshRight">
          重新连接
        </el-button>
        <el-button size="default" :icon="Close" @click="$emit('close')">断开</el-button>
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
            :on-open-terminal="openTerminalAtPath"
            :initial-path="lastSftpPath"
            @path-change="handleSftpPathChange"
        />
        <div v-else class="sftp-placeholder">
          <el-empty description="请等待 SSH 连接成功" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Close, RefreshRight, FullScreen, CopyDocument  } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import SFTPManager from './SFTPManager.vue'
import { getConfig } from '../api/config'
import { useStatsStore } from '../stores/statsStore'

const props = defineProps<{
  connection: any
  sessionId: string
}>()

const emit = defineEmits(['close', 'openNewTab'])

const terminalRef = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
const ws = ref<WebSocket | null>(null)
const connected = ref(false)
const activeTab = ref('terminal')
const isConnecting = ref(false)
let copyTimeout: number | null = null
const statsStore = useStatsStore()
let statsTimer: number | null = null
let pendingStatsRequest = false
const lastSftpPath = ref<string | null>(null)
const handleSftpPathChange = (path: string) => {
  lastSftpPath.value = path
}
const openNewTab = () => {
  emit('openNewTab', props.connection)
}
// 获取终端设置
const fetchSettings = async () => {
  try {
    const config = await getConfig()
    const settings = config?.appSettings || {}
    return {
      fontSize: settings.fontSize ?? 14,
      fontFamily: settings.fontFamily ?? 'Consolas, "Courier New", monospace',
      backgroundColor: settings.backgroundColor ?? '#1e1e1e',
      foregroundColor: settings.foregroundColor ?? '#d4d4d4',
      rightClickPaste: settings.rightClickPaste ?? false
    }
  } catch (err) {
    console.error('获取终端设置失败', err)
    return {
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      backgroundColor: '#1e1e1e',
      foregroundColor: '#d4d4d4'
    }
  }
}
// 请求系统状态
const requestSystemStats = () => {
  if (!ws.value || ws.value.readyState !== WebSocket.OPEN || pendingStatsRequest) return
  if (!connected.value) return

  pendingStatsRequest = true
  ws.value.send(JSON.stringify({
    type: 'ssh-stats',
    sessionId: props.sessionId
  }))
}

// 启动统计定时器
const startStatsTimer = () => {
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = window.setInterval(() => {
    requestSystemStats()
  }, 1000)
}

// 停止统计定时器
const stopStatsTimer = () => {
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
}
// 右键粘贴处理
let currentContextMenuHandler: ((e: MouseEvent) => void) | null = null
const bindContextMenu = (enable: boolean) => {
  const container = terminalRef.value
  if (!container) return
  if (currentContextMenuHandler) {
    container.removeEventListener('contextmenu', currentContextMenuHandler)
    currentContextMenuHandler = null
  }
  if (!enable) return
  const handler = async (e: MouseEvent) => {
    e.preventDefault()
    try {
      const text = await navigator.clipboard.readText()
      if (text && ws.value && ws.value.readyState === WebSocket.OPEN) {
        ws.value.send(JSON.stringify({
          type: 'ssh-data',
          sessionId: props.sessionId,
          data: text
        }))
      }
    } catch (err) {
      console.warn('读取剪贴板失败', err)
      ElMessage.warning('无法读取剪贴板，请检查浏览器权限')
    }
  }
  container.addEventListener('contextmenu', handler)
  currentContextMenuHandler = handler
}

// 调整终端尺寸并通知后端
const resizeTerminal = () => {
  if (!fitAddon || !terminal || activeTab.value !== 'terminal') return
  fitAddon.fit()
  const { cols, rows } = terminal
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify({
      type: 'ssh-resize',
      sessionId: props.sessionId,
      cols: cols,
      rows: rows
    }))
  }
}

// 应用终端主题和字体
const applyTerminalSettings = async () => {
  if (!terminal) return
  const settings = await fetchSettings()
  const { fontSize, fontFamily, backgroundColor, foregroundColor } = settings

  terminal.options.fontSize = fontSize
  terminal.options.fontFamily = fontFamily
  terminal.options.theme = {
    background: backgroundColor,
    foreground: foregroundColor,
    cursor: '#aeafad'
  }

  try {
    // @ts-ignore
    const core = terminal._core
    if (core && core._renderService && core._renderService._renderer) {
      const renderer = core._renderService._renderer
      if (typeof renderer.onThemeChange === 'function') renderer.onThemeChange()
      if (typeof renderer.renderRows === 'function') renderer.renderRows(0, terminal.rows - 1)
    }
    if (typeof terminal.refresh === 'function') terminal.refresh(0, terminal.rows - 1)
  } catch (e) { /* 忽略内部 API 错误 */ }

  resizeTerminal()
  bindContextMenu(settings.rightClickPaste === true)
}

// 全屏功能
const toggleFullscreen = () => {
  const elem = document.documentElement
  if (!document.fullscreenElement) {
    elem.requestFullscreen().then(() => {
      setTimeout(resizeTerminal, 100)
    }).catch(err => {
      console.warn('全屏失败', err)
      ElMessage.warning('全屏失败，请检查浏览器权限')
    })
  } else {
    document.exitFullscreen().then(() => {
      setTimeout(resizeTerminal, 100)
    })
  }
}

// 初始化终端
const initTerminal = async () => {
  const settings = await fetchSettings()
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
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`

  ws.value = new WebSocket(wsUrl)
  const fetchEncoding = async () => {
    const config = await getConfig()
    return config?.appSettings?.encoding || 'utf8'
  }
  ws.value.onopen = async () => {
    const encoding = await fetchEncoding()
    ws.value?.send(JSON.stringify({
      type: 'ssh-connect',
      sessionId: props.sessionId,
      host: props.connection.host,
      port: props.connection.port,
      username: props.connection.username,
      password: props.connection.authType === 'password' ? props.connection.password : undefined,
      privateKey: props.connection.authType === 'key' ? props.connection.privateKey : undefined,
      encoding: encoding
    }))
  }

  ws.value.onmessage = (event) => {
    const message = JSON.parse(event.data)
    switch (message.type) {
      case 'ssh-connected':
        connected.value = true
        isConnecting.value = false
        ElMessage.success('SSH连接成功')
        startStatsTimer()
        nextTick(() => {
          applyTerminalSettings()
          resizeTerminal()
          if (terminal && activeTab.value === 'terminal') terminal.focus()
        })
        break
      case 'ssh-data':
        if (terminal) terminal.write(message.data)
        break
      case 'ssh-stats-response':
        pendingStatsRequest = false
        if (message.success && message.stats) {
          statsStore.updateStats(props.sessionId, message.stats.cpu, message.stats.mem)
        }
        break
      case 'ssh-error':
        ElMessage.error('SSH错误: ' + message.error)
        connected.value = false
        isConnecting.value = false
        break
      case 'ssh-disconnected':
        ElMessage.warning('SSH连接已断开')
        stopStatsTimer()
        statsStore.clearStats(props.sessionId)
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
    resizeTerminal()
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

const onSettingsUpdated = async () => {
  console.log('收到 settings-updated 事件，重新获取设置')
  if (terminal) {
    await applyTerminalSettings()
    resizeTerminal()
  }
}

// 在终端打开指定路径，增加安全确认和聚焦修复
const openTerminalAtPath = (path: string | null) => {
  if (!path || !ws.value || ws.value.readyState !== WebSocket.OPEN) {
    ElMessage.warning('无法发送命令')
    return
  }
  ElMessageBox.confirm(
      '终端可能正在执行脚本，切换目录可能中断当前进程。确定继续吗？',
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
  ).then(() => {
    // 先切换标签页
    activeTab.value = 'terminal'
    const command = `cd ${path}\r`;
    ws.value!.send(JSON.stringify({
      type: 'ssh-data',
      sessionId: props.sessionId,
      data: command
    }))
    // 延迟聚焦，确保终端在视图切换和 DOM 更新完成后可获得焦点
    setTimeout(() => {
      terminal?.focus()
      // 双重保险，部分环境下可能需要再次聚焦
      setTimeout(() => {
        terminal?.focus()
      }, 50)
    }, 150)
  }).catch(() => {
    // 用户取消，不执行操作
  })
}

onMounted(async () => {
  await initTerminal()
  connectSSH()
  window.addEventListener('resize', handleResize)
  window.addEventListener('settings-updated', onSettingsUpdated)
  document.addEventListener('fullscreenchange', handleResize)
})

onUnmounted(() => {
  stopStatsTimer()
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
  document.removeEventListener('fullscreenchange', handleResize)
  if (copyTimeout) clearTimeout(copyTimeout)
})

watch(activeTab, (newVal) => {
  if (newVal === 'terminal') {
    nextTick(() => {
      resizeTerminal()
      // 再次确保聚焦
      setTimeout(() => {
        terminal?.focus()
      }, 50)
    })
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
  font-size: 20px;
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
  padding-left: 0;
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
.inner-tabs :deep(.el-tabs__item) {
  padding: 0 20px !important;
  font-size: 20px;
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
.xterm-cursor-block {
  width: 4px !important;
  background-color: rgba(255,255,255,0.7);
}
</style>