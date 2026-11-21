import type { BillItem, Income } from '../lib/bills'

/**
 * 這一份假存檔下週一的帳單（DOWNTIME 5.1 節的順序、FIXER 第 4 節的項目、CRAFTING 第 15 節的整備費）。
 * 帳戶合計 2,061，另有一筆現金的利息。
 */
export const BILL_ITEMS: BillItem[] = [
  { id: 'rent', order: 1, name: '房租・四號塔的單位', note: '何伯收；週租', base: 150, from: '帳戶', cashOk: true, ifUnpaid: '進入下坡路' },
  { id: 'rent2', order: 1, name: '房租・舊港的貨櫃屋', note: '安全屋', base: 120, from: '現金', cashOk: true, ifUnpaid: '進入下坡路' },
  { id: 'sub_hz', order: 2, name: '義體訂閱・早咲・五分咲', note: '緋櫻；售價的 3%', base: 441, from: '帳戶', ifUnpaid: '那件立刻鎖' },
  { id: 'supp', order: 3, name: '抑制劑', note: '蜜腺；一週份', base: 80, from: '帳戶', ifUnpaid: '停藥反彈：下限 +15，兩週' },
  { id: 'eden', order: 5, name: '債的利息・伊甸園', note: '消費貸款 C$35,000；每週 2%', base: 700, from: '帳戶', ifUnpaid: '進入下坡路' },
  { id: 'alian', order: 5, name: '債的利息・阿蓮', note: '那一筆 C$2,000；收現金', base: 60, from: '現金', cashOk: true, ifUnpaid: '進入下坡路' },
  { id: 'angel', order: 6, name: '天使急救會費', note: '銀卡', base: 120, from: '帳戶', ifUnpaid: '資格停到補繳' },
  { id: 'guard', order: 7, name: '家務・看門的', note: '孤星連', base: 200, from: '帳戶', cashOk: true, ifUnpaid: '那個人不再來' },
  { id: 'mech', order: 10, name: '整備費・野馬', note: '機甲；含養車 60', base: 370, from: '帳戶', ifUnpaid: '耐久上限 −5' },
]
export const INCOMES: Income[] = [
  { id: 'dispatch', name: '派工的抽成・灰鴿', amount: 180, to: '現金' },
]
export const LAUNDER = { where: '天井市場的零件攤後面', rate: 0.15 }

/** 待處理（UI 3.3 節）：引擎的 pendingEvents() 回傳 {id, kind, blocking, ref, due}。這裡是它的假資料。 */
export interface PendingItem { id: string; kind: '帳單' | '人情' | '名冊' | '頻道' | '委託' | '戰敗' | '契約'; title: string; body: string; due?: string; blocking?: boolean; action?: { label: string; dialog?: string; props?: Record<string, unknown>; route?: string } }
export const PENDING: PendingItem[] = [
  { id: 'p_joe', kind: '名冊', title: '喬被市警帶走了', body: '昨晚在蜂巢東側被帶進第七分局。保釋金 1,200，或用一個人情。', due: '2 天', action: { label: '打開名冊', dialog: 'roster' } },
  { id: 'p_scoop', kind: '頻道', title: '萬華鏡搶先播了清查公告', body: '對手頻道搶了七號塔的料。可以回應，或當作沒看到。', due: '2 天', action: { label: '打開頻道', dialog: 'channel' } },
  { id: 'p_bill', kind: '帳單', title: '下週一收租', body: '帳戶要付 2,061；現金 180。', due: '7 天', action: { label: '看帳單', dialog: 'bills' } },
  { id: 'p_favor', kind: '人情', title: '奈奈要討那個人情', body: '她要你下週替海棠樓跑一趟渡輪。', due: '5 天', action: { label: '打開關係', dialog: 'relations', props: { npcId: 'nana' } } },
]
