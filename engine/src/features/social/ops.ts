// L6 功能 social 的變更種類（model.ts 檔頭列了兩種）。只動 state.ext.social，疊在同一份報告裡也不會互相蓋掉（一份報告可以先發文、再清計數）。
// 編號（sp…）在套用時從 seq 發：同一個狀態、同一串變更一定得到同一個結果。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { Post, SocialState } from './model'
import { EXT, OWNER, isText, readSocial, socialRules, socialValue } from './model'

const write = (state: GameState, fn: (s: SocialState) => void): void => {
  const s = readSocial(state)
  fn(s)
  state.ext[EXT] = socialValue(s)
}

export type PostInit = Omit<Post, 'id'>

const natural = (v: unknown): v is number => isSafeInt(v) && v >= 0

const postProblems = (p: unknown): string[] => {
  if (!isRecord(p)) return ['post 要是一篇貼文']
  const out: string[] = []
  if (!isSafeInt(p.at) || p.at < 0) out.push('post.at 要是總分鐘（非負整數）')
  if (!isText(p.ref)) out.push('post.ref 要是素材或片的 id')
  if (p.kind !== 'footage' && p.kind !== 'clip') out.push('post.kind 要是 footage 或 clip')
  if (typeof p.title !== 'string' || typeof p.text !== 'string') out.push('post.title 與 post.text 要是字串')
  for (const f of ['reach', 'likes', 'comments', 'gained'] as const) if (!natural(p[f])) out.push(`post.${f} 要是 0 以上的整數`)
  if (p.fame !== undefined && !isText(p.fame)) out.push('post.fame 要是區的 id')
  return out
}

export function installOps(k: Kernel): void {
  k.changes.register<Change & { post: PostInit }>({
    op: 'social.post', owner: OWNER,
    validate: (_s, c) => postProblems(c.post),
    apply: (s, c) => write(s, (st) => {
      st.seq += 1
      st.posts.push({ ...c.post, id: `sp${st.seq}` })
      const keep = socialRules(k).posts_keep
      if (st.posts.length > keep) st.posts.splice(0, st.posts.length - keep)
      st.week.posts += 1
      if (c.post.fame !== undefined) st.week.fame += 1
    }),
    describe: (c) => `發了一篇貼文「${c.post.title}」。`,
  })

  k.changes.register<Change & { reset: true }>({
    op: 'social.week', owner: OWNER,
    validate: (_s, c) => (c.reset === true ? [] : ['reset 要是 true']),
    apply: (s) => write(s, (st) => { st.week = { posts: 0, fame: 0 } }),
  })
}
