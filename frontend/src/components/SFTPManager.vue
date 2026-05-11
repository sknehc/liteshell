<template>
  <div class="sftp-container" @dragenter="onDragEnter" @dragover="onDragOver" @drop="onDrop">
    <div class="sftp-toolbar">
      <el-button size="default" type="primary" @click="uploadFile" :disabled="!sshReady || currentPath === null">
        <el-icon><Upload /></el-icon> 上传
      </el-button>
      <el-button size="default" @click="downloadSelectedFile" :disabled="!sshReady || !selectedFile">
        <el-icon><Download /></el-icon> 下载
      </el-button>
      <el-button size="default" @click="createFile" :disabled="!sshReady || currentPath === null">
        <el-icon><Document /></el-icon> 新建文件
      </el-button>
      <el-button size="default" @click="createFolder" :disabled="!sshReady || currentPath === null">
        <el-icon><FolderAdd /></el-icon> 新建文件夹
      </el-button>
      <el-button size="default" @click="deleteFile" :disabled="!sshReady || !selectedFile">
        <el-icon><Delete /></el-icon> 删除
      </el-button>
      <el-button size="default" @click="refreshFileList" :disabled="!sshReady || currentPath === null">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
      <el-button
          size="default"
          @click="onOpenTerminalClick"
          :disabled="!sshReady || currentPath === null"
          title="在终端中打开当前路径"
      >
        <el-icon><Monitor /></el-icon>
        终端
      </el-button>
      <el-button
          size="default"
          @click="toggleShowHidden"
          :disabled="!sshReady"
          :type="showHidden ? 'primary' : 'default' "
      >
        <el-icon>
          <View v-if="showHidden" />
          <Hide v-else />
        </el-icon>
        显示隐藏文件
      </el-button>
      <el-dropdown ref="favoritesDropdownRef" trigger="click" :disabled="allFavorites.length === 0" style="margin-left: 4px;">
        <el-button size="default">
          收藏夹 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="fav in allFavorites" :key="fav.id + (fav.isPublic ? '_pub' : '_priv')" class="favorite-item">
              <div class="favorite-row">
                <span class="favorite-name" @click.stop="goToFavoritePath(fav.path)">
                  <el-tag v-if="fav.isPublic" size="default" type="warning" style="margin-right: 4px;">公用</el-tag>
                  <el-tag v-else size="default" type="success" style="margin-right: 4px;">私有</el-tag>
                  {{ fav.name }}
                </span>
                <span class="favorite-actions">
                  <el-icon class="action-icon" @click.stop="editFavorite(fav)"><Edit /></el-icon>
                  <el-icon class="action-icon" @click.stop="deleteFavorite(fav)"><Close /></el-icon>
                </span>
              </div>
            </el-dropdown-item>
            <el-dropdown-item v-if="allFavorites.length === 0" disabled>暂无收藏</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-input v-model="searchText" placeholder="搜索当前目录文件" size="default" style="width: 200px;" clearable />




    </div>

    <div class="sftp-content">
      <div class="remote-panel">
        <div class="panel-header">
          <div class="path-bar">
            <div class="custom-breadcrumb" v-if="currentPath !== null">
              <span class="breadcrumb-item" @click="navigateToPath(0)">/</span>
              <template v-for="(part, idx) in currentPathParts" :key="idx">
                <span v-if="idx > 0" class="breadcrumb-item">/</span>
                <span class="breadcrumb-item" @click="navigateToPath(idx + 1)">
                  <span class="breadcrumb-link">{{ part }}</span>
                </span>
              </template>
            </div>
            <div v-else class="path-loading">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>正在获取当前目录...</span>
            </div>
            <el-button size="default" :icon="DArrowRight" @click="goToPathSafe" title="跳转到指定路径" :disabled="currentPath === null" >
              跳转
            </el-button>
            <el-button size="default" :icon="CopyDocument" @click="copyPath" title="复制完整路径" :disabled="currentPath === null" >
              复制
            </el-button>
            <el-button size="default" @click="openFavoriteDialog" title="收藏当前路径" :disabled="!sshReady || currentPath === null" style="margin-left: auto; margin-right: 0;">
              <el-icon><Star /></el-icon> 收藏
            </el-button>
          </div>
        </div>

        <div class="file-list-wrapper" v-if="currentPath !== null">
          <div class="file-list-header" :style="{ gridTemplateColumns: gridTemplateCols }">
            <div class="col-name sortable" @click="handleSort('name')">
              名称 <span class="sort-icon">{{ getSortIcon('name') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('name', $event)"></div>
            </div>
            <div class="col-size sortable" @click="handleSort('size')">
              大小 <span class="sort-icon">{{ getSortIcon('size') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('size', $event)"></div>
            </div>
            <div class="col-time sortable" @click="handleSort('modifyTime')">
              修改时间 <span class="sort-icon">{{ getSortIcon('modifyTime') }}</span>
              <div class="resize-handle" @mousedown.prevent="startResize('time', $event)"></div>
            </div>
            <div class="col-perm">
              权限
              <div class="resize-handle" @mousedown.prevent="startResize('perm', $event)"></div>
            </div>
          </div>
          <div class="file-list">
            <div v-if="currentPath !== '/'" class="file-item" @click="goUpDirectory">
              <div class="col-name">
                <el-icon><Folder /></el-icon>
                <span class="clickable-name">••</span>
              </div>
            </div>
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
                <el-icon :class="{ 'folder-icon': file.type === 'directory' }" @click.stop="handleNameClick(file)">
                  <Folder v-if="file.type === 'directory'" />
                  <component :is="getFileIcon(file.name)" v-else />
                </el-icon>
                <span @click.stop="handleNameClick(file)" class="clickable-name">{{ file.name }}</span>
              </div>
              <div class="col-size">{{ formatSize(file.size) }}</div>
              <div class="col-time">{{ formatTime(file.modifyTime) }}</div>
              <div class="col-perm">{{ formatPermissions(file) }}</div>
            </div>
            <div v-if="filteredFiles.length === 0 && currentPath !== '/'" class="empty-list"><el-empty description="暂无文件" /></div>
            <div v-if="filteredFiles.length === 0 && currentPath === '/'" class="empty-list"><el-empty description="目录为空" /></div>
          </div>
        </div>
        <div v-else class="loading-container"><el-icon class="is-loading" :size="32"><Loading /></el-icon><p>正在同步工作目录...</p></div>
      </div>
    </div>

    <div class="transfer-panel" v-if="transfers.length > 0">
      <div class="transfer-header"><span>传输队列</span><el-button size="default" text @click="clearTransfers">关闭</el-button></div>
      <div v-for="t in transfers" :key="t.id" class="transfer-item">
        <span>{{ t.name }}</span>
        <el-progress :percentage="t.progress" :status="t.status === 'error' ? 'exception' : undefined" />
      </div>
    </div>

    <div v-if="contextMenuVisible" class="context-menu" :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }">
      <div v-if="contextMenuFile && contextMenuFile.type !== 'directory'" @click="viewFile">查看</div>
      <div @click="editContextFile">编辑</div>
      <div @click="renameContextFile">重命名</div>
      <div @click="copyFileName">复制名称</div>
      <div @click="copyFilePath">复制路径</div>
      <div @click="chmodFile">权限设置</div>
    </div>

    <el-dialog v-model="chmodDialogVisible" title="修改权限" width="450px">
      <el-form>
        <el-form-item label="权限值 (八进制)"><el-input v-model="chmodValue" placeholder="例如 755" /></el-form-item>
        <el-form-item label="详细权限">
          <el-checkbox-group v-model="chmodChecks">
            <div style="margin-bottom: 8px;"><strong>所有者：</strong><el-checkbox label="owner-read">读</el-checkbox><el-checkbox label="owner-write">写</el-checkbox><el-checkbox label="owner-exec">执行</el-checkbox></div>
            <div style="margin-bottom: 8px;"><strong>组：</strong><el-checkbox label="group-read">读</el-checkbox><el-checkbox label="group-write">写</el-checkbox><el-checkbox label="group-exec">执行</el-checkbox></div>
            <div><strong>其他：</strong><el-checkbox label="other-read">读</el-checkbox><el-checkbox label="other-write">写</el-checkbox><el-checkbox label="other-exec">执行</el-checkbox></div>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="chmodDialogVisible = false">取消</el-button><el-button type="primary" @click="confirmChmod">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="confirmOverwriteVisible" title="文件已存在" width="450px" :close-on-click-modal="false">
      <p>文件 <strong>{{ pendingFile?.name }}</strong> 在目标目录中已存在。</p>
      <p>请选择操作：</p>
      <el-radio-group v-model="overwriteAction">
        <el-radio label="overwrite">覆盖</el-radio>
        <el-radio label="skip">跳过</el-radio>
        <el-radio label="cancel">取消上传</el-radio>
      </el-radio-group>
      <div style="margin-top: 16px;"><el-checkbox v-model="alwaysSameAction">总是这样做（不再询问）</el-checkbox></div>
      <template #footer><el-button @click="cancelOverwrite">取消</el-button><el-button type="primary" @click="confirmOverwrite">确定</el-button></template>
    </el-dialog>

    <!-- 查看文件对话框（带行号，复用编辑模式布局） -->
    <el-dialog v-model="viewDialogVisible" title="查看文件" width="80%" top="5vh">
      <div class="editor-wrapper edit-mode">
        <div class="line-numbers" ref="viewLineNumbersRef">{{ viewLineNumbers }}</div>
        <pre class="code-editor view-only" @scroll="syncViewLineNumbersScroll">{{ viewContent }}</pre>
      </div>
      <template #footer>
        <el-button @click="viewDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑文件对话框（带行号） -->
    <el-dialog v-model="editDialogVisible" title="编辑文件" width="80%" top="5vh" @close="closeEditor">
      <div class="editor-wrapper edit-mode">
        <div class="line-numbers" ref="editLineNumbersRef">{{ editLineNumbers }}</div>
        <textarea ref="editorTextarea" v-model="editContent" class="code-editor" @scroll="syncEditLineNumbersScroll"></textarea>
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveFileContent">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="renameDialogVisible" title="重命名" width="400px">
      <el-form><el-form-item label="新名称"><el-input v-model="newName" placeholder="请输入新名称" autocomplete="off" /></el-form-item></el-form>
      <template #footer><el-button @click="renameDialogVisible = false">取消</el-button><el-button type="primary" @click="confirmRename">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="favoriteDialogVisible" :title="isEditingFavorite ? '编辑收藏' : '添加收藏'" width="480px" destroy-on-close>
      <el-form :model="favoriteForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="favoriteForm.name" placeholder="收藏名称" /></el-form-item>
        <el-form-item label="路径"><el-input v-model="favoriteForm.path" placeholder="服务器路径" /></el-form-item>
        <el-form-item label="类型">
          <el-switch v-model="favoriteForm.isPublic" active-text="公用" inactive-text="私有" :active-value="true" :inactive-value="false" />
          <div class="form-tip">公用收藏对所有连接可见，私有收藏仅当前连接可见</div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="favoriteDialogVisible = false">取消</el-button><el-button type="primary" @click="saveFavorite">{{ isEditingFavorite ? '更新' : '添加' }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  Upload, Download, FolderAdd, Delete, Refresh, Folder, Document,
  CopyDocument, DArrowRight, Loading, Monitor, Star, Edit, Close, ArrowDown,
  View, Hide, Picture, VideoCamera, Headphone, Collection, Code,
  Edit as EditIcon, Files, Grid, Presentation, Font
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getConfig, saveConfigKey } from '../api/config'
import { v4 as uuidv4 } from '../utils/uuid'
import { useConnectionStore } from '../stores/connectionStore'

const props = defineProps<{
  connection: any
  sessionId: string
  ws: WebSocket | null
  sshReady: boolean
  onOpenTerminal?: (path: string | null) => void
  initialPath?: string | null
}>()

const emit = defineEmits<{
  (e: 'path-change', path: string): void
}>()

const connectionStore = useConnectionStore()

const currentPath = ref<string | null>(null)
const files = ref<any[]>([])
const selectedFile = ref<any>(null)
const searchText = ref('')
const transfers = ref<any[]>([])
const showHidden = ref(false)
let messageHandler: ((event: MessageEvent) => void) | null = null
const isNavigating = ref(false)
const viewDialogVisible = ref(false);
const viewContent = ref('');

const currentPathParts = computed(() => {
  if (currentPath.value === null) return []
  return currentPath.value.split('/').filter(p => p)
})
const toggleShowHidden = () => {
  showHidden.value = !showHidden.value;
};
const getPathFromIndex = (idx: number) => {
  if (currentPath.value === null) return '/'
  if (idx === 0) return '/'
  const parts = currentPathParts.value.slice(0, idx)
  return '/' + parts.join('/')
}

let sftpRequestId = 0
const pendingRequests = new Map<number, { resolve: Function; reject: Function }>()

const navigateToSafePath = async (targetPath: string): Promise<boolean> => {
  if (!props.sshReady || !props.ws || props.ws.readyState !== WebSocket.OPEN) {
    ElMessage.warning('SSH 连接未就绪')
    return false
  }
  if (isNavigating.value) {
    ElMessage.info('正在切换目录，请稍后...')
    return false
  }
  isNavigating.value = true
  const requestId = ++sftpRequestId
  return new Promise<boolean>((resolve) => {
    pendingRequests.set(requestId, {
      resolve: (result: any) => {
        currentPath.value = targetPath
        files.value = result.files
        isNavigating.value = false
        emit('path-change', targetPath)
        resolve(true)
      },
      reject: (err: Error) => {
        ElMessage.error(`无法访问目录：${err.message || '权限不足或目录不存在'}`)
        isNavigating.value = false
        resolve(false)
      }
    })
    props.ws!.send(JSON.stringify({ type: 'sftp-list', sessionId: props.sessionId, path: targetPath, requestId }))
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        isNavigating.value = false
        ElMessage.error('请求超时，无法进入目录')
        resolve(false)
      }
    }, 10000)
  })
}

