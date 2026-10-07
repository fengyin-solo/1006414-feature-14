<template>
  <section class="page" data-module="slag">
    <header class="page-head">
      <div>
        <h2>炉渣处理管理</h2>
        <p class="page-desc">按炉渣产量、外运单位与运输车号定位待运批次，安排外运并跟踪交付；热灼减率超标批次单独标出。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记炉渣处理记录</button>
        <button class="btn" type="button" @click="exportRows">导出炉渣处理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-warn': item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-warn">热灼减率超标：{{ overLimitTotal }} 批</span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>炉渣产量（吨）</span>
        <input v-model="draft.production" placeholder="如 28 或 28.6" />
      </label>
      <label class="filter-item">
        <span>外运单位</span>
        <input v-model="draft.carrier" placeholder="如 顺通" />
      </label>
      <label class="filter-item">
        <span>运输车号</span>
        <input v-model="draft.plate" placeholder="如 冀A12345" />
      </label>
      <label class="filter-item">
        <span>外运状态</span>
        <select v-model="draft.status">
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>热灼减率结论</span>
        <select v-model="draft.verdict">
          <option value="">全部结论</option>
          <option value="合格">合格</option>
          <option value="不合格">不合格（超标）</option>
        </select>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-overlimit': verdictOf(row) === '不合格' }">
          <td>{{ row['处理编号'] ?? '—' }}</td>
          <td>{{ row['炉渣产量'] ?? '—' }}</td>
          <td>
            <span>{{ row['热灼减率'] ?? '—' }}</span>
            <span v-if="verdictOf(row) === '不合格'" class="tag tag-warn">超标</span>
          </td>
          <td>
            <span :class="{ 'text-warn': verdictOf(row) === '不合格' }">{{ verdictOf(row) }}</span>
          </td>
          <td>{{ row['外运单位'] || '—' }}</td>
          <td>{{ row['外运日期'] || '—' }}</td>
          <td>{{ row['运输车号'] || '待排车' }}</td>
          <td>{{ row['记录人员'] ?? '—' }}</td>
          <td>{{ row['处理状态'] ?? row.status }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待外运'"
              class="link"
              type="button"
              @click="openArrange(row)"
            >
              安排外运
            </button>
            <button
              v-if="String(row.status) === '外运中'"
              class="link"
              type="button"
              @click="deliver(row)"
            >
              确认交付
            </button>
            <button
              v-if="String(row.status) !== '数据异常'"
              class="link link-danger"
              type="button"
              @click="markAbnormal(row)"
            >
              标记异常
            </button>
            <span v-if="String(row.status) === '已交付'" class="muted-text">已完结</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">当前条件下没有炉渣处理记录，可调整查询条件或重置后再看</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pager-foot">
      <div class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <span v-if="total > 0">本页 {{ rangeStart }}–{{ rangeEnd }} 条，共 {{ total }} 条（每页 {{ size }} 条）</span>
        <span v-else>共 0 条</span>
      </div>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="arrangeTarget" class="modal-mask" @click.self="closeArrange">
      <div class="modal-card">
        <h3 class="modal-title">安排炉渣外运 · {{ String(arrangeTarget['处理编号'] ?? '') }}</h3>
        <p class="modal-sub">
          炉渣产量 {{ String(arrangeTarget['炉渣产量'] ?? '—') }} 吨，
          热灼减率 {{ String(arrangeTarget['热灼减率'] ?? '—') }}
          <span v-if="verdictOf(arrangeTarget) === '不合格'" class="text-warn">（超标，可安排但请在交接时重点说明）</span>
        </p>
        <form class="modal-form" @submit.prevent="submitArrange">
          <label class="filter-item">
            <span>外运单位</span>
            <input v-model="arrangeForm.carrier" placeholder="如 顺通渣土运输公司" />
          </label>
          <label class="filter-item">
            <span>运输车号</span>
            <input v-model="arrangeForm.plate" placeholder="普通车牌 冀A12345 / 新能源 冀AD12345" />
          </label>
          <label class="filter-item">
            <span>外运日期</span>
            <input v-model="arrangeForm.outDate" type="date" />
          </label>
          <p v-if="arrangeError" class="error-text">{{ arrangeError }}</p>
          <div class="modal-actions">
            <button class="btn primary" type="submit">确认安排</button>
            <button class="btn ghost" type="button" @click="closeArrange">取消</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  arrangeSlag,
  confirmSlagDelivery,
  markSlagAbnormal,
  querySlag,
  SLAG_PAGE_SIZE,
  SLAG_STATUS_PENDING,
} from '@/api/slag-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow, SlagQuery } from '@/data/types'

