import { moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  PageResult,
  SlagArrange,
  SlagHandoverResult,
  SlagQuery,
} from '@/data/types'

// 热灼减率限值：按生活垃圾焚烧污染控制标准（GB 18485）限值 5%，超出即单独标出。
export const SLAG_LOI_LIMIT_PERCENT = 5
export const SLAG_VERDICT_PASS = '合格'
export const SLAG_VERDICT_FAIL = '不合格'

export const SLAG_STATUS_PENDING = '待外运'
export const SLAG_STATUS_MOVING = '外运中'
export const SLAG_STATUS_DELIVERED = '已交付'
export const SLAG_STATUS_ABNORMAL = '数据异常'

export const SLAG_PAGE_SIZE = 5

const KEY = 'slag'
const FIELDS = {
  code: '处理编号',
  production: '炉渣产量',
  loi: '热灼减率',
  verdict: '热灼减率判定',
  carrier: '外运单位',
  outDate: '外运日期',
  plate: '运输车号',
  operator: '记录人员',
} as const

// 车牌正则：普通车牌「省份汉字+字母+5位字母数字」，新能源车牌「省份汉字+字母+6位字母数字」。
const PLATE_PATTERN = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][0-9A-Z]{5,6}$/

function slagRows(): EntryRow[] {
  return listRows(KEY)
}

// 热灼减率取百分比数值：「5.2%」「5.2」都能读；读不出来返回 null，交给结论兜底。
export function parsePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = String(value ?? '').trim()
  if (!text) {
    return null
  }
  const num = Number.parseFloat(text.replace('%', ''))
  return Number.isFinite(num) ? num : null
}

// 热灼减率结论只在记录上没有结论时，按当时的实测值补一次并落库；
// 已经写下的结论（哪怕限值后来调整）不再重算，历史批次按当时结论保留。
export function evaluateLoi(loi: unknown): string {
  const percent = parsePercent(loi)
  if (percent === null) {
    return SLAG_VERDICT_PASS
  }
  return percent > SLAG_LOI_LIMIT_PERCENT ? SLAG_VERDICT_FAIL : SLAG_VERDICT_PASS
}

function ensureVerdicts(rows: EntryRow[]): EntryRow[] {
  let changed = false
  const next = rows.map((row) => {
    if (String(row[FIELDS.verdict] ?? '').trim() !== '') {
      return row
    }
    changed = true
    return { ...row, [FIELDS.verdict]: evaluateLoi(row[FIELDS.loi]) }
  })
  if (changed) {
    saveRows(KEY, next)
  }
  return changed ? next : rows
}

export function isOverLimit(row: EntryRow): boolean {
  return String(row[FIELDS.verdict] ?? '') === SLAG_VERDICT_FAIL
}

export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase()
}

// 写错的车号要给一句明确交代：空、长度不对、省份字或编号不对，分别提示。
export function validatePlate(raw: string): string {
  const plate = normalizePlate(raw)
  if (!plate) {
    return '运输车号不能为空，请按车牌填写（如冀A12345、新能源冀AD12345）'
  }
  if (plate.length !== 7 && plate.length !== 8) {
    return `运输车号「${plate}」位数不对：普通车牌7位、新能源车牌8位，请核对后重填`
  }
  if (!PLATE_PATTERN.test(plate)) {
    return `运输车号「${plate}」格式不正确：应为省份汉字+字母+5位编号（新能源6位），如冀A12345`
  }
  return ''
}

function includes(row: EntryRow, field: string, keyword: string): boolean {
  return String(row[field] ?? '').includes(keyword)
}

export function querySlag(query: SlagQuery = {}, page = 1, size = SLAG_PAGE_SIZE): PageResult {
  const all = ensureVerdicts(slagRows()).slice().sort((a, b) => Number(a.id) - Number(b.id))

  const production = query.production?.trim() ?? ''
  const carrier = query.carrier?.trim() ?? ''
  const plate = normalizePlate(query.plate ?? '')
  const status = query.status?.trim() ?? ''
  const verdict = query.verdict?.trim() ?? ''

  const matched = all.filter((row) => {
    if (production && !includes(row, FIELDS.production, production)) return false
    if (carrier && !includes(row, FIELDS.carrier, carrier)) return false
    if (plate && !includes(row, FIELDS.plate, plate)) return false
    if (status && String(row.status) !== status) return false
    if (verdict && String(row[FIELDS.verdict] ?? '') !== verdict) return false
    return true
  })

  const total = matched.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (safePage - 1) * size
  // 固定排序 + 稳定切片：翻页沿用同一份条件，页与页之间不重复、不漏条，条数对得上。
  const items = matched.slice(start, start + size)

  return { items, total, page: safePage, size }
}

