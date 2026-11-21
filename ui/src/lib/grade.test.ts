import { describe, it, expect } from 'vitest'
import { gradeColorVar, gradeClass, parseGrade, GRADE_LABEL } from './grade'

describe('等級色', () => {
  it('I～V 對到 --g1～--g5', () => {
    expect(gradeColorVar(1)).toBe('var(--g1)')
    expect(gradeColorVar(4)).toBe('var(--g4)')
    expect(gradeClass(5)).toBe('g5')
  })
  it('空的格子用線色、不給 class', () => {
    expect(gradeColorVar(null)).toBe('var(--line-2)')
    expect(gradeClass(undefined)).toBe('')
  })
  it('羅馬數字與數字都讀得懂', () => {
    expect(parseGrade('III')).toBe(3)
    expect(parseGrade('iv')).toBe(4)
    expect(parseGrade(2)).toBe(2)
    expect(parseGrade('VI')).toBeNull()
    expect(GRADE_LABEL[5]).toBe('V')
  })
})