const meta = moduleMeta('slag')
const columns = ["处理编号", "炉渣产量", "热灼减率", "热灼减率判定", "外运单位", "外运日期", "运输车号", "记录人员", "处理状态"]
const statuses = ["待外运", "外运中", "已交付", "数据异常"]
const statusOptions = [
  { value: '', label: '全部状态' },
  { value: '待外运', label: '待外运（未排车）' },
  { value: '外运中', label: '外运中' },
  { value: '已交付', label: '已交付' },
  { value: '数据异常', label: '数据异常' },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = SLAG_PAGE_SIZE
const errorMessage = ref('')

// 表单条件与已生效条件分开：翻页始终按上一次「查询」确认的条件取数，输入到一半不会串页。
const emptyDraft = (): SlagQuery => ({ production: '', carrier: '', plate: '', status: SLAG_STATUS_PENDING, verdict: '' })
const draft = ref<SlagQuery>(emptyDraft())
const applied = ref<SlagQuery>(emptyDraft())

const arrangeTarget = ref<EntryRow | null>(null)
const arrangeForm = ref({ carrier: '', plate: '', outDate: '' })
const arrangeError = ref('')

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size)))
const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * size + 1))
const rangeEnd = computed(() => Math.min(page.value * size, total.value))

const allSlag = ref<EntryRow[]>([])

function verdictOf(row: EntryRow): string {
  return String(row['热灼减率判定'] ?? '')
}

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allSlag.value.filter((row) => String(row.status) === status).length,
  })),
)

const overLimitTotal = computed(() => allSlag.value.filter((row) => verdictOf(row) === '不合格').length)

const stats = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  const deliveredToday = allSlag.value
    .filter((row) => String(row.status) === '已交付' && String(row['外运日期'] ?? '') === today)
    .reduce((sum, row) => sum + (Number.parseFloat(String(row['炉渣产量'] ?? '')) || 0), 0)
  return [
    { label: '待外运炉渣（批）', value: statusSummary.value.find((item) => item.status === '待外运')?.count ?? 0, warn: false },
    { label: '外运中炉渣（批）', value: statusSummary.value.find((item) => item.status === '外运中')?.count ?? 0, warn: false },
    { label: '当日外运量（吨）', value: deliveredToday.toFixed(1), warn: false },
    { label: '热灼减率超标（批）', value: overLimitTotal.value, warn: true },
  ]
})

function reload() {
  errorMessage.value = ''
  try {
    // 用足够大的页取全量做统计与状态小结，列表本身仍按分页切片返回。
    allSlag.value = querySlag({}, 1, Number.MAX_SAFE_INTEGER).items
    const payload = querySlag(applied.value, page.value, size)
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '炉渣处理列表读取失败'
  }
}

function applyFilters() {
  applied.value = { ...draft.value }
  page.value = 1
  reload()
}

function resetFilters() {
  draft.value = emptyDraft()
  applied.value = emptyDraft()
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '炉渣处理记录登记入口尚未接入审批流'
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

function openArrange(row: EntryRow) {
  arrangeTarget.value = row
  arrangeError.value = ''
  arrangeForm.value = {
    carrier: String(row['外运单位'] ?? ''),
    plate: '',
    outDate: todayText(),
  }
}

function closeArrange() {
  arrangeTarget.value = null
  arrangeError.value = ''
}

function submitArrange() {
  if (!arrangeTarget.value) {
    return
  }
  const result = arrangeSlag(Number(arrangeTarget.value.id), { ...arrangeForm.value })
  if (!result.ok) {
    // 写错车号时把交代直接留在弹窗里，而不是空白带过。
    arrangeError.value = result.message
    return
  }
  closeArrange()
  errorMessage.value = result.message
  reload()
}

function deliver(row: EntryRow) {
  const result = confirmSlagDelivery(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function markAbnormal(row: EntryRow) {
  const result = markSlagAbnormal(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
