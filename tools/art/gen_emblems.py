#!/usr/bin/env python3
"""二十九個勢力的徽記 v0：剪影＋扁平、3～4 色、形狀之間留縫（ART_STYLE 第 5 節）。
企業是斜切角的方牌，街頭是圓形的貼紙，公家是盾。輸出：
  docs/art/style/emblems-v0.svg   一張總覽（六欄）
  docs/art/style/emblems-sprite.svg  每個勢力一個 <symbol id="em-勢力id">，給畫面引用
用法：python3 tools/art/gen_emblems.py"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'style')
GAP = '#120D19'  # 縫的顏色（現實皮的底）

# (id, 名字, 類, 主色, 副色, 內容)  內容用 64×64 的座標；{c} 主色、{d} 副色、{w} 奶白、{g} 縫
E = [
 ('hizakura', '緋櫻重工', 'corp', '#E8455B', '#FFB7D5', '<circle cx="32" cy="32" r="16" fill="none" stroke="{d}" stroke-width="5" stroke-dasharray="5 3.4"/>' +
   ''.join(f'<ellipse cx="32" cy="20.5" rx="5.2" ry="8" fill="{{c}}" stroke="{{g}}" stroke-width="1.6" transform="rotate({a} 32 32)"/>' for a in range(0, 360, 72)) + '<circle cx="32" cy="32" r="3.6" fill="{w}"/>'),
 ('starbelle', '星旗防務', 'corp', '#3B5BA9', '#F2C14E', '<path d="M8 38l10-6 14 4 14-4 10 6-10 3-14-3-14 3z" fill="{d}"/><path d="M32 12l5 11 12 1-9 8 3 12-11-7-11 7 3-12-9-8 12-1z" fill="{w}" stroke="{g}" stroke-width="2"/><circle cx="32" cy="29" r="3" fill="{c}"/>'),
 ('kunlun', '崑崙智造', 'corp', '#2FB59A', '#C9F5E8', '<path d="M8 48L24 20l8 12 6-8 18 24z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M24 20l4 7-4 2-4-2z" fill="{w}"/><path d="M38 24l3 4-3 1-3-1z" fill="{w}"/><path d="M14 52h36M22 56h20" stroke="{d}" stroke-width="2.6" stroke-linecap="round"/><circle cx="50" cy="52" r="2.4" fill="{d}"/>'),
 ('nectar', '蜜腺生技', 'corp', '#F2A93B', '#FFE3A8', ''.join(f'<path d="M{x} {y}l7 4v8l-7 4-7-4v-8z" fill="{{{k}}}" stroke="{{g}}" stroke-width="1.6"/>' for x, y, k in [(32, 14, 'c'), (24, 28, 'c'), (40, 28, 'd'), (32, 42, 'c')]) + '<path d="M32 30c3 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1-4 4-8z" fill="{w}"/>'),
 ('nightingale', '夜鶯系統', 'corp', '#45D6C5', '#1E6F7A', '<path d="M10 44c8 4 16 4 22 0s14-4 22 0" fill="none" stroke="{d}" stroke-width="4" stroke-linecap="round"/><path d="M14 30c6-10 18-14 26-10l8-4-3 7c4 6 2 14-6 16-8 2-18 0-25-9z" fill="{c}" stroke="{g}" stroke-width="2"/><circle cx="38" cy="24" r="2" fill="{g}"/><path d="M20 30l12 4" stroke="{w}" stroke-width="2.4" stroke-linecap="round"/>'),
 ('kaleido', '萬華鏡', 'corp', '#B39DF0', '#45D6C5', '<circle cx="32" cy="32" r="18" fill="{c}"/>' +
   ''.join(f'<path d="M32 32L{x1} {y1}L{x2} {y2}Z" fill="{col}" stroke="{{g}}" stroke-width="1.6"/>' for x1, y1, x2, y2, col in [(32, 14, 47.6, 23, '{d}'), (47.6, 41, 32, 50, '{w}'), (16.4, 41, 16.4, 23, '#F06AA0')]) + '<circle cx="32" cy="32" r="4" fill="{g}"/>'),
 ('eden', '伊甸園', 'corp', '#D9304F', '#6FD08C', '<path d="M32 20c-8-6-20-2-20 12 0 12 10 20 20 20s20-8 20-20c0-14-12-18-20-12z" fill="{c}"/><path d="M32 20c0-6 3-10 8-12" stroke="{d}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M36 14c4-4 10-3 12-1-3 3-8 4-12 1z" fill="{d}"/><circle cx="32" cy="32" r="4" fill="{g}"/><path d="M30 34h4l1 8h-6z" fill="{g}"/>'),
 ('blackspring', '黑泉能源', 'corp', '#2A2233', '#F2C14E', '<path d="M32 10c8 12 14 20 14 28a14 14 0 0 1-28 0c0-8 6-16 14-28z" fill="{d}" stroke="{g}" stroke-width="2"/><path d="M32 22c5 8 8 12 8 16a8 8 0 0 1-16 0c0-4 3-8 8-16z" fill="{c}"/><path d="M14 52q6-4 12 0t12 0 12 0" fill="none" stroke="{w}" stroke-width="2.6" stroke-linecap="round"/>'),
 ('angel', '天使急救', 'corp', '#F3E9FF', '#E8455B', '<path d="M30 30c-8-8-18-8-22-4 6 0 10 4 12 8-4-2-8-1-10 1 6 1 10 4 14 6z" fill="{c}"/><path d="M34 30c8-8 18-8 22-4-6 0-10 4-12 8 4-2 8-1 10 1-6 1-10 4-14 6z" fill="{c}"/><path d="M27 16h10v8h8v10h-8v8H27v-8h-8V24h8z" fill="{d}" stroke="{g}" stroke-width="2"/>'),
 ('orihime', '織女電子', 'corp', '#C9B8E8', '#F06AA0', '<path d="M14 18h36M14 46h36" stroke="{c}" stroke-width="4" stroke-linecap="round"/>' + ''.join(f'<path d="M{x} 18V46" stroke="{{w}}" stroke-width="1.6"/>' for x in range(18, 48, 5)) + '<path d="M20 32c6-6 18-6 24 0-6 6-18 6-24 0z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M48 10l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1z" fill="{d}"/>'),
 ('netvigil', '貞網局', 'corp', '#5F8FD9', '#C9DCF7', '<path d="M32 10l18 6v14c0 12-8 20-18 24-10-4-18-12-18-24V16z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M18 32c6-8 22-8 28 0-6 8-22 8-28 0z" fill="{w}"/><circle cx="32" cy="32" r="5" fill="{g}"/><circle cx="33.5" cy="30.5" r="1.6" fill="{d}"/>'),
 ('sweetheart', '甜心食品', 'corp', '#FF9EAE', '#6FD08C', '<path d="M32 50C16 40 12 32 12 25c0-7 5-11 11-11 4 0 7 2 9 5 2-3 5-5 9-5 6 0 11 4 11 11 0 7-4 15-20 25z" fill="{c}"/><path d="M32 19c-1 10 0 20 0 31" stroke="{g}" stroke-width="2" fill="none"/><path d="M34 16c2-5 8-7 12-6-2 4-7 6-12 6z" fill="{d}"/><path d="M18 24a5 5 0 0 1 5-5" stroke="{w}" stroke-width="2.4" fill="none" stroke-linecap="round"/>'),
 ('honey', '蜜糖會', 'street', '#F06AA0', '#F2C14E', '<path d="M32 48C18 40 14 32 14 26c0-6 4-10 10-10 4 0 6 2 8 5 2-3 4-5 8-5 6 0 10 4 10 10 0 6-4 14-18 22z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M26 28c0 6 2 12 6 16" stroke="{d}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="26" cy="26" r="3.4" fill="{d}"/><path d="M38 22l4 4" stroke="{w}" stroke-width="2.4" stroke-linecap="round"/>'),
 ('rouge', '胭脂堂', 'street', '#C2264B', '#F3E9FF', '<path d="M32 46L12 24a28 28 0 0 1 40 0z" fill="{c}" stroke="{g}" stroke-width="2"/>' + ''.join(f'<path d="M32 46L{x} {y}" stroke="{{g}}" stroke-width="1.4"/>' for x, y in [(18, 21), (25, 17), (32, 16), (39, 17), (46, 21)]) +
   ''.join(f'<circle cx="{x}" cy="{y}" r="2.6" fill="{{w}}"/>' for x, y in [(29, 26), (35, 26), (32, 22), (32, 30), (32, 26)]) + '<circle cx="32" cy="46" r="3" fill="{w}"/>'),
 ('chrome', '鉻娘子', 'street', '#BFC6D6', '#F06AA0', '<path d="M30 12c-10 0-16 8-16 18 0 8 4 14 10 18l2 6h4z" fill="{c}"/><path d="M34 12c10 0 16 8 16 18 0 8-4 14-10 18l-2 6h-4z" fill="#7C8598"/><path d="M34 22h10M34 28h12M34 34h8" stroke="{g}" stroke-width="2"/><circle cx="24" cy="28" r="3" fill="{g}"/><circle cx="40" cy="28" r="3" fill="{d}"/>'),
 ('tokko', '特攻姬', 'street', '#8E5BD9', '#F2C14E', '<path d="M14 34c0-12 8-20 18-20s18 8 18 20v6H14z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M18 34h28v6H18z" fill="{g}"/><path d="M34 16l-6 12h6l-4 12 10-15h-6l4-9z" fill="{d}"/><path d="M14 46h36" stroke="{w}" stroke-width="3" stroke-linecap="round"/>'),
 ('nora', '野良', 'street', '#FF9D4D', '#F3E9FF', '<path d="M16 46V24l6-10 6 8h8l6-8 6 10v22z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M24 32l4 2-4 2zM40 32l-4 2 4 2z" fill="{g}"/><path d="M30 40h4l-2 2z" fill="{w}"/><path d="M18 40l-6-1M18 43l-6 2M46 40l6-1M46 43l6 2" stroke="{w}" stroke-width="1.6"/>'),
 ('whisper', '牆語者', 'street', '#6B4FA8', '#45D6C5', '<path d="M14 12h10v40H14z" fill="#3A2D47" stroke="{g}" stroke-width="1.6"/><path d="M14 22h10M14 32h10M14 42h10" stroke="{g}" stroke-width="1.6"/><path d="M36 22c6 0 10 4 10 10s-4 8-6 10-2 6-6 6" fill="none" stroke="{c}" stroke-width="5" stroke-linecap="round"/><path d="M28 26c3 2 3 10 0 12M32 22c5 4 5 16 0 20" fill="none" stroke="{d}" stroke-width="2.4" stroke-linecap="round"/>'),
 ('rose', '野薔薇', 'street', '#B5462F', '#6FD08C', '<path d="M32 50V30" stroke="{d}" stroke-width="3"/><path d="M32 40l-6-3M32 44l6-3" stroke="{d}" stroke-width="2.4"/><path d="M27 36l-2-2M37 40l2-2" stroke="{w}" stroke-width="1.6"/><circle cx="32" cy="22" r="11" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M32 22c4-6 8-2 4 2-4 4-10 0-6-6 3-4 9-2 10 2" fill="none" stroke="{g}" stroke-width="1.8"/>'),
 ('festival', '祭典組', 'street', '#F3E9FF', '#E8455B', '<path d="M14 18l8 10h20l8-10-4 22c-2 6-8 10-14 10s-12-4-14-10z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M20 34l8 2M44 34l-8 2" stroke="{d}" stroke-width="3" stroke-linecap="round"/><path d="M30 42h4" stroke="{d}" stroke-width="2.4" stroke-linecap="round"/><path d="M14 18l4 8M50 18l-4 8" stroke="{d}" stroke-width="2.4"/>'),
 ('maids', '女僕公會', 'street', '#2A2233', '#F3E9FF', '<path d="M12 26c4-8 12-12 20-12s16 4 20 12l-4 2c-2-2-4-2-6 0-2-2-4-2-6 0-2-2-4-2-4-2s-2 0-4 2c-2-2-4-2-6 0-2-2-4-2-6 0z" fill="{d}" stroke="{g}" stroke-width="1.6"/><path d="M20 36h20v6a10 10 0 0 1-20 0z" fill="{d}"/><path d="M40 38c4 0 6 2 4 5" fill="none" stroke="{d}" stroke-width="2.4"/><path d="M24 33c1-3 3-3 4 0" stroke="#F06AA0" stroke-width="2" fill="none"/>'),
 ('strippers', '拆體客', 'street', '#8F98A8', '#F2C14E', '<path d="M18 46l20-20" stroke="{c}" stroke-width="7" stroke-linecap="round"/><path d="M38 26a8 8 0 1 1 8 8l-4-4z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M18 22l24 24" stroke="{w}" stroke-width="5" stroke-linecap="round"/><circle cx="17" cy="21" r="4" fill="{w}"/><circle cx="43" cy="47" r="4" fill="{w}"/><circle cx="46" cy="22" r="2.4" fill="{d}"/>'),
 ('doujin', '同人眾', 'street', '#45D6C5', '#F06AA0', '<path d="M12 18c6-2 14-2 20 2v30c-6-4-14-4-20-2z" fill="{w}" stroke="{g}" stroke-width="1.6"/><path d="M52 18c-6-2-14-2-20 2v30c6-4 14-4 20-2z" fill="{c}" stroke="{g}" stroke-width="1.6"/><path d="M44 8l6 6-12 16-6 2 2-6z" fill="{d}" stroke="{g}" stroke-width="1.6"/>'),
 ('guard', '親衛隊', 'street', '#FF4FA3', '#45D6C5', '<path d="M18 50L34 18" stroke="{c}" stroke-width="6" stroke-linecap="round"/><path d="M46 50L30 18" stroke="{d}" stroke-width="6" stroke-linecap="round"/><path d="M32 40c-6-4-8-7-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3-2 6-8 10z" fill="{w}" stroke="{g}" stroke-width="2"/>'),
 ('lonestar', '孤星連', 'street', '#5F7FB8', '#F3E9FF', '<circle cx="32" cy="32" r="18" fill="none" stroke="{c}" stroke-width="5"/>' + ''.join(f'<circle cx="32" cy="14" r="2.6" fill="{{c}}" transform="rotate({a} 32 32)"/>' for a in range(0, 360, 45)) + '<path d="M32 20l3.5 8 8.5.6-6.6 5.5 2.2 8.4L32 37.8l-7.6 4.7 2.2-8.4L20 28.6l8.5-.6z" fill="{d}"/>'),
 ('bare', '素體教', 'street', '#F3E9FF', '#F2C14E', '<circle cx="32" cy="22" r="9" fill="{d}"/><path d="M22 52V34c0-2 2-3 3-1v-6c0-2 3-2 3 0v-4c0-2 3-2 3 0v4c0-2 3-2 3 0v4c0-2 3-2 3 0v13l3-4c2-2 4 0 3 2l-5 10z" fill="{c}" stroke="{g}" stroke-width="1.8"/>'),
 ('banquet', '夜宴社', 'street', '#3A1F4A', '#B39DF0', '<path d="M22 14h20c0 12-4 18-10 18S22 26 22 14z" fill="{d}" stroke="{g}" stroke-width="2"/><path d="M32 32v12M24 48h16" stroke="{d}" stroke-width="3" stroke-linecap="round"/><path d="M22 20c-6-6-12-4-14 0 4-1 6 2 6 4 2-3 5-3 8-2zM42 20c6-6 12-4 14 0-4-1-6 2-6 4-2-3-5-3-8-2z" fill="{d}"/><path d="M26 18h12" stroke="#E8455B" stroke-width="3"/>'),
 ('police', '市警', 'public', '#3B5BA9', '#F2C14E', '<path d="M32 12l16 6v12c0 10-7 18-16 22-9-4-16-12-16-22V18z" fill="{d}" stroke="{g}" stroke-width="2"/><path d="M32 20l3 7 7 .5-5.5 4.5 2 7L32 35l-6.5 4 2-7-5.5-4.5 7-.5z" fill="{c}"/>'),
 ('suppress', '鎮溺隊', 'public', '#FF7DBD', '#F3E9FF', '<path d="M18 50L40 22" stroke="{d}" stroke-width="4" stroke-linecap="round"/><path d="M42 10l4 8 9 1-6 6 2 9-9-4-8 4 2-9-6-6 9-1z" fill="{c}" stroke="{g}" stroke-width="2"/><path d="M12 40c4-2 8-2 12 2M10 46c4-2 8 0 10 4" stroke="{c}" stroke-width="2.4" fill="none" stroke-linecap="round"/>'),
]

FRAME = {
    'corp': lambda c: f'<path d="M6 2h44l12 12v44a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#1E1627" stroke="{c}" stroke-width="2.4"/>',
    'street': lambda c: f'<circle cx="32" cy="32" r="29" fill="#1E1627" stroke="{c}" stroke-width="3.4"/><circle cx="32" cy="32" r="25" fill="none" stroke="{c}" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="2 3"/>',
    'public': lambda c: f'<path d="M32 2l26 9v20c0 16-11 27-26 31C17 58 6 47 6 31V11z" fill="#1E1627" stroke="{c}" stroke-width="2.4"/>',
}


def symbol(e):
    fid, name, kind, c, d, body = e
    inner = body.replace('{c}', c).replace('{d}', d).replace('{w}', '#F3E9FF').replace('{g}', GAP)
    rim = d if c in ('#2A2233', '#3A1F4A') else c  # 太暗的主色，外框改用副色
    return f'<symbol id="em-{fid}" viewBox="0 0 64 64"><title>{name}</title>{FRAME[kind](rim)}<g transform="translate(6.4 6.4) scale(.8)">{inner}</g></symbol>'


def main():
    syms = '\n'.join(symbol(e) for e in E)
    open(os.path.join(OUT, 'emblems-sprite.svg'), 'w', encoding='utf-8').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n{syms}\n</svg>\n')
    cols, cw, ch = 6, 190, 170
    rows = (len(E) + cols - 1) // cols
    Wd, Hd = cols * cw + 40, rows * ch + 120
    cells = []
    for i, (fid, name, kind, c, d, _) in enumerate(E):
        x, y = 20 + (i % cols) * cw, 100 + (i // cols) * ch
        kname = {'corp': '企業', 'street': '街頭', 'public': '公家'}[kind]
        cells.append(f'<use href="#em-{fid}" x="{x + cw / 2 - 48}" y="{y}" width="96" height="96"/>'
                     f'<use href="#em-{fid}" x="{x + cw / 2 + 52}" y="{y + 64}" width="28" height="28"/>'
                     f'<text x="{x + cw / 2}" y="{y + 118}" text-anchor="middle" font-size="15" font-weight="800" fill="#F3E9FF">{name}</text>'
                     f'<text x="{x + cw / 2}" y="{y + 138}" text-anchor="middle" font-size="11" fill="#8C7AA6">{fid} · {kname}</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Hd}" width="{Wd}" height="{Hd}" font-family="\'Noto Sans TC\',\'PingFang TC\',sans-serif">'
           f'<defs>{syms}</defs><rect width="{Wd}" height="{Hd}" fill="#17111F"/>'
           f'<text x="20" y="48" font-size="28" font-weight="900" fill="#F06AA0" letter-spacing="3">勢力徽記 v0</text>'
           f'<text x="20" y="74" font-size="13" fill="#8C7AA6">企業：斜切角方牌　街頭：圓形貼紙　公家：盾。剪影＋扁平，3～4 色，形狀之間留縫。右下是 28px 的樣子。</text>'
           + ''.join(cells) + '</svg>')
    open(os.path.join(OUT, 'emblems-v0.svg'), 'w', encoding='utf-8').write(svg)
    print('→', len(E), 'emblems')


if __name__ == '__main__':
    main()
