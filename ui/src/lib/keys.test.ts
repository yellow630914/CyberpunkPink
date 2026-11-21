import { describe, it, expect } from 'vitest'
import { keyAction, combatKey, type KeyContext } from './keys'

const MAIN: KeyContext = { typing: false, dialogOpen: false, canMove: true, inGame: true, onMain: true }

describe('全域快捷鍵', () => {
  it('方向鍵與 WASD 走一格，E 互動（不必先點地圖）', () => {
    expect(keyAction({ key: 'ArrowUp' }, MAIN)).toEqual({ type: 'move', dx: 0, dy: -1 })
    expect(keyAction({ key: 'a' }, MAIN)).toEqual({ type: 'move', dx: -1, dy: 0 })
    expect(keyAction({ key: 'D' }, MAIN)).toEqual({ type: 'move', dx: 1, dy: 0 })
    expect(keyAction({ key: 's' }, MAIN)).toEqual({ type: 'move', dx: 0, dy: 1 })
    expect(keyAction({ key: 'e' }, MAIN)).toEqual({ type: 'interact' })
    expect(keyAction({ key: 'Enter' }, MAIN)).toBeNull()
  })
  it('打字時、有對話框時不走', () => {
    expect(keyAction({ key: 'w' }, { ...MAIN, typing: true })).toBeNull()
    expect(keyAction({ key: 'ArrowLeft' }, { ...MAIN, dialogOpen: true })).toBeNull()
    expect(keyAction({ key: 'e' }, { ...MAIN, canMove: false })).toBeNull()
  })
  it('字母開對話框；M 只在主畫面；修飾鍵不算', () => {
    expect(keyAction({ key: 'b' }, MAIN)).toEqual({ type: 'dialog', name: 'bag' })
    expect(keyAction({ key: 'K' }, MAIN)).toEqual({ type: 'dialog', name: 'skills' })
    expect(keyAction({ key: 'm' }, MAIN)).toEqual({ type: 'city' })
    expect(keyAction({ key: 'm' }, { ...MAIN, onMain: false })).toBeNull()
    expect(keyAction({ key: 'b', ctrlKey: true }, MAIN)).toBeNull()
    expect(keyAction({ key: 'b' }, { ...MAIN, inGame: false, canMove: false })).toBeNull()
  })
  it('Esc 永遠有；快速存讀檔只在遊戲畫面', () => {
    expect(keyAction({ key: 'Escape' }, { ...MAIN, typing: true, dialogOpen: true })).toEqual({ type: 'escape' })
    expect(keyAction({ key: 'F5' }, MAIN)).toEqual({ type: 'quicksave' })
    expect(keyAction({ key: 's', ctrlKey: true }, { ...MAIN, typing: true })).toEqual({ type: 'quicksave' })
    expect(keyAction({ key: 'F9' }, MAIN)).toEqual({ type: 'quickload' })
    expect(keyAction({ key: 'F5' }, { ...MAIN, inGame: false })).toBeNull()
  })
})

describe('戰鬥的鍵', () => {
  const C = { typing: false, dialogOpen: false, targeting: false }
  it('1～9 是圓環的格、空白鍵結束回合、Tab 換目標', () => {
    expect(combatKey({ key: '1' }, C)).toEqual({ type: 'ring', i: 0 })
    expect(combatKey({ key: '9' }, C)).toEqual({ type: 'ring', i: 8 })
    expect(combatKey({ key: '0' }, C)).toBeNull()
    expect(combatKey({ key: ' ' }, C)).toEqual({ type: 'end' })
    expect(combatKey({ key: 'Tab' }, C)).toEqual({ type: 'cycle', dir: 1 })
    expect(combatKey({ key: 'Tab', shiftKey: true }, C)).toEqual({ type: 'cycle', dir: -1 })
  })
  it('Enter 與 Esc 只在選目標時接；打字、對話框開著、按住不放時不作用', () => {
    expect(combatKey({ key: 'Enter' }, C)).toBeNull()
    expect(combatKey({ key: 'Enter' }, { ...C, targeting: true })).toEqual({ type: 'confirm' })
    expect(combatKey({ key: 'Escape' }, C)).toBeNull()
    expect(combatKey({ key: 'Escape' }, { ...C, targeting: true })).toEqual({ type: 'cancel' })
    expect(combatKey({ key: '1' }, { ...C, typing: true })).toBeNull()
    expect(combatKey({ key: '1' }, { ...C, dialogOpen: true })).toBeNull()
    expect(combatKey({ key: ' ', repeat: true }, C)).toBeNull()
  })
})