const navigateToPath = async (idx: number) => {
  if (currentPath.value !== null) await navigateToSafePath(getPathFromIndex(idx))
}
const goUpDirectory = async () => {
  if (currentPath.value === null || currentPath.value === '/') return
  const parentPath = currentPath.value.substring(0, currentPath.value.lastIndexOf('/')) || '/'
  await navigateToSafePath(parentPath)
}
const goToPathSafe = async () => {
  if (currentPath.value === null) return
  const { value: inputPath } = await ElMessageBox.prompt('请输入服务器路径（绝对路径）', '跳转到路径', {
    confirmButtonText: '确定', cancelButtonText: '取消', inputValue: currentPath.value,
    inputPattern: /^\//, inputErrorMessage: '路径必须以 / 开头'
  })
  if (inputPath) {
    let newPath = inputPath.trim()
    if (newPath !== '/' && newPath.endsWith('/')) newPath = newPath.slice(0, -1)
    await navigateToSafePath(newPath)
  }
}
const copyPath = () => {
  if (currentPath.value === null) return
  navigator.clipboard.writeText(currentPath.value === '/' ? '/' : currentPath.value)
  ElMessage.success('路径已复制')
}

const colWidths = ref({ name: 300, size: 100, time: 160, perm: 180 })
const gridTemplateCols = computed(() => `${colWidths.value.name}px ${colWidths.value.size}px ${colWidths.value.time}px ${colWidths.value.perm}px`)
let resizingColumn: string | null = null, startX = 0, startWidth = 0
const loadColWidths = async () => {
  const config = await getConfig()
  if (config.sftp_col_widths) colWidths.value = { ...colWidths.value, ...config.sftp_col_widths }
}
const saveColWidths = async () => await saveConfigKey('sftp_col_widths', colWidths.value)
const startResize = (col: string, e: MouseEvent) => {
  resizingColumn = col; startX = e.clientX; startWidth = colWidths.value[col as keyof typeof colWidths.value]
  document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); e.preventDefault()
}
const onMouseMove = (e: MouseEvent) => {
  if (!resizingColumn) return
  let newWidth = startWidth + (e.clientX - startX)
  if (newWidth < 50) newWidth = 50
  if (newWidth > 600) newWidth = 600
  colWidths.value[resizingColumn as keyof typeof colWidths.value] = newWidth
}
const onMouseUp = () => { resizingColumn = null; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); saveColWidths(); nextTick(() => {}) }

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
  if (config.sftp_sort) { sortField.value = config.sftp_sort.field || 'name'; sortOrder.value = config.sftp_sort.order || 'asc' }
}
const sortedFiles = computed(() => {
  let list = filteredFiles.value
  if (!showHidden.value) list = list.filter(f => !f.name.startsWith('.'))
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

const contextMenuVisible = ref(false); const contextMenuX = ref(0); const contextMenuY = ref(0); const contextMenuFile = ref<any>(null)
const chmodDialogVisible = ref(false); const chmodValue = ref('755'); const chmodChecks = ref<string[]>([])
const dragOverFolder = ref<any>(null)

const confirmOverwriteVisible = ref(false); const pendingFile = ref<any>(null); const pendingTargetDir = ref<string>(''); const pendingRemoteFileName = ref<string>('')
const overwriteAction = ref<'overwrite' | 'skip' | 'cancel'>('overwrite'); const alwaysSameAction = ref(false)
let resolveOverwrite: ((action: 'overwrite' | 'skip' | 'cancel') => void) | null = null
const batchOverwriteAction = ref<'overwrite' | 'skip' | null>(null)

const checkFileExists = async (targetPath: string): Promise<boolean> => {
  try {
    const response = await fetch('/api/sftp/exists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: props.sessionId, filePath: targetPath }) })
    const data = await response.json()
    return data.success && data.exists
  } catch (err) { return false }
}

const showOverwriteConfirm = (file: File, targetDir: string, remoteFileName: string): Promise<'overwrite' | 'skip' | 'cancel'> => {
  return new Promise((resolve) => {
    pendingFile.value = file
    pendingTargetDir.value = targetDir
    pendingRemoteFileName.value = remoteFileName
    overwriteAction.value = 'overwrite'
    alwaysSameAction.value = false
    resolveOverwrite = resolve
    confirmOverwriteVisible.value = true
  })
}

const confirmOverwrite = () => {
  const action = overwriteAction.value
  if (alwaysSameAction.value && (action === 'overwrite' || action === 'skip')) {
    batchOverwriteAction.value = action
  }
  if (resolveOverwrite) resolveOverwrite(action)
  confirmOverwriteVisible.value = false
}
const cancelOverwrite = () => { if (resolveOverwrite) resolveOverwrite('cancel'); confirmOverwriteVisible.value = false }

async function doUpload(file: File, remoteDir: string, remoteFileName: string, silent = false): Promise<boolean> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('sessionId', props.sessionId)
  formData.append('remotePath', remoteDir)
  formData.append('remoteFileName', remoteFileName)
  const transferId = Date.now() + Math.random()
  if (!silent) {
    transfers.value.push({ id: transferId, name: remoteFileName, progress: 0, status: 'uploading' })
  }
  try {
    const response = await fetch('/api/sftp/upload', { method: 'POST', body: formData })
    const result = await response.json()
    if (result.success) {
      if (!silent) {
        const transfer = transfers.value.find(t => t.id === transferId)
        if (transfer) { transfer.progress = 100; transfer.status = 'success' }
        ElMessage.success(`上传成功: ${remoteFileName}`)
      }
      if (remoteDir === currentPath.value) refreshFileList()
      return true
    } else throw new Error(result.error)
  } catch (err) {
    if (!silent) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) transfer.status = 'error'
      ElMessage.error(`上传失败: ${remoteFileName} - ${err.message}`)
    } else {
      ElMessage.error(`保存失败: ${err.message}`)
    }
    return false
  }
}

