<template>
  <div class="sftp-container" @dragenter="onDragEnter" @dragover="onDragOver" @drop="onDrop">
    <div class="sftp-toolbar">
      <el-button size="small" type="primary" @click="uploadFile" :disabled="!sshReady">
        <el-icon><Upload /></el-icon> 上传
      </el-button>
      <el-button size="small" @click="downloadSelectedFile" :disabled="!sshReady || !selectedFile">
        <el-icon><Download /></el-icon> 下载
      </el-button>
      <el-button size="small" @click="createFile" :disabled="!sshReady">
        <el-icon><Document /></el-icon> 新建文件
      </el-button>
      <el-button size="small" @click="createFolder" :disabled="!sshReady">
        <el-icon><FolderAdd /></el-icon> 新建文件夹
      </el-button>
      <el-button size="small" @click="deleteFile" :disabled="!sshReady || !selectedFile">
        <el-icon><Delete /></el-icon> 删除
      </el-button>
      <el-button size="small" @click="refreshFileList" :disabled="!sshReady">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
      <el-input v-model="searchText" placeholder="搜索当前目录文件" size="small" style="width: 200px;" clearable />
    </div>

    <div class="sftp-content">
      <div class="remote-panel">
        <div class="panel-header">
          <div class="path-bar">
            <el-breadcrumb separator="/" class="path-breadcrumb">
              <el-breadcrumb-item v-for="(part, idx) in currentPathParts" :key="idx">
                <span class="breadcrumb-link" @click="navigateToPath(idx)">{{ part }}</span>
              </el-breadcrumb-item>
            </el-breadcrumb>
            <el-button size="small" :icon="CopyDocument" @click="copyPath" title="复制完整路径" />
          </div>
        </div>
        <div class="file-list-wrapper">
          <div class="file-list-header" :style="{ gridTemplateColumns: gridTemplateCols }">
            <div class="col-name sortable" @click="handleSort('name')">
              名称
              <span class="sort-icon">{{ getSortIcon('name') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('name', $event)"></div>
            </div>
            <div class="col-size sortable" @click="handleSort('size')">
              大小
              <span class="sort-icon">{{ getSortIcon('size') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('size', $event)"></div>
            </div>
            <div class="col-time sortable" @click="handleSort('modifyTime')">
              修改时间
              <span class="sort-icon">{{ getSortIcon('modifyTime') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('time', $event)"></div>
            </div>
            <div class="col-perm">
              权限
              <div class="resize-handle" @mousedown.prevent="startResize('perm', $event)"></div>
            </div>
          </div>
          <div class="file-list">
            <div
                v-for="file in sortedFiles"
                :key="file.name"
                class="file-item"
                :class="{ selected: selectedFile === file, 'is-folder': file.type === 'directory' }"
                :style="{ gridTemplateColumns: gridTemplateCols }"
                @click="handleRowClick($event, file)"
                @contextmenu.prevent="showContextMenu($event, file)"
            >
              <div
                  class="col-name"
                  :class="{ 'drag-over-folder': dragOverFolder === file && file.type === 'directory' }"
                  @dragenter="onDragEnterFolder(file, $event)"
                  @dragleave="onDragLeaveFolder"
                  @dragend="onDragEnd"
                  @dblclick="openEditor(file)"
              >
                <el-icon @click.stop="handleNameClick(file)" class="clickable-icon">
                  <Folder v-if="file.type === 'directory'" /><Document v-else />
                </el-icon>
                <span @click.stop="handleNameClick(file)" class="clickable-name">{{ file.name }}</span>
              </div>
              <div class="col-size">
                {{ formatSize(file.size) }}
              </div>
              <div class="col-time">
                {{ formatTime(file.modifyTime) }}
              </div>
              <div class="col-perm">
                {{ formatPermissions(file) }}
              </div>
            </div>
            <div v-if="filteredFiles.length === 0" class="empty-list">
              <el-empty description="暂无文件" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="transfer-panel" v-if="transfers.length > 0">
      <div class="transfer-header">
        <span>传输队列</span>
        <el-button size="small" text @click="clearTransfers">关闭</el-button>
      </div>
      <div v-for="t in transfers" :key="t.id" class="transfer-item">
        <span>{{ t.name }}</span>
        <el-progress :percentage="t.progress" :status="t.status === 'error' ? 'exception' : undefined" />
      </div>
    </div>

    <!-- 右键菜单 -->
    <div v-if="contextMenuVisible" class="context-menu" :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }">
      <div @click="editContextFile">编辑</div>
      <div @click="renameContextFile">重命名</div>
      <div @click="chmodFile">权限</div>
    </div>

    <!-- 权限修改对话框 -->
    <el-dialog v-model="chmodDialogVisible" title="修改权限" width="450px">
      <el-form>
        <el-form-item label="权限值 (八进制)">
          <el-input v-model="chmodValue" placeholder="例如 755" />
        </el-form-item>
        <el-form-item label="详细权限">
          <el-checkbox-group v-model="chmodChecks">
            <div style="margin-bottom: 8px;"><strong>所有者：</strong><el-checkbox label="owner-read">读</el-checkbox><el-checkbox label="owner-write">写</el-checkbox><el-checkbox label="owner-exec">执行</el-checkbox></div>
            <div style="margin-bottom: 8px;"><strong>组：</strong><el-checkbox label="group-read">读</el-checkbox><el-checkbox label="group-write">写</el-checkbox><el-checkbox label="group-exec">执行</el-checkbox></div>
            <div><strong>其他：</strong><el-checkbox label="other-read">读</el-checkbox><el-checkbox label="other-write">写</el-checkbox><el-checkbox label="other-exec">执行</el-checkbox></div>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="chmodDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmChmod">确定</el-button>
      </template>
    </el-dialog>

    <!-- 覆盖确认对话框 -->
    <el-dialog v-model="confirmOverwriteVisible" title="文件已存在" width="450px" :close-on-click-modal="false">
      <p>文件 <strong>{{ pendingFile?.name }}</strong> 在目标目录中已存在。</p>
      <p>请选择操作：</p>
      <el-radio-group v-model="overwriteAction">
        <el-radio label="overwrite">覆盖</el-radio>
        <el-radio label="skip">跳过</el-radio>
        <el-radio label="cancel">取消上传</el-radio>
      </el-radio-group>
      <div style="margin-top: 16px;">
        <el-checkbox v-model="alwaysSameAction">总是这样做（不再询问）</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="cancelOverwrite">取消</el-button>
        <el-button type="primary" @click="confirmOverwrite">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑文件对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑文件" width="80%" top="5vh" @close="closeEditor">
      <div class="editor-container">
        <textarea ref="editorTextarea" v-model="editContent" class="code-editor" :style="{ height: '60vh', fontFamily: 'monospace', fontSize: '14px' }"></textarea>
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveFileContent">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="renameDialogVisible" title="重命名" width="400px">
      <el-form>
        <el-form-item label="新名称">
          <el-input v-model="newName" placeholder="请输入新名称" autocomplete="off" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Upload, Download, FolderAdd, Delete, Refresh, Folder, Document, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getConfig, saveConfigKey } from '../api/config'

const props = defineProps<{
  connection: any
  sessionId: string
  ws: WebSocket | null
  sshReady: boolean
}>()

const currentPath = ref('/')
const files = ref<any[]>([])
const selectedFile = ref<any>(null)
const searchText = ref('')
const transfers = ref<any[]>([])
let messageHandler: ((event: MessageEvent) => void) | null = null

// ================== 列宽调整（后端存储） ==================
const colWidths = ref({ name: 300, size: 100, time: 160, perm: 180 })
const gridTemplateCols = computed(() => `${colWidths.value.name}px ${colWidths.value.size}px ${colWidths.value.time}px ${colWidths.value.perm}px`)

let resizingColumn: string | null = null
let startX = 0
let startWidth = 0

const loadColWidths = async () => {
  const config = await getConfig()
  if (config.sftp_col_widths) {
    colWidths.value = { ...colWidths.value, ...config.sftp_col_widths }
  }
}
const saveColWidths = async () => {
  await saveConfigKey('sftp_col_widths', colWidths.value)
}

const startResize = (col: string, e: MouseEvent) => {
  resizingColumn = col
  startX = e.clientX
  startWidth = colWidths.value[col as keyof typeof colWidths.value]
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  e.preventDefault()
}
const onMouseMove = (e: MouseEvent) => {
  if (!resizingColumn) return
  let newWidth = startWidth + (e.clientX - startX)
  if (newWidth < 50) newWidth = 50
  if (newWidth > 600) newWidth = 600
  colWidths.value[resizingColumn as keyof typeof colWidths.value] = newWidth
}
const onMouseUp = () => {
  resizingColumn = null
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  saveColWidths()
  nextTick(() => {})
}

// ================== 排序（后端存储） ==================
type SortField = 'name' | 'size' | 'modifyTime'
const sortField = ref<SortField>('name')
const sortOrder = ref<'asc' | 'desc'>('asc')
const handleSort = (field: SortField) => {
  if (sortField.value === field) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = field; sortOrder.value = 'asc' }
  saveConfigKey('sftp_sort', { field: sortField.value, order: sortOrder.value })
}
const getSortIcon = (field: SortField) => sortField.value === field ? (sortOrder.value === 'asc' ? '▲' : '▼') : ''
const loadSortState = async () => {
  const config = await getConfig()
  if (config.sftp_sort) {
    sortField.value = config.sftp_sort.field || 'name'
    sortOrder.value = config.sftp_sort.order || 'asc'
  }
}
const sortedFiles = computed(() => {
  let list = [...filteredFiles.value]
  const field = sortField.value, order = sortOrder.value
  list.sort((a, b) => {
    let aVal = field === 'name' ? a.name : (field === 'size' ? a.size : a.modifyTime)
    let bVal = field === 'name' ? b.name : (field === 'size' ? b.size : b.modifyTime)
    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })
  return list
})

// ================== 右键菜单与权限 ==================
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuFile = ref<any>(null)
const chmodDialogVisible = ref(false)
const chmodValue = ref('755')
const chmodChecks = ref<string[]>([])

// ================== 拖拽上传相关 ==================
const dragOverFolder = ref<any>(null)

const confirmOverwriteVisible = ref(false)
const pendingFile = ref<any>(null)
const pendingTargetDir = ref<string>('')
const overwriteAction = ref<'overwrite' | 'skip' | 'cancel'>('overwrite')
const alwaysSameAction = ref(false)
let resolveOverwrite: ((action: 'overwrite' | 'skip' | 'cancel') => void) | null = null

// 覆盖偏好（后端存储）
const overwritePreferences = ref<Record<string, 'overwrite' | 'skip'>>({})

const loadOverwritePrefs = async () => {
  const config = await getConfig()
  overwritePreferences.value = config.sftp_overwrite_prefs || {}
}
const saveOverwritePrefs = async () => {
  await saveConfigKey('sftp_overwrite_prefs', overwritePreferences.value)
}

const checkFileExists = async (targetPath: string): Promise<boolean> => {
  try {
    const response = await fetch('/api/sftp/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: props.sessionId, filePath: targetPath })
    })
    const data = await response.json()
    return data.success && data.exists
  } catch (err) { return false }
}

const showOverwriteConfirm = (file: File, targetDir: string): Promise<'overwrite' | 'skip' | 'cancel'> => {
  return new Promise((resolve) => {
    pendingFile.value = file
    pendingTargetDir.value = targetDir
    overwriteAction.value = 'overwrite'
    alwaysSameAction.value = false
    resolveOverwrite = resolve
    confirmOverwriteVisible.value = true
  })
}

const confirmOverwrite = () => {
  const action = overwriteAction.value
  if (alwaysSameAction.value && (action === 'overwrite' || action === 'skip')) {
    overwritePreferences.value[`${pendingTargetDir.value}|${pendingFile.value.name}`] = action
    saveOverwritePrefs()
  }
  if (resolveOverwrite) resolveOverwrite(action)
  confirmOverwriteVisible.value = false
}

const cancelOverwrite = () => {
  if (resolveOverwrite) resolveOverwrite('cancel')
  confirmOverwriteVisible.value = false
}

const doUpload = async (file: File, targetDir: string): Promise<boolean> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('sessionId', props.sessionId)
  formData.append('remotePath', targetDir)
  const transferId = Date.now() + Math.random()
  transfers.value.push({ id: transferId, name: file.name, progress: 0, status: 'uploading' })
  try {
    const response = await fetch('/api/sftp/upload', { method: 'POST', body: formData })
    const result = await response.json()
    if (result.success) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) { transfer.progress = 100; transfer.status = 'success' }
      ElMessage.success(`上传成功: ${file.name}`)
      if (targetDir === currentPath.value) loadFileList()
      return true
    } else throw new Error(result.error)
  } catch (err) {
    const transfer = transfers.value.find(t => t.id === transferId)
    if (transfer) transfer.status = 'error'
    ElMessage.error(`上传失败: ${file.name} - ${err.message}`)
    return false
  }
}

