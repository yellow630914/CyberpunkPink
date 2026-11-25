// 偶像：應援（SKILL_TREES 偶像一節的內海欄；MEDIA 9.1 節；M3-skill-net-b）。現實欄與輿論欄是 null（媒體型，現實沒有效果）。
// 應援是招牌的 net.link（行動 <id>.link：接上最多樹階＋1 名隊友）；曲目是姿態（net.song：淺檔數字減半、when.sync_min 寫深檔以上那一條；mods 的 who: linked 是同步中的隊友）。
// 召集與合唱的協力要群眾（M5）／協力規則，沒有。共鳴只在內海生效的寫在 resonance.net。測試規則表要有的狀態：pacified（不攻擊）、dazed（脫鉤衝擊）。

import type { Tree } from './util'
import { buff, treeOf } from './util'

const T = treeOf({
  id: 'idol', name: '偶像', tree: '偶像：應援', category: 'media', signature: 'sk_idol_cheer_on', domains: { meat: 'none', net: 'mid', opinion: 'strong' },
  resonance: [
    { tier: 1, cells: 1, text: '每場內海戰鬥第一次用應援接上隊友時，不花行動點。', net: { mods: [{ kind: 'action_ap', value: -1, tags: ['sk_idol_cheer_on.link'], per_fight: 1 }] } },
    { tier: 2, cells: 1, text: '每場輿論戰第一次佔應援圈時，防守 −1（最少 0）。' },
    { tier: 3, cells: 1, text: '感載上限 +4。', net: { load_max: 4 } },
    { tier: 4, cells: 1, text: '輿論戰的開場手牌 +1。' },
    { tier: 5, cells: 1, text: '同步檔位的上限 +1 級（照 CORE_RULES 第 5 節，最高是全檔）。', net: { mods: [{ kind: 'sync_cap', value: 1 }] } },
  ],
}, 'media')

const s = (id: string) => `sk_idol_${id}`
const CH = s('cheer_on')
const LINKED = { tag: 'linked' }

// ================================ 1 階 ================================
T.skill(CH, '應援', 1, 'sig', 'passive', 3, 0, undefined,
  '花 1 行動點接上最多「樹階＋1」名隊友，之後每回合自動維持。被接上的隊友受到感載時，你可以替他承受一半。你過載時全部的同步斷開，每個被接上的隊友各吃一次脫鉤衝擊（NETRUNNING 第 3 節）。開著時追蹤度每回合 +1。曲目是姿態，同時只能開一首；你的同步檔位在淺檔時曲目的數字減半（無條件捨去），在深檔以上改用曲目寫的「深檔以上」那一條。', 'approx',
  '新鍵 net.link（行動 <id>.link）與 net.song；分擔是「事後對帳」（核心的加感載沒有掛點）：每個行動做完、每次攻擊結算完、每個回合與每一輪開頭比對隊友的感載增加，一半退給他、偶像承受；隊友在那一擊裡就過載的來不及攔；追蹤度 +1 用修正 trace_round',
  { use: { net: { ap: 1 } }, net: { link: true } })

T.skill(s('march'), '進行曲', 1, 'front', 'stance', 1, 1.5, CH,
  '曲目。開著時，同步中的隊友命中 +1；深檔以上，迴避也 +1。', 'done', 'song；mods who linked：hit +1、evade +1（when.sync_min deep）；淺檔 hit 減半成 0',
  { use: { net: { ap: 1 } }, net: { song: true, mods: [{ kind: 'hit', value: 1, who: 'linked' }, { kind: 'evade', value: 1, who: 'linked', when: { sync_min: 'deep' } }] } })

T.gap(s('stance'), '表態', 1, 'front', 'active', 1, 1, CH, { use: { ap: 0 } })
T.gap(s('support'), '聲援', 1, 'front', 'active', 1, 1, CH, { use: { ap: 0 } })

T.skill(s('lullaby'), '搖籃曲', 1, 'back', 'stance', 1, 1.5, s('march'),
  '曲目。開著時，同步中的隊友每回合多消退 3 點感載；深檔以上多消退 5 點。', 'done', 'song；mods who linked：decay +3（標準檔以下）、+5（when.sync_min deep）；淺檔減半成 1',
  {
    use: { net: { ap: 1 } },
    net: { song: true, mods: [{ kind: 'decay', value: 3, who: 'linked', when: { sync_max: 'standard' } }, { kind: 'decay', value: 5, who: 'linked', when: { sync_min: 'deep' } }] },
  })

T.skill(s('im_ok'), '我還可以！', 1, 'back', 'passive', 2, 1, s('stance'),
  '感載上限 +3；替隊友分擔感載時，你自己受到的再少 1 點。', 'done', 'pool.load max +3；新修正 link_relief 1',
  { net: { pool: { load: { max: 3 } }, mods: [{ kind: 'link_relief', value: 1 }] } })

T.gap(s('handshake'), '握握手', 1, 'back', 'daily', 1, 1, s('support'))

