import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getConfig, saveConfig } from '../api/config'

export interface Connection {
  id: string
  type: string
  name: string
  group: string
  host: string
  port: number
  username: string
  authType: string
  password?: string
  privateKey?: string
}

export interface Group {
  id: string
  name: string
  connections: Connection[]
}

export const useConnectionStore = defineStore('connection', () => {
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])

  async function loadConfig() {
    const config = await getConfig()
    connections.value = config?.connections || []
    groups.value = config?.groups || []

    // 保底：确保 groups 中永远有“默认分组”
    if (groups.value.length === 0) {
      groups.value.push({ id: Date.now().toString(), name: '默认分组', connections: [] })
    } else if (!groups.value.some(g => g && g.name === '默认分组')) {
      groups.value.push({ id: Date.now().toString(), name: '默认分组', connections: [] })
    }

    // 过滤掉无效的组（undefined 或 null）
    groups.value = groups.value.filter(g => g != null)

    rebuildGroupConnections()
  }

  function rebuildGroupConnections() {
    groups.value.forEach(g => g.connections = [])
    connections.value.forEach(conn => {
      let targetGroup = groups.value.find(g => g.name === conn.group)
      if (!targetGroup) {
        targetGroup = { id: Date.now().toString(), name: conn.group, connections: [] }
        groups.value.push(targetGroup)
      }
      targetGroup.connections.push(conn)
    })
  }

  async function persist() {
    const config = await getConfig()
    config.connections = connections.value
    config.groups = groups.value.map(g => ({ id: g.id, name: g.name }))
    await saveConfig(config)
  }

  async function addConnection(conn: Connection) {
    connections.value.push(conn)
    await persist()
    rebuildGroupConnections()
  }

  async function updateConnection(id: string, data: Partial<Connection>) {
    const index = connections.value.findIndex(c => c.id === id)
    if (index !== -1) {
      connections.value[index] = { ...connections.value[index], ...data }
      await persist()
      rebuildGroupConnections()
    }
  }

  async function deleteConnection(id: string) {
    const index = connections.value.findIndex(c => c.id === id)
    if (index !== -1) {
      connections.value.splice(index, 1)
      await persist()
      rebuildGroupConnections()
    }
  }

  async function addGroup(groupName: string) {
    if (groups.value.some(g => g.name === groupName)) return
    const newGroup = { id: Date.now().toString(), name: groupName, connections: [] }
    groups.value.push(newGroup)
    await persist()
    rebuildGroupConnections()
  }

  async function deleteGroup(groupName: string) {
    if (groupName === '默认分组') return
    connections.value = connections.value.filter(c => c.group !== groupName)
    const groupIndex = groups.value.findIndex(g => g.name === groupName)
    if (groupIndex !== -1) groups.value.splice(groupIndex, 1)
    await persist()
    rebuildGroupConnections()
  }

  return {
    connections,
    groups,
    loadConfig,
    addConnection,
    updateConnection,
    deleteConnection,
    addGroup,
    deleteGroup
  }
})