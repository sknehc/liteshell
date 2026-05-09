import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface SystemStats {
    cpu: number
    mem: number
    updatedAt: number
}

export const useStatsStore = defineStore('stats', () => {
    // 按 sessionId 存储统计数据
    const statsMap = ref<Map<string, SystemStats>>(new Map())

    function updateStats(sessionId: string, cpu: number, mem: number) {
        statsMap.value.set(sessionId, {
            cpu: Math.round(cpu * 10) / 10,
            mem: Math.round(mem * 10) / 10,
            updatedAt: Date.now()
        })
    }

    function clearStats(sessionId: string) {
        statsMap.value.delete(sessionId)
    }

    function getStats(sessionId: string): SystemStats | null {
        return statsMap.value.get(sessionId) || null
    }

    return {
        statsMap,
        updateStats,
        clearStats,
        getStats
    }
})