// ================================ 2 階 ================================
T.skill(s('encore'), '安可', 2, 'front', 'stance', 1, 2, s('march'),
  '曲目。開著時，同步中的隊友讓敵人過載，那名隊友退還 1 點行動點（全隊每回合一次）。深檔以上，換上這首歌的那一刻再給一名同步中的隊友 1 點行動點，只能在這一回合用（每場 1）。', 'approx',
  'song；新鍵 net.on_link_overload（隊友讓敵人過載：行動點 +1，全隊每輪一次）；深檔的「換上那一刻給一名同步中的隊友」用 do_on＋隨機挑人（不限同步中、沒有每場 1 次的限制）',
  {
    use: { net: { ap: 1 } },
    net: {
      song: true, on_link_overload: [{ op: 'ap', amount: 1 }],
      do_on: [{ op: 'branch', when: { sync_min: 'deep' }, do: [{ op: 'pick_random', key: 'mate', from: 'ally' }, { op: 'ap', who: 'pick:mate', amount: 1 }] }],
    },
  })

T.gap(s('rally'), '動員', 2, 'front', 'active', 1, 2, s('stance'), { use: { ap: 0 } })

T.skill(s('sing_to_me'), '聽我唱', 2, 'front', 'active', 1, 2, s('support'),
  '一名同步中的隊友這回合下一次攻擊命中 +2。', 'approx', '目標要帶 linked 標籤（同步中）；buff 命中 +2 到我的下個回合開始（「下一次」攻擊沒有：算到期限內每一次）',
  { use: { net: { ap: 1 } }, net: { target: 'ally', needs: LINKED, do: [buff('sing_to_me', '聽我唱', { who: 'target', until: 'source_turn_start', mods: [{ kind: 'hit', value: 2 }] })] } })

T.skill(s('soothe'), '安撫', 2, 'back', 'active', 1, 2, s('encore'),
  '對一個蕾絲或遺魂唱歌，擲表演對 10＋它的等級×2（精英再 +2）：成功的話，它下一回合不攻擊（還是會移動與用工具）。對黑蕾絲與首領無效。', 'done',
  '目標帶 persona 或 program 標籤、不是首領、沒有 lace:black；成功給狀態 pacified（測試規則表自帶），帶它的人的攻擊類行動（weapon_attack、hack）花費 +100，AI 列不出',
  {
    use: { net: { ap: 2, ram: 1 } },
    net: {
      target: 'enemy', needs: { any: [{ tag: 'persona' }, { tag: 'program' }], no_rank: ['boss'], no_tag: 'lace:black' },
      do: [{ op: 'check', attr: 'charm', skill: 'perform', vs: { base: 10, per_grade: 2, elite: 2 }, tags: ['soothe'], label: '安撫' }, { op: 'status', status: 'pacified', until: 'own_turn_end', if: 'ok' }],
    },
  })

T.gap(s('everyone_here'), '大家都在喔', 2, 'back', 'passive', 3, 1.5, s('rally'))

// ================================ 3 階 ================================
T.skill(s('chorus'), '合唱', 3, 'front', 'stance', 2, 2.5, s('encore'),
  '曲目。開著時，同步中的隊友互相協力不需要相同的基本功，協力的加值從 +2 變成 +3。深檔以上，同步中的隊友打同一個敵人時，從第二個人起傷害骰多半顆（無條件進位成 1 點）。', 'none',
  '「協力」（互相協力的加值與基本功）在戰鬥規則裡沒有這個機制；「多半顆骰」也沒有修正可寫', { use: { net: { ap: 1 } }, net: { pending: true, text: '協力不需要相同的基本功、加值 +3。（戰鬥裡沒有協力規則）' } })

T.gap(s('one_line'), '一句話', 3, 'front', 'passive', 4, 2, s('rally'))

T.skill(s('summon'), '召集', 3, 'front', 'active', 2, 6, s('sing_to_me'),
  '親衛隊的化身湧進來，到你的第二個回合結束：我方每一格的遮蔽升一級（暴露→半掩體→掩體），而且每回合對敵方第 1 格的人灌 4 點感載。追蹤度 +5。（人氣 40 以上，每場 1）', 'wait',
  '群眾（親衛隊的化身）是 M5，人氣也是（媒體功能）；內海的「群眾」是一格上的效果，不是單位', { use: { net: { ap: 2, per_fight: 1 } }, net: { pending: true, text: '親衛隊的化身湧進來。（群眾與人氣在 M5）' } })

T.gap(s('concert'), '公演', 3, 'back', 'active', 2, 3, s('one_line'), { use: { per_turn: 1 } })
T.gap(s('sing_out'), '唱出來', 3, 'back', 'daily', 2, 2, s('one_line'))

