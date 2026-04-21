<template>
  <div class="connection-list">
    <div class="list-header">
      <!-- 第一行：Logo + 新建连接按钮 -->
      <div class="top-row">
        <div class="logo-area">
          <el-icon><Monitor /></el-icon>
          <span class="app-name">liteshell</span>
        </div>
        <div class="btn-wrapper">
          <el-button type="primary" size="small" @click="$emit('newConnection')">
            <el-icon><Plus /></el-icon>
            新建连接
          </el-button>
        </div>
      </div>
      <!-- 第二行：搜索框，居中且宽度占满 -->
      <div class="search-row">
        <el-input 
          v-model="searchText" 
          placeholder="搜索连接" 
          size="small"
          clearable
          :prefix-icon="Search"
          class="search-input"
        />
      </div>
    </div>
    
    <div class="list-content">
      <div v-for="group in filteredGroups" :key="group.id" class="group">
        <div 
          class="group-header" 
          @click="toggleGroup(group.id)"
          @contextmenu.prevent="showGroupContextMenu($event, group)"
        >
          <el-icon><ArrowRight v-if="!expandedGroups[group.id]" /><ArrowDown v-else /></el-icon>
          <span class="group-name">{{ group.name }}</span>
          <span class="group-count">({{ group.connections.length }})</span>
        </div>
        <div v-show="expandedGroups[group.id]" class="group-connections">
          <div 
            v-for="conn in group.connections" 
            :key="conn.id"
            class="connection-item"
            :class="{ active: selectedConnection?.id === conn.id }"
            @click="selectConnection(conn)"
            @contextmenu.prevent="showContextMenu($event, conn)"
          >
            <el-icon class="conn-icon">
              <Monitor v-if="conn.type === 'ssh'" />
              <FolderOpened v-else-if="conn.type === 'sftp'" />
              <Monitor v-else-if="conn.type === 'rdp'" />
            </el-icon>
            <div class="conn-info">
              <div class="conn-name">{{ conn.name }}</div>
              <div class="conn-host">{{ conn.host }}:{{ conn.port }}</div>
            </div>
            <el-icon class="conn-status" :style="{ color: statusColor(conn) }">
              <SuccessFilled />
            </el-icon>
          </div>
        </div>
      </div>
      
      <!-- 未分组区域（兼容旧数据，实际上所有连接都应归入分组） -->
      <div v-if="ungroupedConnections.length > 0" class="group">
        <div class="group-header" @click="toggleGroup('ungrouped')">
          <el-icon><ArrowRight v-if="!expandedGroups['ungrouped']" /><ArrowDown v-else /></el-icon>
          <span class="group-name">未分组</span>
          <span class="group-count">({{ ungroupedConnections.length }})</span>
        </div>
        <div v-show="expandedGroups['ungrouped']" class="group-connections">
          <div 
            v-for="conn in ungroupedConnections" 
            :key="conn.id"
            class="connection-item"
            @click="selectConnection(conn)"
          >
            <el-icon><Monitor /></el-icon>
            <div class="conn-info">
              <div class="conn-name">{{ conn.name }}</div>
              <div class="conn-host">{{ conn.host }}:{{ conn.port }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 连接右键菜单 -->
    <div v-if="contextMenuVisible" class="context-menu" :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }">
      <div @click="handleEdit">编辑</div>
      <div @click="deleteConnection">删除</div>
      <div @click="duplicateConnection">复制</div>
    </div>

    <!-- 分组右键菜单 -->
    <div v-if="groupContextMenuVisible" class="context-menu" :style="{ top: groupContextMenuY + 'px', left: groupContextMenuX + 'px' }">
      <div @click="deleteGroup">删除分组</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Plus, Search, ArrowRight, ArrowDown, Monitor, FolderOpened, SuccessFilled } from '@element-plus/icons-vue'
import { useConnectionStore } from '../stores/connectionStore'
import { getConfig, saveConfigKey } from '../api/config'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['selectConnection', 'newConnection', 'editConnection'])

const connectionStore = useConnectionStore()
const searchText = ref('')
const expandedGroups = ref<Record<string, boolean>>({})
const selectedConnection = ref<any>(null)

// 连接右键菜单
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuConnection = ref<any>(null)

// 分组右键菜单
const groupContextMenuVisible = ref(false)
const groupContextMenuX = ref(0)
const groupContextMenuY = ref(0)
const contextMenuGroup = ref<any>(null)

const groups = computed(() => connectionStore.groups)
const connections = computed(() => connectionStore.connections)

const filteredGroups = computed(() => {
  if (!searchText.value) return groups.value
  return groups.value.map(group => ({
    ...group,
    connections: group.connections.filter(conn =>
        conn.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
        conn.host.includes(searchText.value)
    )
  })).filter(group => group.connections.length > 0)
})

