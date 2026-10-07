// 炉渣定位与交接联动的逻辑验证：esbuild 打包后在 node 下跑，不引入测试框架。
import assert from 'node:assert'

import { runAction } from '@/api/local-service'
import {
  CONCLUSION_FIELD,
  LOI_OUT,
  createSlagEntry,
  ensureLoiConclusions,
  listOutOfRangeSlag,
  locatePendingSlag,
  slagHandoverSummary,
} from '@/api/slag-service'
import { listRows, saveRows } from '@/data/local-store'

// 1. 翻页按同一条件取：页间不重复，条数对得上
const p1 = locatePendingSlag({}, 1, 3)
const p2 = locatePendingSlag({}, 2, 3)
const p3 = locatePendingSlag({}, 3, 3)
assert.strictEqual(p1.items.length, 3)
assert.strictEqual(p2.items.length, 3)
assert.strictEqual(p3.items.length, 1)
assert.strictEqual(p1.total, 7, '待外运总数应为 7')
assert.strictEqual(p1.total, p2.total)
assert.strictEqual(p2.total, p3.total)
const ids = [...p1.items, ...p2.items, ...p3.items].map((row) => row.id)
assert.strictEqual(new Set(ids).size, 7, '页与页之间不允许重复')
assert.strictEqual(ids.length, p1.total, '各页条数之和要等于总数')

// 2. 按外运单位 + 运输车号组合定位
const byCompany = locatePendingSlag({ 外运单位: '绿源建材' }, 1, 10)
assert.strictEqual(byCompany.total, 3)
const byPlate = locatePendingSlag({ 运输车号: '浙A1D235' }, 1, 10)
assert.strictEqual(byPlate.total, 1)
assert.strictEqual(byPlate.items[0]['处理编号'], 'SLAG-0001')

// 3. 写错的运输车号：给一句交代而不是空白
const wrong = locatePendingSlag({ 运输车号: '浙X00000' }, 1, 10)
assert.strictEqual(wrong.total, 0)
assert.ok(wrong.message.includes('浙X00000'), '要指出查不到的车号')
assert.ok(wrong.message.includes('核对'), '要提示核对车号')

// 4. 同一条处理记录只允许一条
const dup = createSlagEntry({
  处理编号: 'SLAG-0001',
  炉渣产量: '9.9吨',
  热灼减率: '3.0',
  外运单位: '绿源建材',
  运输车号: '浙A00001',
  记录人员: '测试员',
})
assert.strictEqual(dup.ok, false)
assert.ok(dup.message.includes('只允许登记一条'))

// 5. 正常登记：结论随记录写入；超标批次进超标列表
const created = createSlagEntry({
  处理编号: 'SLAG-0011',
  炉渣产量: '10.5吨',
  热灼减率: '8.2',
  外运单位: '宏基运输',
  运输车号: '浙A99999',
  记录人员: '测试员',
})
assert.strictEqual(created.ok, true)
assert.ok(created.message.includes('超标'))
const createdRow = listRows('slag').find((row) => row['处理编号'] === 'SLAG-0011')
assert.strictEqual(createdRow?.[CONCLUSION_FIELD], LOI_OUT)
assert.ok(listOutOfRangeSlag().some((row) => row['处理编号'] === 'SLAG-0011'))

// 6. 历史批次按当时的结论保留：限值变化不重算已有结论
const rows = ensureLoiConclusions()
const legacy = rows.find((row) => row['处理编号'] === 'SLAG-0010')
assert.strictEqual(legacy?.[CONCLUSION_FIELD], LOI_OUT, '已交付批次仍保留当时的超标结论')
assert.ok(
  !listOutOfRangeSlag().some((row) => row['处理编号'] === 'SLAG-0010'),
  '已交付批次不进待处理超标列表',
)
// 模拟标准收紧：手工把限值调严后旧结论不动（结论只认记录上写下的）
const tampered = rows.map((row) =>
  row['处理编号'] === 'SLAG-0001' ? { ...row, 热灼减率: '9.9%' } : row,
)
saveRows('slag', tampered)
const after = ensureLoiConclusions().find((row) => row['处理编号'] === 'SLAG-0001')
assert.strictEqual(after?.[CONCLUSION_FIELD], '合格', '已有结论不因数值变动而重算')

// 7. 安排外运后状态反映到交接清单
const before = slagHandoverSummary()
const ship = runAction('slag', Number(createdRow?.id), '安排外运')
assert.strictEqual(ship.ok, true)
const after2 = slagHandoverSummary()
const countOf = (list: { status: string; count: number }[], s: string) =>
  list.find((item) => item.status === s)?.count ?? 0
assert.strictEqual(countOf(after2.statusCounts, '外运中'), countOf(before.statusCounts, '外运中') + 1)
assert.strictEqual(countOf(after2.statusCounts, '待外运'), countOf(before.statusCounts, '待外运') - 1)
assert.ok(after2.shipping.some((item) => item.运输车号 === '浙A99999'), '在途车辆要进交接清单')

console.log('slag 定位 / 唯一约束 / 热灼减率结论 / 交接联动：全部通过')
