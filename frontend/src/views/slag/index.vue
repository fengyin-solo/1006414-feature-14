<template>
  <section class="page" data-module="slag">
    <header class="page-head">
      <div>
        <h2>炉渣处理管理</h2>
        <p class="page-desc">按炉渣产量、外运单位、运输车号定位待外运批次，热灼减率超标批次单独标出，外运状态同步到值班交接清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? '收起登记' : '登记炉渣处理记录' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出炉渣处理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form v-if="showCreate" class="create-panel" @submit.prevent="submitCreate">
      <h3 class="panel-title">登记炉渣处理记录</h3>
      <div class="create-grid">
        <label v-for="field in createFields" :key="field.key" class="filter-item">
          <span>{{ field.label }}</span>
          <input v-model="createForm[field.key]" :placeholder="field.placeholder" />
        </label>
      </div>
      <div class="create-actions">
        <button class="btn primary" type="submit">提交登记</button>
        <span class="panel-hint">同一条处理记录只允许登记一条；热灼减率限值 {{ loiLimit }}%，登记时判定并留存结论。</span>
      </div>
    </form>

    <section v-if="outOfRange.length" class="out-range-panel">
      <h3 class="panel-title">热灼减率超标批次（&gt; {{ loiLimit }}%），共 {{ outOfRange.length }} 批待处理</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>处理编号</th>
            <th>炉渣产量</th>
            <th>热灼减率</th>
            <th>外运单位</th>
            <th>运输车号</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in outOfRange" :key="String(row.id)">
            <td>{{ row['处理编号'] }}</td>
            <td>{{ row['炉渣产量'] }}</td>
            <td><span class="badge danger">{{ row['热灼减率'] }}</span></td>
            <td>{{ row['外运单位'] }}</td>
            <td>{{ row['运输车号'] }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="row.status === '待外运'"
                class="link"
                type="button"
                @click="runAction('安排外运', row)"
              >
                安排外运
              </button>
              <span v-else class="panel-hint">已在流转中</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in locateFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="draft[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-out-range': isOutOfRange(row) }">
          <td v-for="column in columns" :key="column">
            <span v-if="column === conclusionField && isOutOfRange(row)" class="badge danger">
              {{ row[column] }}
            </span>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
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
          <td :colspan="columns.length + 2" class="empty-state">{{ locateMessage || '暂无待外运的炉渣记录' }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条待外运记录 · 第 {{ page }} / {{ pageCount }} 页</span>
      <div class="pager">
        <label class="pager-size">
          每页
          <select v-model.number="pageSize" @change="applyFilters">
            <option v-for="option in pageSizeOptions" :key="option" :value="option">{{ option }}</option>
          </select>
          条
        </label>
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button class="btn ghost" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </div>
    </footer>
    <p v-if="message" class="status-message">{{ message }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  CONCLUSION_FIELD,
  LOI_LIMIT_PERCENT,
  LOI_OUT,
  createSlagEntry,
  listOutOfRangeSlag,
  locatePendingSlag,
  slagHandoverSummary,
  type SlagEntryInput,
  type SlagLocateQuery,
} from '@/api/slag-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('slag')
const columns = ["处理编号", "炉渣产量", "热灼减率", "热灼减率结论", "外运单位", "外运日期", "运输车号", "记录人员"]
const actions = ["安排外运", "确认交付", "标记异常"]
const locateFields = ["炉渣产量", "外运单位", "运输车号"] as const
const conclusionField = CONCLUSION_FIELD
const loiLimit = LOI_LIMIT_PERCENT
const pageSizeOptions = [5, 10, 20]

const createFields: { key: keyof SlagEntryInput; label: string; placeholder: string }[] = [
  { key: '处理编号', label: '处理编号', placeholder: '如 SLAG-0011' },
  { key: '炉渣产量', label: '炉渣产量', placeholder: '如 12.5吨' },
  { key: '热灼减率', label: '热灼减率（%）', placeholder: '0~100 之间的数值' },
  { key: '外运单位', label: '外运单位', placeholder: '如 绿源建材' },
  { key: '运输车号', label: '运输车号', placeholder: '如 浙A1D235' },
  { key: '记录人员', label: '记录人员', placeholder: '当班记录人' },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(5)
const outOfRange = ref<EntryRow[]>([])
const errorMessage = ref('')
const message = ref('')
const locateMessage = ref('')
const showCreate = ref(false)
// 草稿条件随输入变化，已应用条件在点查询时才更新：翻页始终按同一份条件取数。
const draft = ref<Record<string, string>>({})
const applied = ref<SlagLocateQuery>({})
const createForm = ref<SlagEntryInput>({
  处理编号: '',
  炉渣产量: '',
  热灼减率: '',
  外运单位: '',
  运输车号: '',
  记录人员: '',
})

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const stats = ref([
  { label: '待外运炉渣', value: 0 },
  { label: '外运中炉渣', value: 0 },
  { label: '热灼减率超标批次', value: 0 },
])

function isOutOfRange(row: EntryRow): boolean {
  return row[CONCLUSION_FIELD] === LOI_OUT
}

function applyFilters() {
  applied.value = { ...draft.value }
  page.value = 1
  reload()
}

function resetFilters() {
  draft.value = {}
  applyFilters()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitCreate() {
  errorMessage.value = ''
  message.value = ''
  const result = createSlagEntry(createForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  createForm.value = { 处理编号: '', 炉渣产量: '', 热灼减率: '', 外运单位: '', 运输车号: '', 记录人员: '' }
  showCreate.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  message.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = locatePendingSlag(applied.value, page.value, pageSize.value)
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    locateMessage.value = payload.message
    outOfRange.value = listOutOfRangeSlag()
    const summary = slagHandoverSummary()
    const countOf = (status: string) =>
      summary.statusCounts.find((item) => item.status === status)?.count ?? 0
    stats.value = [
      { label: '待外运炉渣', value: countOf('待外运') },
      { label: '外运中炉渣', value: countOf('外运中') },
      { label: '热灼减率超标批次', value: summary.outOfRangePending },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '炉渣处理列表读取失败'
  }
}

onMounted(() => {
  reload()
})
</script>
