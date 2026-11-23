import type { ContentPack } from '@engine/src'

/**
 * 示意世界包的事件部分：兩個範圍（街頭、交通）與幾件示意的街頭事件。
 * 機率、冷卻、成功率都是資料，由引擎的導演與事件視窗執行；這裡只是內容。之後的介面工單再往裡加。
 */
const cash = (amount: number) => ({ kind: 'cash', amount })
const flag = (key: string) => ({ kind: 'flag', key, value: true })

export function eventContent(): NonNullable<ContentPack['content']> {
  const event_scope = [
    { id: 'street', triggers: { walk: 0.22, enter_block: 0.08 }, cooldown_hours: 1, repeat_days: 0, lost: 'drop', roller: 'pc' },
    { id: 'transit', triggers: { transit_stop: 0.3, transit_wait: 0.2 }, cooldown_hours: 2, repeat_days: 0, lost: 'drop', roller: 'pc' },
  ]
  const event = [
    {
      id: 'ev_street_tout', scope: 'street', triggers: ['walk'], category: 'trouble',
      text: '一個瘦高的男人貼過來，壓低聲音說「要不要看點好貨」，手已經搭上你的袖口。',
      options: [
        { id: 'pay', text: '塞他 C$20 打發走。', need: { kind: 'money', wallet: 'cash', min: 20 }, show_locked: '你身上的現金不到 C$20。', outcomes: { any: [cash(-20)] } },
        { id: 'push', text: '甩開他的手，直接走過去。', check: ['intimidate', 'resolve', 'easy'], outcomes: { critical: [flag('tout_afraid')], success: [], fail: [cash(-10)], fumble: [cash(-30)] } },
        { id: 'ignore', text: '裝作沒聽見。', outcomes: { any: [] } },
      ],
    },
    {
      id: 'ev_street_stall', scope: 'street', triggers: ['enter_block'], category: 'favor',
      text: '路邊的攤子冒著熱氣，老闆朝你揮了揮勺子：「剛起鍋的，來一碗？」',
      options: [
        { id: 'buy', text: '坐下來吃一碗（C$8）。', need: { kind: 'money', wallet: 'cash', min: 8 }, show_locked: '你身上的現金不到 C$8。', outcomes: { any: [cash(-8), { kind: 'time', hours: 0.25 }] } },
        { id: 'chat', text: '站著聊兩句，順便打聽消息。', check: ['negotiate', 'charm', 'normal'], outcomes: { critical: [flag('stall_tip'), cash(15)], success: [flag('stall_tip')], fail: [], fumble: [] } },
        { id: 'leave', text: '揮揮手走開。', outcomes: { any: [] } },
      ],
    },
    {
      id: 'ev_transit_pickpocket', scope: 'transit', triggers: ['transit_stop'], category: 'trouble',
      text: '車廂擠得轉不過身。有人貼得太近，你感覺到外套的口袋被輕輕勾了一下。',
      options: [
        { id: 'grab', text: '一把抓住那隻手。', check: ['streetwise', 'intellect', 'normal'], outcomes: { critical: [cash(20)], success: [], fail: [cash(-25)], fumble: [cash(-50)] } },
        { id: 'move', text: '側身擠開，換個位置。', check: ['athletics', 'body', 'easy'], outcomes: { success: [], critical: [], fail: [cash(-15)], fumble: [cash(-15)] } },
        { id: 'ignore', text: '假裝沒發現。', outcomes: { any: [cash(-20)] } },
      ],
    },
    {
      id: 'ev_transit_busker', scope: 'transit', triggers: ['transit_wait'], category: 'rumor',
      text: '月台上有人抱著三味線彈唱，腳邊的帽子裡只有幾枚零錢。',
      options: [
        { id: 'tip', text: '丟 C$5 進帽子，聽完一首。', need: { kind: 'money', wallet: 'cash', min: 5 }, show_locked: '你身上的現金不到 C$5。', outcomes: { any: [cash(-5), flag('busker_heard')] } },
        { id: 'pass', text: '點個頭，繼續等車。', outcomes: { any: [] } },
      ],
    },
  ]
  return { event_scope, event } as unknown as NonNullable<ContentPack['content']>
}