async function uploadFileToRemote(file: File, remoteDir: string, remoteFileName: string, skipConfirm = false, silent = false): Promise<boolean> {
  const fullRemotePath = remoteDir === '/' ? `/${remoteFileName}` : `${remoteDir}/${remoteFileName}`
  const exists = await checkFileExists(fullRemotePath)
  if (!exists) {
    return doUpload(file, remoteDir, remoteFileName, silent)
  }
  if (skipConfirm || batchOverwriteAction.value === 'overwrite') {
    return doUpload(file, remoteDir, remoteFileName, silent)
  }
  if (batchOverwriteAction.value === 'skip') {
    if (!silent) ElMessage.info(`跳过已存在文件: ${remoteFileName}`)
    return false
  }
  const action = await showOverwriteConfirm(file, remoteDir, remoteFileName)
  if (action === 'overwrite') return doUpload(file, remoteDir, remoteFileName, silent)
  return false
}
async function ensureRemoteDirectory(dirPath: string): Promise<void> {
  if (dirPath === '/' || dirPath === '') return
  const parts = dirPath.split('/').filter(p => p)
  let currentPathBuild = ''
  for (const part of parts) {
    currentPathBuild += `/${part}`
    try {
      await new Promise((resolve, reject) => {
        if (!props.ws || props.ws.readyState !== WebSocket.OPEN) reject(new Error('连接断开'))
        const requestId = ++sftpRequestId
        const handler = (event: MessageEvent) => {
          const msg = JSON.parse(event.data)
          if (msg.type === 'sftp-mkdir-response' && msg.requestId === requestId) {
            props.ws!.removeEventListener('message', handler)
            if (msg.success) resolve(true)
            else if (msg.error && (msg.error.includes('exists') || msg.error.includes('存在'))) resolve(true)
            else reject(new Error(msg.error))
          }
        }
        props.ws!.addEventListener('message', handler)
        props.ws!.send(JSON.stringify({ type: 'sftp-mkdir', sessionId: props.sessionId, path: currentPathBuild, requestId }))
        setTimeout(() => { props.ws!.removeEventListener('message', handler); reject(new Error('创建目录超时')) }, 10000)
      })
    } catch (err) {
      if (!err.message.includes('exists')) throw err
    }
  }
}

