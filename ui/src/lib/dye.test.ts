import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PALETTE, isColor, hexOf, colorName, defaultDye, dyeCost, dyePhrase, dyeable, sanitizeDyes } from './dye'
import { packSave, unpackSave } from './save'
import { useGame } from '../stores/game'
import { ITEMS } from '../data/items'

describe('染色：顏色的模型', () => {
  it('色票 id 與 #RRGGBB 都是顏色，其他不是', () => {
    expect(isColor('dye_pink')).toBe(true)
    expect(isColor('#12abEF')).toBe(true)
    expect(isColor('#12ab')).toBe(false)
    expect(isColor('pink')).toBe(false)
    expect(hexOf('dye_pink')).toBe('#F06AA0')
    expect(hexOf('#12abef')).toBe('#12ABEF')
  })
  it('自訂色的名字照最接近的色票', () => {
    expect(colorName('dye_olive')).toBe('橄欖綠')
    expect(colorName('#F06AA1')).toBe('偏霓虹粉的自訂色')
    expect(PALETTE.length).toBeGreaterThanOrEqual(12)
  })
  it('預設的顏色：物品自己寫的優先，沒寫照牌子', () => {
    expect(defaultDye({ brand: '星旗' })).toEqual({ primary: 'dye_olive', secondary: 'dye_black' })
    expect(defaultDye({ brand: '星旗', colors: ['dye_red', '#000000'] })).toEqual({ primary: 'dye_red', secondary: '#000000' })
    expect(defaultDye({ brand: '不知道' }).primary).toBe('dye_gray')
  })
  it('價錢：每改一個顏色算一次；換回預設不要錢；內海不要錢', () => {
    const def = { primary: 'dye_white', secondary: 'dye_blue' }
    expect(dyeCost(def, { primary: 'dye_pink', secondary: 'dye_blue' }, def, 'shop')).toBe(20)
    expect(dyeCost(def, { primary: 'dye_pink', secondary: 'dye_black' }, def, 'home')).toBe(10)
    expect(dyeCost({ primary: 'dye_pink', secondary: 'dye_black' }, def, def, 'shop')).toBe(0)
    expect(dyeCost(def, { primary: 'dye_pink', secondary: 'dye_black' }, def, 'net')).toBe(0)
  })
  it('外觀描述裡的一句；可以染的種類', () => {
    expect(dyePhrase('夾克', { primary: 'dye_pink', secondary: 'dye_black' })).toBe('霓虹粉的夾克，黑的滾邊與配件')
    expect(dyePhrase('夾克', { primary: 'dye_pink', secondary: 'dye_pink' })).toBe('霓虹粉的夾克')
    expect(dyeable({ kind: 'weapon' })).toBe(true)
    expect(dyeable({ kind: 'cyberware' })).toBe(false)
  })
  it('讀存檔時丟掉格式不對的染色', () => {
    expect(sanitizeDyes({ 'uid:u1': { primary: 'dye_pink', secondary: '#000000' }, 'x:1': { primary: 'dye_pink', secondary: 'dye_pink' }, 'slot:top': { primary: 'nope', secondary: 'dye_pink' } }))
      .toEqual({ 'uid:u1': { primary: 'dye_pink', secondary: '#000000' } })
  })
})

describe('染色：跟著物品走、跟著存檔走', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('穿上時顏色跟到格子上，脫下來變成另一疊，不和沒染的合併', () => {
    const g = useGame()
    const def = Object.values(ITEMS).find(d => d.kind === 'clothing' && !Array.isArray(d.slot) && d.slot)!
    const uid = g.addItem(def.id, 2)!
    g.setDye(`uid:${uid}`, { primary: 'dye_mint', secondary: 'dye_black' })
    const slot = def.slot as never
    g.equipItem(slot, uid)
    expect(g.dyes[`slot:${slot}`]).toEqual({ primary: 'dye_mint', secondary: 'dye_black' })
    g.unequip(slot)
    expect(g.dyes[`slot:${slot}`]).toBeUndefined()
    const stacks = g.inventory.filter(s => s.def === def.id)
    expect(stacks.some(s => g.dyes[`uid:${s.uid}`]?.primary === 'dye_mint')).toBe(true)
    g.addItem(def.id)
    expect(g.inventory.filter(s => s.def === def.id).every(s => !g.dyes[`uid:${s.uid}`] || s.qty >= 1)).toBe(true)
  })
  it('存了再讀回來，顏色還在', () => {
    const g = useGame()
    const uid = g.inventory[0].uid
    g.setDye(`uid:${uid}`, { primary: '#123456', secondary: 'dye_gold' })
    const raw = packSave(g.serialize(), g.saveMeta())
    setActivePinia(createPinia())
    const g2 = useGame()
    const r = unpackSave<ReturnType<typeof g2.serialize>>(raw)
    if (r.ok) g2.hydrate(r.file.state)
    expect(g2.dyes[`uid:${uid}`]).toEqual({ primary: '#123456', secondary: 'dye_gold' })
  })
})
