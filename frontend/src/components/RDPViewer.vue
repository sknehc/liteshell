<template>
  <div class="rdp-container">
    <div class="rdp-toolbar">
      <div class="connection-info">
        <el-tag size="small" type="info">RDP远程桌面</el-tag>
        <span>{{ connection.name }} ({{ connection.host }}:{{ connection.port || 3389 }})</span>
      </div>
      <div class="toolbar-actions">
        <el-button size="small" @click="toggleFullscreen">全屏</el-button>
        <el-button size="small" @click="$emit('close')">断开</el-button>
      </div>
    </div>
    <div class="rdp-viewer">
      <div class="rdp-placeholder">
        <el-icon :size="80"><Monitor /></el-icon>
        <h3>RDP远程桌面</h3>
        <p>连接地址: {{ connection.host }}:{{ connection.port || 3389 }}</p>
        <p>用户名: {{ connection.username }}</p>
        <el-button type="primary" @click="connectRDP">连接远程桌面</el-button>
        <div class="rdp-note">
          <el-alert 
            title="功能说明" 
            type="info" 
            description="RDP功能需要后端支持node-rdpjs库，当前为演示界面。完整RDP功能包括画面渲染、鼠标键盘同步、剪贴板共享等。"
            show-icon 
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Monitor } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  connection: any
}>()

const emit = defineEmits(['close'])

const toggleFullscreen = () => {
  const elem = document.documentElement
  if (!document.fullscreenElement) {
    elem.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

const connectRDP = () => {
  ElMessage.info('RDP完整功能开发中，敬请期待')
}
</script>

<style scoped>
.rdp-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.rdp-toolbar {
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
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.rdp-viewer {
  flex: 1;
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rdp-placeholder {
  text-align: center;
  color: #fff;
}

.rdp-placeholder h3 {
  margin: 16px 0 8px;
}

.rdp-placeholder p {
  margin: 8px 0;
  color: #ccc;
}

.rdp-note {
  margin-top: 24px;
  width: 400px;
  max-width: 90vw;
}
</style>
