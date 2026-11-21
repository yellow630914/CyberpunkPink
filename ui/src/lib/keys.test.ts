import { describe, it, expect } from 'vitest'
import { keyAction, type KeyContext } from './keys'

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
