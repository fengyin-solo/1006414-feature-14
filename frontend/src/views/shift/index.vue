<template>
  <section class="page" data-module="shift">
    <header class="page-head">
      <div>
        <h2>值班交接班管理</h2>
        <p class="page-desc">维护交接班记录，围绕交接编号、值班班组、班次、交班人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记交接班记录</button>
        <button class="btn" type="button" @click="exportRows">导出值班交接班清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section class="handover-section">
      <div class="handover-head">
        <h3 class="handover-title">炉渣外运交接清单</h3>
        <span class="handover-desc">状态随炉渣处理记录实时同步，交接时逐项核对车号与批次</span>
      </div>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">待外运批次</span>
          <strong class="stat-value">{{ handover.pendingCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">外运中（在途）</span>
          <strong class="stat-value">{{ handover.movingCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已交付批次</span>
          <strong class="stat-value">{{ handover.deliveredCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当日已交付炉渣（吨）</span>
          <strong class="stat-value">{{ handover.deliveredToday.toFixed(1) }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">热灼减率超标批次</span>
          <strong class="stat-value stat-warn">{{ handover.overLimitCount }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>处理编号</th>
            <th>炉渣产量（吨）</th>
            <th>热灼减率结论</th>
            <th>外运单位</th>
            <th>运输车号</th>
            <th>外运日期</th>
            <th>外运状态</th>
            <th>交接说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in handover.items" :key="item.id" :class="{ 'row-overlimit': item.verdict === '不合格' }">
            <td>{{ item.code }}</td>
            <td>{{ item.production }}</td>
            <td>
              {{ item.verdict }}
              <span v-if="item.verdict === '不合格'" class="tag tag-warn">超标</span>
            </td>
            <td>{{ item.carrier || '—' }}</td>
            <td>{{ item.plate || '待排车' }}</td>
            <td>{{ item.outDate || '—' }}</td>
            <td>{{ item.status }}</td>
            <td>{{ handoverNote(item) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="handover-section">
      <div class="handover-head">
        <h3 class="handover-title">交接班记录</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无值班交接班数据，可先登记交接班记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条值班交接班记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { slagHandover } from '@/api/slag-service'
import type { EntryRow, SlagHandoverItem, SlagHandoverResult } from '@/data/types'

const meta = moduleMeta('shift')
const columns = ["交接编号", "值班班组", "班次", "交班人员", "接班人员", "交接事项", "交接时间", "交接状态"]
const actions = ["发起交接", "确认交接", "登记遗留"]
const statuses = ["待交接", "交接中", "已交接", "有遗留"]
const stats = [{"label": "待交接班次", "value": 0}, {"label": "已交接班次", "value": 0}, {"label": "有遗留事项", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const emptyHandover = (): SlagHandoverResult => ({
  items: [],
  pendingCount: 0,
  movingCount: 0,
  deliveredCount: 0,
  overLimitCount: 0,
  deliveredToday: 0,
})
const handover = ref<SlagHandoverResult>(emptyHandover())

// 交接说明：按外运状态交代本班要跟进的事项，超标批次无论什么状态都点名。
function handoverNote(item: SlagHandoverItem): string {
  const over = item.verdict === '不合格' ? '热灼减率超标，需向接班人口头说明去向；' : ''
  switch (item.status) {
    case '待外运':
      return `${over}尚未排车，本班继续落实承运单位与车号`
    case '外运中':
      return `${over}在途车辆 ${item.plate || '车号缺失'}，跟进到场签收`
    case '已交付':
      return over ? '已交付，超标批次资料留档备查' : '已完成交付，无遗留'
    case '数据异常':
      return `${over}数据异常，暂缓外运并核实记录`
    default:
      return over
  }
}
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '交接班记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    handover.value = slagHandover()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '值班交接班列表读取失败'
  }
}

onMounted(reload)
</script>