async function traverseFileEntry(entry: any, relativePath: string, filesList: Array<{ file: File; relPath: string }>): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) => entry.file(resolve))
    filesList.push({ file, relPath: relativePath })
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader()
    const entries = await new Promise<any[]>((resolve) => dirReader.readEntries(resolve))
    for (const childEntry of entries) {
      await traverseFileEntry(childEntry, relativePath ? `${relativePath}/${childEntry.name}` : childEntry.name, filesList)
    }
  }
}

const onDrop = async (e: DragEvent) => {
  e.preventDefault()
  if (currentPath.value === null) return
  batchOverwriteAction.value = null

  const targetFolder = dragOverFolder.value
  let targetPath = targetFolder
      ? (currentPath.value === '/' ? `/${targetFolder.name}` : `${currentPath.value}/${targetFolder.name}`)
      : currentPath.value

  const items = e.dataTransfer?.items
  if (!items) return

  const filesToUpload: Array<{ file: File; relPath: string }> = []

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry()
    if (!entry) continue
    if (entry.isDirectory) {
      await traverseFileEntry(entry, entry.name, filesToUpload)
    } else {
      await traverseFileEntry(entry, '', filesToUpload)
    }
  }

  if (filesToUpload.length === 0) return
  ElMessage.info(`开始上传 ${filesToUpload.length} 个文件到 ${targetPath === '/' ? '/' : targetPath}`)

  for (const { file, relPath } of filesToUpload) {
    const remoteDir = relPath.includes('/')
        ? (targetPath === '/' ? `/${relPath.substring(0, relPath.lastIndexOf('/'))}` : `${targetPath}/${relPath.substring(0, relPath.lastIndexOf('/'))}`)
        : targetPath
    const remoteFileName = relPath.includes('/') ? relPath.substring(relPath.lastIndexOf('/') + 1) : file.name
    await ensureRemoteDirectory(remoteDir)
    await uploadFileToRemote(file, remoteDir, remoteFileName)
  }
  refreshFileList()
  dragOverFolder.value = null
}

const onDragEnter = (e: DragEvent) => { e.preventDefault() }
const onDragOver = (e: DragEvent) => { e.preventDefault() }
const onDragEnterFolder = (file: any, e: DragEvent) => { if (file.type === 'directory') { dragOverFolder.value = file; e.stopPropagation() } }
const onDragLeaveFolder = () => { dragOverFolder.value = null }
const onDragEnd = () => { dragOverFolder.value = null }

const uploadFile = () => {
  if (!props.sshReady) { ElMessage.warning('请等待 SSH 连接就绪'); return }
  if (currentPath.value === null) { ElMessage.warning('目录尚未同步'); return }
  batchOverwriteAction.value = null

  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = async (e: any) => {
    const filesList = e.target.files
    if (!filesList) return
    ElMessage.info(`开始上传 ${filesList.length} 个文件到当前目录`)
    for (const file of filesList) {
      await uploadFileToRemote(file, currentPath.value!, file.name)
    }
    refreshFileList()
  }
  input.click()
}

