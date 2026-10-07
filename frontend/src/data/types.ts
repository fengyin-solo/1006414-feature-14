/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

// 炉渣外运查询条件：产量与外运单位走包含匹配，车号去空白后包含匹配，状态/结论精确匹配。
export type SlagQuery = {
  production?: string
  carrier?: string
  plate?: string
  status?: string
  verdict?: string
}

// 安排外运时写入的信息：车号必须像车牌，外运单位不能为空。
export type SlagArrange = {
  carrier: string
  plate: string
  outDate?: string
}

// 值班交接清单里的炉渣外运项：直接反映炉渣处理记录当前的外运状态。
export type SlagHandoverItem = {
  id: number
  code: string
  production: string
  carrier: string
  plate: string
  outDate: string
  verdict: string
  status: string
}

export type SlagHandoverResult = {
  items: SlagHandoverItem[]
  pendingCount: number
  movingCount: number
  deliveredCount: number
  overLimitCount: number
  deliveredToday: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