const uploadFileToPath = async (file: File, targetDir: string): Promise<boolean> => {
  const targetFilePath = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`
  const exists = await checkFileExists(targetFilePath)
  if (exists) {
    const prefKey = `${targetDir}|${file.name}`
    const savedAction = overwritePreferences.value[prefKey]
    if (savedAction === 'overwrite') return await doUpload(file, targetDir)
    if (savedAction === 'skip') { ElMessage.info(`跳过已存在文件: ${file.name}`); return false }
    const action = await showOverwriteConfirm(file, targetDir)
    if (action === 'overwrite') return await doUpload(file, targetDir)
    return false
  } else {
    return await doUpload(file, targetDir)
  }
}

const onDragEnter = (e: DragEvent) => { e.preventDefault() }
const onDragOver = (e: DragEvent) => { e.preventDefault() }
const onDragEnterFolder = (file: any, e: DragEvent) => {
  if (file.type === 'directory') { dragOverFolder.value = file; e.stopPropagation() }
}
const onDragLeaveFolder = () => { dragOverFolder.value = null }
const onDragEnd = () => { dragOverFolder.value = null }

const onDrop = async (e: DragEvent) => {
  e.preventDefault()
  const targetFolder = dragOverFolder.value
  const targetPath = targetFolder ? (currentPath.value === '/' ? `/${targetFolder.name}` : `${currentPath.value}/${targetFolder.name}`) : currentPath.value
  const droppedFiles = e.dataTransfer?.files
  if (!droppedFiles || droppedFiles.length === 0) return
  ElMessage.info(`开始上传 ${droppedFiles.length} 个文件到 ${targetPath === '/' ? '/' : targetPath}`)
  for (let i = 0; i < droppedFiles.length; i++) {
    await uploadFileToPath(droppedFiles[i], targetPath)
  }
  dragOverFolder.value = null
  if (targetPath === currentPath.value) loadFileList()
}

const uploadFile = () => {
  if (!props.sshReady) { ElMessage.warning('请等待 SSH 连接就绪'); return }
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = async (e: any) => {
    const files = e.target.files
    if (!files) return
    ElMessage.info(`开始上传 ${files.length} 个文件到当前目录`)
    for (const file of files) await uploadFileToPath(file, currentPath.value)
    loadFileList()
  }
  input.click()
}

// ================== 新建文件 ==================
const createFile = async () => {
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    const { value: fileName } = await ElMessageBox.prompt('请输入文件名（例如：script.sh）', '新建文件', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /^[^/\\:*?"<>|]+$/,
      inputErrorMessage: '文件名不能包含特殊字符 / \\ : * ? " < > |'
    })
    if (!fileName) return
    const fullPath = currentPath.value === '/' ? `/${fileName}` : `${currentPath.value}/${fileName}`
    const response = await fetch('/api/sftp/create-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: props.sessionId, filePath: fullPath })
    })
    const result = await response.json()
    if (result.success) {
      ElMessage.success(`文件 ${fileName} 创建成功`)
      loadFileList()
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (err) { if (err !== 'cancel') ElMessage.error('创建文件失败') }
}

// ================== 编辑文件 ==================
const editDialogVisible = ref(false)
const editContent = ref('')
const editingFilePath = ref('')
const editorTextarea = ref<HTMLTextAreaElement | null>(null)

const openEditor = async (file: any) => {
  if (file.type === 'directory') { ElMessage.warning('不能编辑文件夹'); return }
  editingFilePath.value = currentPath.value === '/' ? `/${file.name}` : `${currentPath.value}/${file.name}`
  const downloadUrl = `/api/sftp/download?sessionId=${props.sessionId}&filePath=${encodeURIComponent(editingFilePath.value)}`
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error('下载失败')
    const text = await response.text()
    editContent.value = text
    editDialogVisible.value = true
  } catch (err) {
    ElMessage.error('读取文件失败: ' + err.message)
  }
}

const saveFileContent = async () => {
  const blob = new Blob([editContent.value], { type: 'text/plain;charset=utf-8' })
  const fileName = editingFilePath.value.split('/').pop() || 'file'
  const file = new File([blob], fileName, { type: 'text/plain' })
  const dirPath = editingFilePath.value.split('/').slice(0, -1).join('/') || '/'
  const formData = new FormData()
  formData.append('file', file)
  formData.append('sessionId', props.sessionId)
  formData.append('remotePath', dirPath)
  try {
    const response = await fetch('/api/sftp/upload', { method: 'POST', body: formData })
    const result = await response.json()
    if (result.success) {
      ElMessage.success('保存成功')
      editDialogVisible.value = false
      loadFileList()
    } else {
      throw new Error(result.error)
    }
  } catch (err) {
    ElMessage.error('保存失败: ' + err.message)
  }
}

const closeEditor = () => {
  editContent.value = ''
  editingFilePath.value = ''
}

// ================== 重命名 ==================
const renameDialogVisible = ref(false)
const newName = ref('')
const renameTarget = ref<any>(null)

const renameContextFile = () => {
  if (!contextMenuFile.value) return
  renameTarget.value = contextMenuFile.value
  newName.value = contextMenuFile.value.name
  renameDialogVisible.value = true
  closeContextMenu()
}

const confirmRename = async () => {
  if (!renameTarget.value) return
  const newNameTrim = newName.value.trim()
  if (!newNameTrim) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (newNameTrim === renameTarget.value.name) {
    renameDialogVisible.value = false
    return
  }
  const oldPath = currentPath.value === '/' ? `/${renameTarget.value.name}` : `${currentPath.value}/${renameTarget.value.name}`
  const newPath = currentPath.value === '/' ? `/${newNameTrim}` : `${currentPath.value}/${newNameTrim}`
  if (props.ws && props.ws.readyState === WebSocket.OPEN) {
    props.ws.send(JSON.stringify({
      type: 'sftp-rename',
      sessionId: props.sessionId,
      oldPath: oldPath,
      newPath: newPath
    }))
    renameDialogVisible.value = false
    ElMessage.info('正在重命名...')
  } else {
    ElMessage.error('连接已断开')
  }
}

// ================== 原有功能（文件列表、导航、下载等） ==================
const currentPathParts = computed(() => {
  const parts = currentPath.value.split('/').filter(p => p)
  return ['root', ...parts]
})
const navigateToPath = (index: number) => {
  if (index === 0) currentPath.value = '/'
  else {
    const parts = currentPathParts.value.slice(1, index + 1)
    currentPath.value = '/' + parts.join('/')
  }
  loadFileList()
}
const copyPath = () => {
  navigator.clipboard.writeText(currentPath.value === '/' ? '/' : currentPath.value)
  ElMessage.success('路径已复制')
}

const formatPermissions = (file: any): string => {
  let mode = file.permissions, numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode
  if (isNaN(numericMode)) numericMode = 0
  const permBits = numericMode & 0xFFF
  const typeChar = file.type === 'directory' ? 'd' : '-'
  const owner = (permBits >> 6) & 7, group = (permBits >> 3) & 7, other = permBits & 7
  const permString = (p: number) => `${p & 4 ? 'r' : '-'}${p & 2 ? 'w' : '-'}${p & 1 ? 'x' : '-'}`
  return `${typeChar}${permString(owner)}${permString(group)}${permString(other)}`
}

const filteredFiles = computed(() => {
  if (!searchText.value) return files.value
  return files.value.filter(f => f.name.toLowerCase().includes(searchText.value.toLowerCase()))
})

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
const formatTime = (ts: number) => ts ? new Date(ts).toLocaleString() : '-'

const loadFileList = () => {
  if (!props.sshReady || !props.ws || props.ws.readyState !== WebSocket.OPEN) return
  props.ws.send(JSON.stringify({ type: 'sftp-list', sessionId: props.sessionId, path: currentPath.value }))
}
const refreshFileList = () => loadFileList()

const handleRowClick = (event: MouseEvent, file: any) => { selectedFile.value = file }
const handleNameClick = (file: any) => {
  if (file.type === 'directory') {
    selectedFile.value = file
    currentPath.value = currentPath.value === '/' ? `/${file.name}` : `${currentPath.value}/${file.name}`
    loadFileList()
  } else {
    selectedFile.value = file
  }
}

const downloadSelectedFile = async () => {
  if (!selectedFile.value) { ElMessage.warning('请先选中一个文件或文件夹'); return }
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  const remotePath = currentPath.value === '/' ? `/${selectedFile.value.name}` : `${currentPath.value}/${selectedFile.value.name}`
  if (selectedFile.value.type === 'directory') {
    const loading = ElMessage({ message: '正在打包文件夹，请稍候...', duration: 0, icon: 'Loading' })
    try {
      const response = await fetch('/api/sftp/download-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: props.sessionId, folderPath: remotePath })
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedFile.value.name}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      ElMessage.success('下载成功')
    } catch (err) { ElMessage.error('打包下载失败: ' + err.message) }
    finally { loading.close() }
  } else {
    const downloadUrl = `/api/sftp/download?sessionId=${props.sessionId}&filePath=${encodeURIComponent(remotePath)}`
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = selectedFile.value.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

const createFolder = async () => {
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    const { value } = await ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    if (value) {
      const newPath = currentPath.value === '/' ? `/${value}` : `${currentPath.value}/${value}`
      if (props.ws && props.ws.readyState === WebSocket.OPEN) {
        props.ws.send(JSON.stringify({ type: 'sftp-mkdir', sessionId: props.sessionId, path: newPath }))
      }
    }
  } catch (error) { /* 取消 */ }
}

const deleteFile = async () => {
  if (!selectedFile.value) { ElMessage.warning('请选择一个文件或文件夹'); return }
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    await ElMessageBox.confirm(`确定要删除 ${selectedFile.value.name} 吗？`, '提示', { type: 'warning' })
    const remotePath = currentPath.value === '/' ? `/${selectedFile.value.name}` : `${currentPath.value}/${selectedFile.value.name}`
    if (props.ws && props.ws.readyState === WebSocket.OPEN) {
      props.ws.send(JSON.stringify({ type: 'sftp-delete', sessionId: props.sessionId, path: remotePath }))
    }
  } catch (error) { /* 取消 */ }
}

const clearTransfers = () => { transfers.value = [] }

const showContextMenu = (event: MouseEvent, file: any) => {
  contextMenuFile.value = file
  contextMenuVisible.value = true
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  event.preventDefault()
}
const editContextFile = () => {
  if (contextMenuFile.value) openEditor(contextMenuFile.value)
  contextMenuVisible.value = false
}
const closeContextMenu = () => { contextMenuVisible.value = false }
const chmodFile = () => {
  if (!contextMenuFile.value) return
  const perm = contextMenuFile.value.permissions
  let octal = (perm && perm.length >= 3) ? perm.slice(-3) : '755'
  chmodValue.value = octal
  updateChecksFromOctal(octal)
  chmodDialogVisible.value = true
  closeContextMenu()
}
const updateChecksFromOctal = (octal: string) => {
  const num = parseInt(octal, 8)
  const owner = (num >> 6) & 7, group = (num >> 3) & 7, other = num & 7
  const checks: string[] = []
  if (owner & 4) checks.push('owner-read'); if (owner & 2) checks.push('owner-write'); if (owner & 1) checks.push('owner-exec')
  if (group & 4) checks.push('group-read'); if (group & 2) checks.push('group-write'); if (group & 1) checks.push('group-exec')
  if (other & 4) checks.push('other-read'); if (other & 2) checks.push('other-write'); if (other & 1) checks.push('other-exec')
  chmodChecks.value = checks
}
const updateOctalFromChecks = () => {
  let owner = 0, group = 0, other = 0
  if (chmodChecks.value.includes('owner-read')) owner += 4
  if (chmodChecks.value.includes('owner-write')) owner += 2
  if (chmodChecks.value.includes('owner-exec')) owner += 1
  if (chmodChecks.value.includes('group-read')) group += 4
  if (chmodChecks.value.includes('group-write')) group += 2
  if (chmodChecks.value.includes('group-exec')) group += 1
  if (chmodChecks.value.includes('other-read')) other += 4
  if (chmodChecks.value.includes('other-write')) other += 2
  if (chmodChecks.value.includes('other-exec')) other += 1
  chmodValue.value = `${owner}${group}${other}`
}
watch(chmodChecks, () => updateOctalFromChecks(), { deep: true })
const confirmChmod = async () => {
  if (!contextMenuFile.value) return
  const remotePath = currentPath.value === '/' ? `/${contextMenuFile.value.name}` : `${currentPath.value}/${contextMenuFile.value.name}`
  if (props.ws && props.ws.readyState === WebSocket.OPEN) {
    props.ws.send(JSON.stringify({ type: 'sftp-chmod', sessionId: props.sessionId, path: remotePath, mode: chmodValue.value }))
    chmodDialogVisible.value = false
    ElMessage.info('正在修改权限...')
  }
}

// WebSocket 消息处理
const handleWebSocketMessage = (event: MessageEvent) => {
  const message = JSON.parse(event.data)
  if (message.sessionId !== props.sessionId) return
  switch (message.type) {
    case 'sftp-list-response':
      if (message.success) files.value = message.files
      else ElMessage.error('加载文件列表失败: ' + message.error)
      break
    case 'sftp-delete-response':
      if (message.success) { ElMessage.success('删除成功'); loadFileList() }
      else ElMessage.error('删除失败')
      break
    case 'sftp-mkdir-response':
      if (message.success) { ElMessage.success('创建成功'); loadFileList() }
      else ElMessage.error('创建失败')
      break
    case 'sftp-chmod-response':
      if (message.success) { ElMessage.success('权限修改成功'); loadFileList() }
      else ElMessage.error('权限修改失败: ' + (message.error || '未知错误'))
      break
    case 'sftp-rename-response':
      if (message.success) {
        ElMessage.success('重命名成功')
        loadFileList()
      } else {
        ElMessage.error('重命名失败: ' + (message.error || '未知错误'))
      }
      break
  }
}

watch(() => props.ws, (newWs, oldWs) => {
  if (oldWs && messageHandler) oldWs.removeEventListener('message', messageHandler)
  if (newWs) { messageHandler = handleWebSocketMessage; newWs.addEventListener('message', messageHandler) }
}, { immediate: true })
watch(() => props.sshReady, (ready) => { if (ready && props.ws) loadFileList() })

onMounted(async () => {
  await loadColWidths()
  await loadSortState()
  await loadOverwritePrefs()
  if (props.sshReady && props.ws) loadFileList()
  document.addEventListener('click', closeContextMenu)
})
onUnmounted(() => {
  if (props.ws && messageHandler) props.ws.removeEventListener('message', messageHandler)
  document.removeEventListener('click', closeContextMenu)
})
</script>

<style scoped>
/* 核心样式 - 已适配暗色主题变量 */
.code-editor {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  resize: vertical;
}
.sftp-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sftp-toolbar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  flex-wrap: wrap;
}
.sftp-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.remote-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.panel-header {
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color-page);
}
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.path-breadcrumb {
  flex: 1;
}
.breadcrumb-link {
  cursor: pointer;
}
.breadcrumb-link:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}
.file-list-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.file-list-header {
  display: grid;
  background: var(--el-fill-color-light);
  font-weight: 500;
  font-size: 12px;
  border-bottom: 1px solid var(--el-border-color);
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--el-text-color-primary);
}
.file-list-header > div {
  padding: 8px 12px;
  position: relative;
  user-select: none;
  border-right: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.file-list-header > div:last-child {
  border-right: none;
}
.file-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.file-item {
  display: grid;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.file-item > div {
  padding: 8px 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: 1px solid var(--el-border-color-lighter);
}
.file-item > div:last-child {
  border-right: none;
}
.file-item:hover {
  background: var(--el-fill-color-light);
}
.file-item.selected {
  background: var(--el-color-primary-light-9);
}
.file-item.is-folder .clickable-name {
  font-weight: 600;
}
.file-item.is-folder .clickable-icon {
  color: var(--el-color-primary);
}
.col-name.drag-over-folder {
  background-color: var(--el-color-primary-light-7) !important;
  border-radius: 4px;
}
.sortable {
  cursor: pointer;
}
.sortable:hover {
  background-color: var(--el-fill-color-lighter);
}
.sort-icon {
  margin-left: 4px;
  font-size: 10px;
}
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
}
.resize-handle:hover {
  background: var(--el-color-primary);
  opacity: 0.5;
}
.col-name {
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background-color 0.2s;
}
.clickable-icon, .clickable-name {
  cursor: pointer;
}
.clickable-name:hover {
  text-decoration: underline;
}
.empty-list {
  padding: 40px;
  text-align: center;
}
.transfer-panel {
  flex-shrink: 0;
  border-top: 1px solid var(--el-border-color);
  max-height: 200px;
  overflow-y: auto;
}
.transfer-header {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  font-size: 13px;
}
.transfer-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.context-menu {
  position: fixed;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
  z-index: 2000;
  min-width: 100px;
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