const ungroupedConnections = computed(() => {
  const groupedIds = new Set()
  groups.value.forEach(group => {
    group.connections.forEach(conn => groupedIds.add(conn.id))
  })
  let filtered = connections.value.filter(conn => !groupedIds.has(conn.id))
  if (searchText.value) {
    filtered = filtered.filter(conn =>
        conn.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
        conn.host.includes(searchText.value)
    )
  }
  return filtered
})

const toggleGroup = async (groupId: string) => {
  expandedGroups.value[groupId] = !expandedGroups.value[groupId]
  await saveConfigKey('expandedGroups', expandedGroups.value)
}

const selectConnection = (conn: any) => {
  selectedConnection.value = conn
  emit('selectConnection', conn)
}

const statusColor = (conn: any) => '#67C23A'

const showContextMenu = (event: MouseEvent, conn: any) => {
  contextMenuConnection.value = conn
  contextMenuVisible.value = true
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  event.preventDefault()
}

const handleEdit = () => {
  if (contextMenuConnection.value) {
    emit('editConnection', contextMenuConnection.value)
  }
  contextMenuVisible.value = false
}

const deleteConnection = async () => {
  try {
    await ElMessageBox.confirm('确定要删除这个连接吗？', '提示', { type: 'warning' })
    if (contextMenuConnection.value) {
      await connectionStore.deleteConnection(contextMenuConnection.value.id)
      ElMessage.success('已删除')
    }
  } catch {
    // 取消删除
  }
  contextMenuVisible.value = false
}

const duplicateConnection = async () => {
  if (contextMenuConnection.value) {
    const newConn = { ...contextMenuConnection.value, id: Date.now().toString(), name: contextMenuConnection.value.name + ' (副本)' }
    await connectionStore.addConnection(newConn)
    ElMessage.success('已复制')
  }
  contextMenuVisible.value = false
}

const showGroupContextMenu = (event: MouseEvent, group: any) => {
  contextMenuGroup.value = group
  groupContextMenuVisible.value = true
  groupContextMenuX.value = event.clientX
  groupContextMenuY.value = event.clientY
  event.preventDefault()
}

const deleteGroup = async () => {
  if (!contextMenuGroup.value) return
  const groupName = contextMenuGroup.value.name
  if (groupName === '默认分组') {
    ElMessage.warning('默认分组不能删除')
    groupContextMenuVisible.value = false
    return
  }
  try {
    await ElMessageBox.confirm(`确定要删除分组“${groupName}”及其下的所有连接吗？此操作不可恢复。`, '警告', { type: 'warning' })
    await connectionStore.deleteGroup(groupName)
    ElMessage.success('分组已删除')
  } catch {
    // 取消
  }
  groupContextMenuVisible.value = false
}

const handleClickOutside = () => {
  contextMenuVisible.value = false
  groupContextMenuVisible.value = false
}

onMounted(async () => {
  const config = await getConfig()
  // 防御：确保 config 存在且有 expandedGroups
  if (config && config.expandedGroups) {
    expandedGroups.value = config.expandedGroups
  } else {
    // 如果没有配置，设置默认展开
    if (groups.value && groups.value.length > 0 && groups.value[0] && groups.value[0].id) {
      expandedGroups.value[groups.value[0].id] = true
    }
    expandedGroups.value['ungrouped'] = true
  }
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.connection-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.list-header {
  padding: 12px;
  border-bottom: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.top-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.logo-area .el-icon {
  font-size: 20px;
  color: var(--el-color-primary);
}

.app-name {
  letter-spacing: 1px;
}

.btn-wrapper {
  flex-shrink: 0;
}

.search-row {
  width: 100%;
  display: flex;
  justify-content: flex-start;
}

.search-input {
  width: 188px;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.group {
  margin-bottom: 8px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.group-header:hover {
  background: var(--el-fill-color-light);
}

.group-name {
  flex: 1;
}

.group-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.group-connections {
  margin-left: 20px;
}

.connection-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  margin: 2px 0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.connection-item:hover {
  background: var(--el-fill-color-light);
}

.connection-item.active {
  background: var(--el-color-primary-light-9);
  border-left: 3px solid var(--el-color-primary);
}

.conn-icon {
  font-size: 16px;
  color: var(--el-color-primary);
}

.conn-info {
  flex: 1;
  overflow: hidden;
}

.conn-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn-host {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn-status {
  font-size: 12px;
}

.context-menu {
  position: fixed;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
  z-index: 2000;
  min-width: 120px;
}

.context-menu div {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.context-menu div:hover {
  background: var(--el-fill-color-light);
}
</style>