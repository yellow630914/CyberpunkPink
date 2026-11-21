import { describe, expect, it } from 'vitest'
import { liveReact } from '../data/media'

describe('戰鬥直播的彈幕反應', () => {
  it('我方要害是大字', () => { expect(liveReact('你 開槍打 敵・打手：17 對 14，要害！傷害 9，扣護甲後 7。', () => 0)).toMatchObject({ kind: 'hot' }) })
  it('敵人過載與倒下有反應', () => {
    expect(liveReact('敵・打手 過載！失去下一回合，餘韻 1 層。')).not.toBeNull()
    expect(liveReact('敵・打手 被打倒。')).not.toBeNull()
  })
  it('換彈這種平常的行不起鬨', () => { expect(liveReact('你 換彈。')).toBeNull() })
})