// ================================ 4 階 ================================
T.skill(s('swan_song'), '絕唱', 4, 'front', 'stance', 2, 3, s('chorus'),
  '曲目。開著時，你替隊友分擔感載改成全額承受。關掉或換掉這首歌的時候，把你目前的感載一次灌給一個敵人（最多 20 點，深檔以上最多 30 點），你的感載歸零並疊一層餘韻；這一下每場一次。', 'approx',
  'song；link_full（全額分擔）；do_off：隨機挑一個敵人、新效果 link.dump（灌 max 20、深檔 30，歸零、餘韻 +1；每場一次）；灌給誰是隨機的（stance 的行動沒有目標可以選）',
  { use: { net: { ap: 1 } }, net: { song: true, link_full: true, do_off: [{ op: 'pick_random', key: 'foe', from: 'foe' }, { op: 'link.dump', who: 'pick:foe', max: 20, deep_max: 30 }] } })

T.skill(s('ill_take_it'), '我來擋！', 4, 'front', 'reaction', 2, 5, s('one_line'),
  '同步中的隊友要被釘住時，你替他擋，那一次釘住的檢定 −5。（內海每場 1）', 'approx', '釘住的檢定沒有被擲的一方（見我很清醒）：改成同步中的隊友要被釘住時直接擋下（out_before 的 prevent），比 −5 強',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'out_before', who: 'linked' }, react: { prevent: { how: ['pinned'] } } } })

T.gap(s('dome'), '巨蛋', 4, 'front', 'active', 2, 8, s('concert'), { use: { per_fight: 1 } })

T.skill(s('rest_a_bit'), '休息一下下', 4, 'back', 'active', 2, 4, s('swan_song'),
  '一名同步中的隊友排掉 8 點感載，並消一層餘韻。', 'done', '目標帶 linked；vent 8、afterglow −1',
  { use: { net: { ap: 2, ram: 1 } }, net: { target: 'ally', needs: LINKED, do: [{ op: 'vent', amount: 8 }, { op: 'afterglow', amount: -1 }] } })

T.gap(s('center'), 'C 位是我的', 4, 'back', 'passive', 5, 2.5, s('ill_take_it'))

// ================================ 5 階 ================================
T.skill(s('graduation'), '畢業公演', 5, 'front', 'active', 3, 10, s('dome'),
  '同步中的隊友各排掉 8 點感載，下一次攻擊的傷害骰多 1 顆。（內海 2 行，每場 1）', 'approx', '新效果 link.each：每個同步中的隊友 vent 8、掛 buff 傷害骰 +1 到我的下個回合開始（「下一次」攻擊沒有）',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: { target: 'none', do: [{ op: 'link.each', do: [{ op: 'vent', amount: 8 }, buff('graduation', '畢業公演', { who: 'target', until: 'source_turn_start', mods: [{ kind: 'dice', value: 1 }] })] }] },
  })

T.skill(s('for_you'), '為你而唱', 5, 'front', 'active', 3, 10, s('ill_take_it'),
  '終極（支援）。同步中的隊友各消一層餘韻、排掉 8 點感載；到你的下個回合為止，他們不會被釘住。（內海 2 行，每場 1）', 'done', 'link.each：afterglow −1、vent 8、buff 新修正 no_pin（out.before 擋下釘住）到我的下個回合開始',
  {
    use: { net: { ap: 2, per_fight: 1 } },
    net: { target: 'none', do: [{ op: 'link.each', do: [{ op: 'afterglow', amount: -1 }, { op: 'vent', amount: 8 }, buff('for_you', '為你而唱', { who: 'target', until: 'source_turn_start', mods: [{ kind: 'no_pin', value: 1 }] })] }] },
  })

T.skill(s('all_sync'), '全員同步', 5, 'front', 'stance', 3, 3.5, s('swan_song'),
  '終極（改變規則），曲目。開著時，同步中的隊友套用你現在的同步檔位，照同步原則的四檔。隊友不看自己的同步基本功與敏感度，也不能自己換檔，跟著你換。全檔多回的那 1 點行動點，是本樹唯一會改到每回合回復行動點的效果。', 'approx',
  'song＋link_gear：隊友的命中與檢定、受到的感載、每回合行動點，用「偶像那一檔 − 他自己那一檔」的差補成偶像的檔位；「全檔過載沉溺 +2」沒補、「不能自己換檔」沒擋、不看自己的敏感度沒做',
  { use: { net: { ap: 1 } }, net: { song: true, link_gear: true } })

T.gap(s('legend'), '傳說', 5, 'back', 'passive', 6, 3, s('graduation'))

T.skill(s('dont_go'), '大家不要走', 5, 'back', 'reaction', 3, 11, s('for_you'),
  '你過載時，同步不斷開、被接上的隊友不吃脫鉤衝擊，而且你不閃斷（RAM 不歸零）。（每場 1）', 'done', '反應 overload／self：react.keep_link ＋ flash { ram: before, end }',
  { use: { net: { ap: 0, per_fight: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { keep_link: true, flash: { ram: 'before', end: true } } } })

export const IDOL: Tree = { path: T.path, abilities: T.abilities, notes: T.notes }
