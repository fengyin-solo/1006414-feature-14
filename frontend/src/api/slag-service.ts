import { filterRows, paginateRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

// 炉渣模块的专用业务规则：外运定位、热灼减率判定、登记唯一约束、交接汇总。
// 通用列表/动作仍走 local-service，这里只放炉渣自己的门道。

const SLAG_KEY = 'slag'

/** 热灼减率限值（%）：按 GB 18485 要求，焚烧炉渣热灼减率不高于 5%。 */
export const LOI_LIMIT_PERCENT = 5

export const CONCLUSION_FIELD = '热灼减率结论'
export const LOI_OK = '合格'
export const LOI_OUT = '超标'
export const LOI_UNKNOWN = '未判定'

export function parseLoi(raw: unknown): number | null {
  const text = String(raw ?? '').replace(/[%％\s]/g, '')
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function judgeLoi(raw: unknown): string {
  const value = parseLoi(raw)
  if (value === null) {
    return LOI_UNKNOWN
  }
  return value > LOI_LIMIT_PERCENT ? LOI_OUT : LOI_OK
}

// 结论只在登记或旧数据首次读取时写入记录本身；之后即便限值调整，
// 历史批次仍按当时写下的结论保留，不再重算。
export function ensureLoiConclusions(): EntryRow[] {
  const rows = listRows(SLAG_KEY)
  let changed = false
  const next = rows.map((row) => {
    const kept = row[CONCLUSION_FIELD]
    if (typeof kept === 'string' && kept !== '') {
      return row
    }
    changed = true
    return { ...row, [CONCLUSION_FIELD]: judgeLoi(row['热灼减率']) }
  })
  if (changed) {
    saveRows(SLAG_KEY, next)
  }
  return next
}

export type SlagLocateQuery = {
  炉渣产量?: string
  外运单位?: string
  运输车号?: string
}

export type SlagLocateResult = PageResult & { message: string }

const LOCATE_FIELDS = ['炉渣产量', '外运单位', '运输车号'] as const

function emptyResultMessage(filters: Record<string, string>): string {
  const plate = filters['运输车号']
  if (plate) {
    return `未找到运输车号「${plate}」对应的待外运炉渣，请核对车号是否填写有误`
  }
  const fields = Object.keys(filters)
  if (fields.length > 0) {
    return `按${fields.join('、')}条件没有查到待外运的炉渣记录，可调整条件后重新查询`
  }
  return '当前没有待外运的炉渣记录'
}

// 外运定位：只在「待外运」里按炉渣产量、外运单位、运输车号挑记录；
// 翻页按同一份条件切片，页与页之间不重复，总数与匹配条数一致。
export function locatePendingSlag(
  query: SlagLocateQuery,
  page = 1,
  size = 5,
): SlagLocateResult {
  const pending = ensureLoiConclusions().filter((row) => row.status === '待外运')
  const filters: Record<string, string> = {}
  for (const field of LOCATE_FIELDS) {
    const value = (query[field] ?? '').trim()
    if (value !== '') {
      filters[field] = value
    }
  }
  const matched = filterRows(pending, filters)
  const result = paginateRows(matched, page, size)
  return {
    ...result,
    message: matched.length === 0 ? emptyResultMessage(filters) : '',
  }
}

// 热灼减率超出范围的批次单独标出：只列还没交付的，历史已交付批次留在原列表里。
export function listOutOfRangeSlag(): EntryRow[] {
  return ensureLoiConclusions().filter(
    (row) => row[CONCLUSION_FIELD] === LOI_OUT && row.status !== '已交付',
  )
}

export type SlagEntryInput = {
  处理编号: string
  炉渣产量: string
  热灼减率: string
  外运单位: string
  运输车号: string
  记录人员: string
}

export function createSlagEntry(input: SlagEntryInput): ActionResult {
  const rows = ensureLoiConclusions()
  const code = input.处理编号.trim()
  if (code === '') {
    return { ok: false, message: '处理编号不能为空' }
  }
  // 同一条处理记录只允许一条：处理编号重复直接拒绝登记。
  if (rows.some((row) => String(row['处理编号']) === code)) {
    return { ok: false, message: `处理编号「${code}」已存在，同一条处理记录只允许登记一条` }
  }
  const loi = parseLoi(input.热灼减率)
  if (loi === null || loi < 0 || loi > 100) {
    return { ok: false, message: '热灼减率请填写 0~100 之间的数值（%）' }
  }
  const conclusion = judgeLoi(loi)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: '待外运',
    pending: true,
    abnormal: conclusion === LOI_OUT,
    处理编号: code,
    炉渣产量: input.炉渣产量.trim(),
    热灼减率: `${loi}%`,
    外运单位: input.外运单位.trim(),
    外运日期: new Date().toISOString().slice(0, 10),
    运输车号: input.运输车号.trim(),
    记录人员: input.记录人员.trim(),
    处理状态: '待外运',
    [CONCLUSION_FIELD]: conclusion,
  }
  saveRows(SLAG_KEY, [...rows, entry])
  return { ok: true, message: `已登记${code}，热灼减率 ${loi}% 判定为「${conclusion}」` }
}

export type SlagHandover = {
  statusCounts: { status: string; count: number }[]
  outOfRangePending: number
  shipping: { 处理编号: string; 外运单位: string; 运输车号: string }[]
}

// 交接清单用的炉渣外运汇总：各状态批次数、超标待处理数，以及外运中的在途车辆明细。
export function slagHandoverSummary(): SlagHandover {
  const rows = ensureLoiConclusions()
  const statuses = ['待外运', '外运中', '已交付', '数据异常']
  return {
    statusCounts: statuses.map((status) => ({
      status,
      count: rows.filter((row) => row.status === status).length,
    })),
    outOfRangePending: rows.filter(
      (row) => row[CONCLUSION_FIELD] === LOI_OUT && row.status !== '已交付',
    ).length,
    shipping: rows
      .filter((row) => row.status === '外运中')
      .map((row) => ({
        处理编号: String(row['处理编号'] ?? ''),
        外运单位: String(row['外运单位'] ?? ''),
        运输车号: String(row['运输车号'] ?? ''),
      })),
  }
}