const createFile = async () => {
  if (currentPath.value === null) return
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    const { value: fileName } = await ElMessageBox.prompt('请输入文件名（例如：script.sh）', '新建文件', {
      confirmButtonText: '创建', cancelButtonText: '取消',
      inputPattern: /^[^/\\:*?"<>|]+$/, inputErrorMessage: '文件名不能包含特殊字符 / \\ : * ? " < > |'
    })
    if (!fileName) return
    const fullPath = currentPath.value === '/' ? `/${fileName}` : `${currentPath.value}/${fileName}`
    const response = await fetch('/api/sftp/create-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: props.sessionId, filePath: fullPath }) })
    const result = await response.json()
    if (result.success) { ElMessage.success(`文件 ${fileName} 创建成功`); refreshFileList() }
    else ElMessage.error(`创建失败: ${result.error}`)
  } catch (err) { if (err !== 'cancel') ElMessage.error('创建文件失败') }
}

const editDialogVisible = ref(false); const editContent = ref(''); const editingFilePath = ref(''); const editorTextarea = ref<HTMLTextAreaElement | null>(null)
const openEditor = async (file: any) => {
  if (currentPath.value === null) return
  if (file.type === 'directory') { ElMessage.warning('不能编辑文件夹'); return }
  editingFilePath.value = currentPath.value === '/' ? `/${file.name}` : `${currentPath.value}/${file.name}`
  const downloadUrl = `/api/sftp/download?sessionId=${props.sessionId}&filePath=${encodeURIComponent(editingFilePath.value)}`
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error('下载失败')
    const text = await response.text()
    editContent.value = text
    editDialogVisible.value = true
    nextTick(() => {
      syncEditLineNumbersScroll() // 初始同步滚动位置
    })
  } catch (err) { ElMessage.error('读取文件失败: ' + err.message) }
}
const syncViewLineNumbersScroll = () => {
  if (viewLineNumbersRef.value) {
    const pre = viewLineNumbersRef.value.nextElementSibling as HTMLElement
    if (pre) {
      viewLineNumbersRef.value.scrollTop = pre.scrollTop
    }
  }
}

const viewFile = async () => {
  if (!contextMenuFile.value || contextMenuFile.value.type === 'directory') {
    ElMessage.warning('不能查看文件夹');
    return;
  }
  if (currentPath.value === null) return;
  const filePath = currentPath.value === '/' ? `/${contextMenuFile.value.name}` : `${currentPath.value}/${contextMenuFile.value.name}`;
  const downloadUrl = `/api/sftp/download?sessionId=${props.sessionId}&filePath=${encodeURIComponent(filePath)}`;
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('读取失败');
    const text = await response.text();
    viewContent.value = text;
    viewDialogVisible.value = true;
  } catch (err) {
    ElMessage.error('读取文件失败: ' + err.message);
  }
  contextMenuVisible.value = false;
};

const saveFileContent = async () => {
  if (currentPath.value === null) return
  const blob = new Blob([editContent.value], { type: 'text/plain;charset=utf-8' })
  const fileName = editingFilePath.value.split('/').pop() || 'file'
  const file = new File([blob], fileName, { type: 'text/plain' })
  const dirPath = editingFilePath.value.split('/').slice(0, -1).join('/') || '/'
  batchOverwriteAction.value = null
  const success = await uploadFileToRemote(file, dirPath, fileName, true, true)
  if (success) {
    ElMessage.success('保存成功')
    editDialogVisible.value = false
    refreshFileList()
  }
}
const closeEditor = () => { editContent.value = ''; editingFilePath.value = '' }

