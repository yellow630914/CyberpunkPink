// 測試基礎建設：冒煙的「斷在哪一步」（dev/test-harness.md 第 6 節）。一條冒煙是一串有名字的步驟；任何一步丟錯（含 expect 沒過），
// 錯誤訊息開頭寫出是哪一條、第幾步、叫什麼，後面接原本的訊息，讓一眼看得出主幹斷在哪裡。

export interface Flow {
  name: string
  /** 做一步。回傳這一步的結果；丟錯時改丟「冒煙「條」斷在第 n 步「步名」：原因」。 */
  step<T>(label: string, fn: () => T | Promise<T>): Promise<T>
  /** 已經做過的步驟名（照順序） */
  readonly done: string[]
}

export function flow(name: string): Flow {
  const done: string[] = []
  return {
    name,
    done,
    async step<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
      try {
        const r = await fn()
        done.push(label)
        return r
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`冒煙「${name}」斷在第 ${done.length + 1} 步「${label}」（前面做完：${done.length > 0 ? done.join('、') : '沒有'}）：${msg}`, { cause: e })
      }
    },
  }
}