function persist(rows: EntryRow[], updated: EntryRow, id: number): EntryRow[] {
  const next = rows.map((row) => (Number(row.id) === id ? updated : row))
  saveRows(KEY, next)
  return next
}

// 安排外运：只有「待外运」能排；同一条处理记录只允许一条外运安排。
export function arrangeSlag(id: number, payload: SlagArrange): ActionResult {
  moduleMeta(KEY) // 确认模块已登记，未登记直接抛错
  const carrier = payload.carrier.trim()
  if (!carrier) {
    return { ok: false, message: '外运单位不能为空，请填写承运单位后再安排外运' }
  }
  const plateError = validatePlate(payload.plate)
  if (plateError) {
    return { ok: false, message: plateError }
  }
  const plate = normalizePlate(payload.plate)
  const rows = slagRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  const status = String(row.status)
  if (status === SLAG_STATUS_MOVING) {
    return { ok: false, message: `炉渣批次 ${row[FIELDS.code]} 已安排车号 ${row[FIELDS.plate]}，同一条处理记录只能安排一次外运` }
  }
  if (status === SLAG_STATUS_DELIVERED) {
    return { ok: false, message: `炉渣批次 ${row[FIELDS.code]} 已交付，不能重复安排外运` }
  }
  if (status === SLAG_STATUS_ABNORMAL) {
    return { ok: false, message: `炉渣批次 ${row[FIELDS.code]} 已标记数据异常，请先核实后再安排外运` }
  }

  const outDate = payload.outDate?.trim() || new Date().toISOString().slice(0, 10)
  const updated: EntryRow = {
    ...row,
    [FIELDS.carrier]: carrier,
    [FIELDS.plate]: plate,
    [FIELDS.outDate]: outDate,
    status: SLAG_STATUS_MOVING,
    pending: true,
  }
  persist(rows, updated, id)
  const verdictNote = isOverLimit(updated) ? '（该批次热灼减率超标，请在交接清单中重点说明）' : ''
  return {
    ok: true,
    message: `炉渣批次 ${updated[FIELDS.code]} 已安排外运：${carrier} / ${plate}，外运日期 ${outDate}${verdictNote}`,
  }
}

export function confirmSlagDelivery(id: number): ActionResult {
  const rows = slagRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  if (String(row.status) !== SLAG_STATUS_MOVING) {
    return { ok: false, message: `炉渣批次 ${row[FIELDS.code]} 当前不是「外运中」，请先安排外运` }
  }
  const updated: EntryRow = { ...row, status: SLAG_STATUS_DELIVERED, pending: false }
  persist(rows, updated, id)
  return { ok: true, message: `炉渣批次 ${updated[FIELDS.code]} 已确认交付` }
}

export function markSlagAbnormal(id: number): ActionResult {
  const rows = slagRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  if (String(row.status) === SLAG_STATUS_ABNORMAL) {
    return { ok: false, message: `炉渣批次 ${row[FIELDS.code]} 已经是「数据异常」，不用重复标记` }
  }
  const updated: EntryRow = { ...row, status: SLAG_STATUS_ABNORMAL, pending: true, abnormal: true }
  persist(rows, updated, id)
  return { ok: true, message: `炉渣批次 ${updated[FIELDS.code]} 已标记数据异常` }
}

// 值班交接清单：炉渣外运安排的状态直接从处理记录汇总，外运页一变动这里就能对上。
export function slagHandover(): SlagHandoverResult {
  const today = new Date().toISOString().slice(0, 10)
  const items = ensureVerdicts(slagRows())
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((row) => ({
      id: Number(row.id),
      code: String(row[FIELDS.code] ?? ''),
      production: String(row[FIELDS.production] ?? ''),
      carrier: String(row[FIELDS.carrier] ?? ''),
      plate: String(row[FIELDS.plate] ?? ''),
      outDate: String(row[FIELDS.outDate] ?? ''),
      verdict: String(row[FIELDS.verdict] ?? ''),
      status: String(row.status ?? ''),
    }))

  const count = (status: string) => items.filter((item) => item.status === status).length
  return {
    items,
    pendingCount: count(SLAG_STATUS_PENDING),
    movingCount: count(SLAG_STATUS_MOVING),
    deliveredCount: count(SLAG_STATUS_DELIVERED),
    overLimitCount: items.filter((item) => item.verdict === SLAG_VERDICT_FAIL).length,
    deliveredToday: items.filter((item) => item.status === SLAG_STATUS_DELIVERED && item.outDate === today)
      .reduce((sum, item) => sum + (Number.parseFloat(item.production) || 0), 0),
  }
}
