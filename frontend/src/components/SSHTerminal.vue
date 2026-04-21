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

// 防抖定时器
let copyTimeout: number | null = null

const initTerminal = () => {
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#aeafad'
    },
    allowProposedApi: true
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  terminal.open(terminalRef.value!)
  fitAddon.fit()

  // 自动聚焦终端，无需鼠标点击
  terminal.focus()

  // 监听终端选择事件，自动复制选中的文本
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

const connectSSH = () => {
  // 清理旧连接
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
        // 连接成功后聚焦终端
        if (terminal && activeTab.value === 'terminal') {
          terminal.focus()
        }
        break
      case 'ssh-data':
        if (terminal) {
          terminal.write(message.data)
        }
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
    if (connected.value) {
      ElMessage.warning('连接已关闭')
    }
    connected.value = false
    isConnecting.value = false
  }
}

const handleResize = () => {
  if (fitAddon && activeTab.value === 'terminal' && terminalRef.value) {
    fitAddon.fit()
    // 调整后重新聚焦
    terminal?.focus()
  }
}

// 重新连接方法
const reconnect = async () => {
  if (isConnecting.value || connected.value) return

  isConnecting.value = true
  ElMessage.info('正在重新连接...')

  // 清理终端内容
  if (terminal) {
    terminal.clear()
  }

  // 关闭现有连接并重新建立
  connectSSH()
}

onMounted(() => {
  initTerminal()
  connectSSH()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify({
      type: 'ssh-disconnect',
      sessionId: props.sessionId
    }))
    ws.value.close()
  }
  if (terminal) {
    terminal.dispose()
  }
  window.removeEventListener('resize', handleResize)
  if (copyTimeout) clearTimeout(copyTimeout)
})

// 切换标签页时，如果切换到终端，自动调整大小并聚焦
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
  background: #1e1e1e;
}

.sftp-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>