const renameDialogVisible = ref(false); const newName = ref(''); const renameTarget = ref<any>(null)
const renameContextFile = () => { if (!contextMenuFile.value) return; renameTarget.value = contextMenuFile.value; newName.value = contextMenuFile.value.name; renameDialogVisible.value = true; closeContextMenu() }
const confirmRename = async () => {
  if (currentPath.value === null || !renameTarget.value) return
  const newNameTrim = newName.value.trim()
  if (!newNameTrim) { ElMessage.warning('名称不能为空'); return }
  if (newNameTrim === renameTarget.value.name) { renameDialogVisible.value = false; return }
  const oldPath = currentPath.value === '/' ? `/${renameTarget.value.name}` : `${currentPath.value}/${renameTarget.value.name}`
  const newPath = currentPath.value === '/' ? `/${newNameTrim}` : `${currentPath.value}/${newNameTrim}`
  if (props.ws && props.ws.readyState === WebSocket.OPEN) {
    props.ws.send(JSON.stringify({ type: 'sftp-rename', sessionId: props.sessionId, oldPath, newPath }))
    renameDialogVisible.value = false
    ElMessage.info('正在重命名...')
  } else ElMessage.error('连接已断开')
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
const formatSize = (bytes: number) => { if (bytes === 0) return '0 B'; const k = 1024, sizes = ['B','KB','MB','GB']; const i = Math.floor(Math.log(bytes)/Math.log(k)); return parseFloat((bytes/Math.pow(k,i)).toFixed(2)) + ' ' + sizes[i] }
const formatTime = (ts: number) => ts ? new Date(ts).toLocaleString() : '-'
const refreshFileList = () => { if (props.sshReady && props.ws && props.ws.readyState === WebSocket.OPEN && currentPath.value !== null) props.ws.send(JSON.stringify({ type: 'sftp-list', sessionId: props.sessionId, path: currentPath.value })) }
const handleRowClick = (event: MouseEvent, file: any) => { selectedFile.value = file }
const handleNameClick = async (file: any) => {
  if (file.type === 'directory') {
    selectedFile.value = file
    if (currentPath.value === null) return
    const newPath = currentPath.value === '/' ? `/${file.name}` : `${currentPath.value}/${file.name}`
    await navigateToSafePath(newPath)
  } else selectedFile.value = file
}

const downloadSelectedFile = async () => {
  if (currentPath.value === null || !selectedFile.value) { ElMessage.warning('请先选中一个文件或文件夹'); return }
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  const remotePath = currentPath.value === '/' ? `/${selectedFile.value.name}` : `${currentPath.value}/${selectedFile.value.name}`
  if (selectedFile.value.type === 'directory') {
    const loading = ElMessage({ message: '正在打包文件夹，请稍候...', duration: 0, icon: 'Loading' })
    try {
      const response = await fetch('/api/sftp/download-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: props.sessionId, folderPath: remotePath }) })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selectedFile.value.name}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      ElMessage.success('下载成功')
    } catch (err) { ElMessage.error('打包下载失败: ' + err.message) } finally { loading.close() }
  } else {
    const downloadUrl = `/api/sftp/download?sessionId=${props.sessionId}&filePath=${encodeURIComponent(remotePath)}`
    const a = document.createElement('a'); a.href = downloadUrl; a.download = selectedFile.value.name; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
}
const createFolder = async () => {
  if (currentPath.value === null) return
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    const { value } = await ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', { confirmButtonText: '确定', cancelButtonText: '取消' })
    if (value) {
      const newPath = currentPath.value === '/' ? `/${value}` : `${currentPath.value}/${value}`
      if (props.ws && props.ws.readyState === WebSocket.OPEN) props.ws.send(JSON.stringify({ type: 'sftp-mkdir', sessionId: props.sessionId, path: newPath }))
    }
  } catch (error) { /* 取消 */ }
}
const deleteFile = async () => {
  if (currentPath.value === null || !selectedFile.value) { ElMessage.warning('请选择一个文件或文件夹'); return }
  if (!props.sshReady) { ElMessage.warning('SSH 未就绪'); return }
  try {
    await ElMessageBox.confirm(`确定要删除 ${selectedFile.value.name} 吗？`, '提示', { type: 'warning' })
    const remotePath = currentPath.value === '/' ? `/${selectedFile.value.name}` : `${currentPath.value}/${selectedFile.value.name}`
    if (props.ws && props.ws.readyState === WebSocket.OPEN) props.ws.send(JSON.stringify({ type: 'sftp-delete', sessionId: props.sessionId, path: remotePath }))
  } catch (error) { /* 取消 */ }
}
const clearTransfers = () => { transfers.value = [] }

const showContextMenu = (event: MouseEvent, file: any) => { contextMenuFile.value = file; contextMenuVisible.value = true; contextMenuX.value = event.clientX; contextMenuY.value = event.clientY; event.preventDefault() }
const editContextFile = () => { if (contextMenuFile.value) openEditor(contextMenuFile.value); contextMenuVisible.value = false }
const closeContextMenu = () => { contextMenuVisible.value = false }

const copyFileName = () => {
  if (contextMenuFile.value) {
    navigator.clipboard.writeText(contextMenuFile.value.name)
        .then(() => ElMessage.success('文件名已复制'))
        .catch(() => ElMessage.error('复制失败'));
  }
  contextMenuVisible.value = false;
};

const copyFilePath = () => {
  if (contextMenuFile.value && currentPath.value !== null) {
    const fullPath = currentPath.value === '/' ? `/${contextMenuFile.value.name}` : `${currentPath.value}/${contextMenuFile.value.name}`;
    navigator.clipboard.writeText(fullPath)
        .then(() => ElMessage.success('路径已复制'))
        .catch(() => ElMessage.error('复制失败'));
  }
  contextMenuVisible.value = false;
};
const chmodFile = () => {
  if (!contextMenuFile.value) return
  const perm = contextMenuFile.value.permissions
  let octal = (perm && perm.length >= 3) ? perm.slice(-3) : '755'
  chmodValue.value = octal
  const updateChecksFromOctal = (octal: string) => {
    const num = parseInt(octal, 8); const owner = (num >> 6) & 7, group = (num >> 3) & 7, other = num & 7; const checks: string[] = []
    if (owner & 4) checks.push('owner-read'); if (owner & 2) checks.push('owner-write'); if (owner & 1) checks.push('owner-exec')
    if (group & 4) checks.push('group-read'); if (group & 2) checks.push('group-write'); if (group & 1) checks.push('group-exec')
    if (other & 4) checks.push('other-read'); if (other & 2) checks.push('other-write'); if (other & 1) checks.push('other-exec')
    chmodChecks.value = checks
  }
  updateChecksFromOctal(octal)
  chmodDialogVisible.value = true
  closeContextMenu()
}
const updateOctalFromChecks = () => {
  let owner = 0, group = 0, other = 0
  if (chmodChecks.value.includes('owner-read')) owner += 4; if (chmodChecks.value.includes('owner-write')) owner += 2; if (chmodChecks.value.includes('owner-exec')) owner += 1
  if (chmodChecks.value.includes('group-read')) group += 4; if (chmodChecks.value.includes('group-write')) group += 2; if (chmodChecks.value.includes('group-exec')) group += 1
  if (chmodChecks.value.includes('other-read')) other += 4; if (chmodChecks.value.includes('other-write')) other += 2; if (chmodChecks.value.includes('other-exec')) other += 1
  chmodValue.value = `${owner}${group}${other}`
}
watch(chmodChecks, () => updateOctalFromChecks(), { deep: true })
const confirmChmod = async () => {
  if (currentPath.value === null || !contextMenuFile.value) return
  const remotePath = currentPath.value === '/' ? `/${contextMenuFile.value.name}` : `${currentPath.value}/${contextMenuFile.value.name}`
  if (props.ws && props.ws.readyState === WebSocket.OPEN) {
    props.ws.send(JSON.stringify({ type: 'sftp-chmod', sessionId: props.sessionId, path: remotePath, mode: chmodValue.value }))
    chmodDialogVisible.value = false
    ElMessage.info('正在修改权限...')
  }
}

const handleWebSocketMessage = (event: MessageEvent) => {
  if (!props.ws || event.target !== props.ws) return
  const message = JSON.parse(event.data)
  if (message.sessionId !== props.sessionId) return
  const { type, requestId, success, files: fileList, error, path } = message

  if (type === 'sftp-pwd-response') {
    if (success && path) {
      currentPath.value = path
      emit('path-change', path)
      refreshFileList()
    } else {
      ElMessage.error('获取当前目录失败: ' + (error || '未知错误'))
      currentPath.value = '/'
      refreshFileList()
    }
    return
  }
  if (type === 'sftp-list-response' && requestId && pendingRequests.has(requestId)) {
    const { resolve, reject } = pendingRequests.get(requestId)!
    pendingRequests.delete(requestId)
    if (success) resolve({ success: true, files: fileList })
    else reject(new Error(error || '目录访问失败'))
    return
  }
  switch (type) {
    case 'sftp-list-response':
      if (success) files.value = fileList
      else { let errorMsg = error; if (error && (error.includes('Channel open failure') || error.includes('无法打开 SFTP 通道'))) errorMsg = 'SFTP 通道打开失败。可能原因：SSH 服务器限制了并发会话数（MaxSessions=1）。请尝试修改服务器配置（如 /etc/ssh/sshd_config 中增加 MaxSessions 2），或使用其他 SSH 客户端单独连接。'; ElMessage.error('加载文件列表失败: ' + errorMsg) }
      break
    case 'sftp-delete-response': if (success) { ElMessage.success('删除成功'); refreshFileList() } else ElMessage.error('删除失败'); break
    case 'sftp-mkdir-response': if (success) { ElMessage.success('创建成功'); refreshFileList() } else ElMessage.error('创建失败'); break
    case 'sftp-chmod-response': if (success) { ElMessage.success('权限修改成功'); refreshFileList() } else ElMessage.error('权限修改失败: ' + (error || '未知错误')); break
    case 'sftp-rename-response': if (success) { ElMessage.success('重命名成功'); refreshFileList() } else ElMessage.error('重命名失败: ' + (error || '未知错误')); break
  }
}
watch(() => props.ws, (newWs, oldWs) => {
  if (oldWs && messageHandler) oldWs.removeEventListener('message', messageHandler)
  if (newWs) { messageHandler = handleWebSocketMessage; newWs.addEventListener('message', messageHandler) }
}, { immediate: true })

const fetchCurrentDirectory = () => {
  if (props.sshReady && props.ws && props.ws.readyState === WebSocket.OPEN) {
    props.ws.send(JSON.stringify({ type: 'sftp-pwd', sessionId: props.sessionId }))
  }
}

watch(() => props.sshReady, (ready) => {
  if (ready && currentPath.value === null) {
    if (props.initialPath && props.initialPath.trim() !== '') {
      navigateToSafePath(props.initialPath)
    } else {
      fetchCurrentDirectory()
    }
  }
})

const onOpenTerminalClick = () => { if (props.onOpenTerminal) props.onOpenTerminal(currentPath.value) }

// 行号相关逻辑
const viewLineNumbersRef = ref<HTMLElement>()
const editLineNumbersRef = ref<HTMLElement>()

const viewLineNumbers = computed(() => {
  const lines = (viewContent.value || '').split('\n')
  return lines.map((_, i) => i + 1).join('\n')
})

const editLineNumbers = computed(() => {
  const lines = (editContent.value || '').split('\n')
  return lines.map((_, i) => i + 1).join('\n')
})

const syncEditLineNumbersScroll = () => {
  if (editorTextarea.value && editLineNumbersRef.value) {
    editLineNumbersRef.value.scrollTop = editorTextarea.value.scrollTop
  }
}

// 收藏功能
const favoritesDropdownRef = ref<any>(null)
interface Favorite { id: string; name: string; path: string }
const privateFavorites = ref<{ id: string; name: string; path: string }[]>([])
const publicFavorites = ref<{ id: string; name: string; path: string }[]>([])
const allFavorites = computed(() => [...privateFavorites.value.map(f => ({ ...f, isPublic: false })), ...publicFavorites.value.map(f => ({ ...f, isPublic: true }))])
const favoriteDialogVisible = ref(false); const favoriteForm = ref({ name: '', path: '', isPublic: false }); const isEditingFavorite = ref(false); const editingFavoriteId = ref<string | null>(null); const editingIsPublic = ref(false)
watch(() => props.connection?.favorites, (newVal) => { privateFavorites.value = newVal || [] }, { immediate: true, deep: true })
const loadPublicFavorites = async () => { try { const config = await getConfig(); publicFavorites.value = config?.sftp_public_favorites || [] } catch (e) { console.error('加载公用收藏失败', e) } }
const savePublicFavorites = async (list: { id: string; name: string; path: string }[]) => { await saveConfigKey('sftp_public_favorites', list); window.dispatchEvent(new CustomEvent('public-favorites-updated')) }
const savePrivateFavorites = async (list: { id: string; name: string; path: string }[]) => { await connectionStore.updateConnection(props.connection.id, { favorites: list }) }
const openFavoriteDialog = () => { if (currentPath.value === null) return; isEditingFavorite.value = false; editingFavoriteId.value = null; favoriteForm.value = { name: '', path: currentPath.value, isPublic: false }; favoriteDialogVisible.value = true }
const editFavorite = (fav: Favorite) => { isEditingFavorite.value = true; editingFavoriteId.value = fav.id; editingIsPublic.value = fav.isPublic; favoriteForm.value = { name: fav.name, path: fav.path, isPublic: fav.isPublic }; favoriteDialogVisible.value = true }
const deleteFavorite = (fav: Favorite) => { ElMessageBox.confirm(`确定删除收藏“${fav.name}”吗？`, '提示', { type: 'warning' }).then(async () => { if (fav.isPublic) { const updated = publicFavorites.value.filter(f => f.id !== fav.id); publicFavorites.value = updated; await savePublicFavorites(updated) } else { const updated = privateFavorites.value.filter(f => f.id !== fav.id); privateFavorites.value = updated; await savePrivateFavorites(updated) } ElMessage.success('已删除') }).catch(() => {}) }
const saveFavorite = async () => {
  if (!favoriteForm.value.name.trim() || !favoriteForm.value.path.trim()) { ElMessage.warning('名称和路径不能为空'); return }
  const newIsPublic = favoriteForm.value.isPublic
  if (isEditingFavorite.value && editingFavoriteId.value) {
    const oldIsPublic = editingIsPublic.value
    if (oldIsPublic === newIsPublic) {
      if (newIsPublic) { const updated = publicFavorites.value.map(f => f.id === editingFavoriteId.value ? { id: f.id, name: favoriteForm.value.name, path: favoriteForm.value.path } : f); publicFavorites.value = updated; await savePublicFavorites(updated) }
      else { const updated = privateFavorites.value.map(f => f.id === editingFavoriteId.value ? { id: f.id, name: favoriteForm.value.name, path: favoriteForm.value.path } : f); privateFavorites.value = updated; await savePrivateFavorites(updated) }
    } else {
      const newItem = { id: editingFavoriteId.value, name: favoriteForm.value.name, path: favoriteForm.value.path }
      if (oldIsPublic) { publicFavorites.value = publicFavorites.value.filter(f => f.id !== editingFavoriteId.value); await savePublicFavorites(publicFavorites.value) }
      else { privateFavorites.value = privateFavorites.value.filter(f => f.id !== editingFavoriteId.value); await savePrivateFavorites(privateFavorites.value) }
      if (newIsPublic) { publicFavorites.value.push(newItem); await savePublicFavorites(publicFavorites.value) }
      else { privateFavorites.value.push(newItem); await savePrivateFavorites(privateFavorites.value) }
    }
    ElMessage.success('已更新')
  } else {
    const newItem = { id: uuidv4(), name: favoriteForm.value.name, path: favoriteForm.value.path }
    if (newIsPublic) { publicFavorites.value.push(newItem); await savePublicFavorites(publicFavorites.value) }
    else { privateFavorites.value.push(newItem); await savePrivateFavorites(privateFavorites.value) }
    ElMessage.success('已收藏')
  }
  favoriteDialogVisible.value = false
}
const goToFavoritePath = (path: string) => { if (currentPath.value !== null) { navigateToSafePath(path); if (favoritesDropdownRef.value) (favoritesDropdownRef.value as any).handleClose?.() } }
const onPublicFavoritesUpdated = () => { loadPublicFavorites() }

function getFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['jpg','jpeg','png','gif','bmp','webp','svg','ico'].includes(ext)) return 'Picture'
  if (['mp4','mkv','avi','mov','wmv','flv','webm','mpeg'].includes(ext)) return 'VideoCamera'
  if (['mp3','wav','flac','aac','ogg','m4a'].includes(ext)) return 'Headphone'
  if (['zip','rar','7z','tar','gz','bz2','xz','z'].includes(ext)) return 'Collection'
  if (['js','ts','jsx','tsx','vue','html','htm','css','scss','sass','less','py','java','c','cpp','h','hpp','go','rs','php','rb','swift','kt','sql','sh','bash','zsh','ps1','bat','cmd'].includes(ext)) return 'Code'
  if (['txt','md','markdown','log','ini','cfg','conf','yaml','yml','json','xml','csv'].includes(ext)) return 'Edit'
  if (ext === 'pdf') return 'Files'
  if (['doc','docx'].includes(ext)) return 'Document'
  if (['xls','xlsx','xlsm'].includes(ext)) return 'Grid'
  if (['ppt','pptx'].includes(ext)) return 'Presentation'
  if (['exe','msi','app','deb','rpm','sh','bin','run'].includes(ext)) return 'Monitor'
  if (['ttf','otf','woff','woff2','eot'].includes(ext)) return 'Font'
  return 'Document'
}

