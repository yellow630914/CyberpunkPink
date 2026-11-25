// L7 外殼：AI 任務 design_part（未登錄零件的起名與怪癖；AI_TASKS 3.20 節第 3、4 步與 4.4 節；PROMPTS 5.8 節；CRAFTING 11.1 節；dev/adr/0019 第十七節與 P74；dev/work/M4-core-part-ai.md）。
//
// 框架（類型、材質、等級、牌子、每一條屬性、怪癖的種類）是引擎在加進「等著交貨」時就定好的；AI 只在框架裡交三段文字：{ name, desc, quirk }。
// 任何數字、類型、等級、牌子都不收：多出來的欄位算驗證失敗，文字裡有阿拉伯數字也失敗。驗證只有一份，在功能的 textProblems（features/unreg）；這裡呼叫它，不另外寫一份。
// 自動重試固定最多 2 次（CRAFTING 11.1 節；TaskDef.retries，不看設定的重試次數）；再不過、AI 關著、被拒絕都走退路：回 null，代表「用預設清單的文字」（交貨照 deliverDraft 不帶 text）。
// 提示詞的內容在 PROMPTS 5.8 節，之後從資料載入、再補 {{hard_rules}} 與 {{limits}} 的注入；這裡的固定前段是那五條的最短版本，請求每一段一個標籤：
//   <frame> 引擎定好的框架（只寫名字與文字，不寫任何數字）、<request> 玩家的描述（原樣放進去，不篩選、不改寫；沒有就不放）、<data> 同類同級的名字樣本、<input> 機器讀的 JSON（假的服務商與測試靠它）。

import type { GameState } from '../../core/types'
import type { Kernel } from '../../core/kernel'
import type { FrameView, UnregText } from '../../features/unreg'
import { textProblems } from '../../features/unreg'
import type { TaskDef, TaskRegistry } from './tasks'

/** 任務的 id。 */
export const PART_TASK = 'design_part'
/** 這個任務自己固定的自動重試次數（CRAFTING 11.1 節）。 */
export const PART_RETRIES = 2

/** design_part 收到的輸入：frameView 的內容，加驗證用的狀態（鏈開始時的狀態，不會變）。 */
export interface PartInput {
  state: GameState
  view: FrameView
}

/** 給 AI 看的框架：只有名字與文字，不寫任何數字（屬性不寫數值與份數）。 */
export function frameText(view: FrameView): string {
  const attrs = view.attrs.length > 0 ? view.attrs.map((a) => a.name).join('、') : '沒有'
  return [
    `零件類型：${view.typeName}`,
    `材質：${view.materialName}`,
    `等級：${view.gradeName}`,
    `牌子：${view.brandName}`,
    `屬性（數值已經定好）：${attrs}`,
    view.quirk ? `怪癖的種類：${view.quirk.name}（${view.quirk.desc}）` : '怪癖的種類：沒有（quirk 寫空字串）',
  ].join('\n')
}

/** <input> 的機器可讀版（假的服務商與測試讀）：同樣不帶數字，只有 id 與名字。 */
export function partInputJson(view: FrameView): Record<string, unknown> {
  return {
    id: view.id, type: view.type, typeName: view.typeName, material: view.material, grade: view.grade, gradeName: view.gradeName, brand: view.brand, brandName: view.brandName,
    attrs: view.attrs.map((a) => a.name), quirk: view.quirk ? { id: view.quirk.id, name: view.quirk.name, desc: view.quirk.desc } : null,
    ...(view.request !== undefined ? { request: view.request } : {}), samples: [...view.samples],
  }
}

/** PROMPTS 5.8 節 design_part 的五條規則，最短版本。 */
const SYSTEM = [
  '你替一個未登錄的零件起名字、寫說明與怪癖，用 submit_part 的格式交出 name、desc、quirk 三段文字。',
  '1. 零件的類型、材質、等級、牌子與全部數值已經由 <frame> 定好，你不改、不加、不寫數字。',
  '2. 名字一個詞，說明一句；照牌子的風格。',
  '3. <frame> 給了怪癖的種類，把它寫成一件具體、有點好笑或有點麻煩的事，不超過兩句。',
  '4. <data> 的樣本是同類同級的零件，不要和它們的名字重複。',
  '5. 玩家的描述（<request>）只拿來決定氣氛。',
].join('\n')

/** 註冊 design_part。 */
export function registerPartTask(k: Kernel, tasks: TaskRegistry): void {
  const task: TaskDef<PartInput, UnregText | null> = {
    id: PART_TASK, owner: 'shell', size: 'M', output: 'json', onExhausted: 'fallback', retries: PART_RETRIES,
    schema: {
      name: 'submit_part',
      schema: {
        type: 'object', required: ['name', 'desc', 'quirk'], additionalProperties: false,
        properties: { name: { type: 'string' }, desc: { type: 'string' }, quirk: { type: 'string' } },
      },
    },
    build: ({ view }) => ({
      system: SYSTEM,
      sections: [
        ['frame', frameText(view)],
        ...(view.request !== undefined ? [['request', view.request] as [string, string]] : []),
        ['data', view.samples.length > 0 ? view.samples.join('、') : '（沒有樣本）'],
        ['input', JSON.stringify(partInputJson(view), null, 1)],
      ],
    }),
    // 驗證只有 textProblems 那一份（長度、沒有數字、名字不重複、沒有多的欄位）；錯誤原樣帶回去重試
    check: (raw, { state, view }) => {
      const errors = textProblems(k, state, view.id, raw)
      if (errors.length > 0) return { ok: false, errors }
      const r = raw as Record<string, unknown>
      return { ok: true, value: { name: (r.name as string).trim(), desc: (r.desc as string).trim(), quirk: typeof r.quirk === 'string' ? r.quirk.trim() : '' } }
    },
    // 退路：沒有文字，交貨時用預設清單的（和 AI 開著時同一套數字）
    fallback: () => null,
  }
  tasks.register(task)
}