onMounted(async () => {
  await loadColWidths(); await loadSortState(); await loadPublicFavorites()
  if (props.sshReady && currentPath.value === null) {
    if (props.initialPath && props.initialPath.trim() !== '') {
      navigateToSafePath(props.initialPath)
    } else {
      fetchCurrentDirectory()
    }
  }
  document.addEventListener('click', closeContextMenu)
  window.addEventListener('public-favorites-updated', onPublicFavoritesUpdated)
})

onUnmounted(() => {
  if (props.ws && messageHandler) props.ws.removeEventListener('message', messageHandler)
  document.removeEventListener('click', closeContextMenu)
  window.removeEventListener('public-favorites-updated', onPublicFavoritesUpdated)
})
</script>

<style scoped>
/* ========== 通用行号样式 ========== */
.line-numbers {
  background-color: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  padding: 10px 8px;
  text-align: right;
  user-select: none;
  white-space: pre;
  border-right: 1px solid var(--el-border-color-lighter);
  line-height: inherit;
  box-shadow: none;
}

/* ========== 编辑模式（编辑 & 查看共用） ========== */
.editor-wrapper.edit-mode {
  position: relative;
  height: 60vh;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.editor-wrapper.edit-mode .line-numbers {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 60px;
  padding: 10px 8px;
  background-color: var(--el-fill-color-light);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.editor-wrapper.edit-mode .line-numbers::-webkit-scrollbar {
  display: none;
}

.editor-wrapper.edit-mode .code-editor {
  margin-left: 60px;
  width: calc(100% - 60px);
  height: 100%;
  border: none;
  outline: none;
  resize: vertical;
  padding: 10px;
  font-family: monospace;
  font-size: 14px;
  line-height: inherit;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

/* 查看模式专用：只读 pre，隐藏滚动条 */
.editor-wrapper.edit-mode .code-editor.view-only {
  resize: none;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-y: auto;
  cursor: default;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.editor-wrapper.edit-mode .code-editor.view-only::-webkit-scrollbar {
  display: none;
}

/* ========== 原有样式（保留不变） ========== */
.custom-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  flex: 1;
}
.breadcrumb-item {
  cursor: pointer;
  margin: 0 4px;
  font-weight: bold;
  color: var(--el-text-color-primary);
  font-size: 20px;
}
.breadcrumb-link:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}
.clickable-icon.folder-icon {
  color: #e6a23c !important;
}
.file-item .folder-icon {
  color: #e6a23c;
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
  align-items: center;
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
.path-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: 20px;
}
.loading-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
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
  font-weight: bold;
  font-size: 18px;
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
  font-size: 20px;
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
  background: var(--el-color-primary-light-7);
  border-left: 3px solid var(--el-color-primary);
  color: var(--el-text-color-primary);
}
.file-item.is-folder .clickable-name {
  font-weight: bold;
}
.parent-dir {
  opacity: 0.8;
}
.parent-dir:hover {
  background: var(--el-fill-color-light);
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
  font-size: 20px;
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
  color: var(--el-text-color-primary);
}
.context-menu div {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 20px;
}
.context-menu div:hover {
  background: var(--el-fill-color-light);
}
.favorite-item {
  padding: 0 !important;
}
.favorite-row {
  display: flex;
  align-items: center;
  padding: 4px 0px;
  width: 100%;
  min-width: 180px;
  cursor: default;
}
.favorite-name {
  flex: 1;
  cursor: pointer;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.favorite-name:hover {
  color: var(--el-color-primary);
}
.favorite-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-icon {
  font-size: 14px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.action-icon:hover {
  color: var(--el-color-primary);
}
.form-tip {
  font-size: 20px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.el-button .el-icon {
  margin-right: 4px;
}
</style>