#!/usr/bin/env python3
"""勢力徽記 v1 的樣本：每個勢力各自的風格，不套同一個框。
企業多半是單色或雙色；花俏的勢力（萬華鏡、甜心、親衛隊、鎮溺隊、祭典組）才用多色。
這一版只畫六個樣本確認方向：緋櫻（戰國家紋）、夜鶯（粗硬的幾何標誌）、胭脂堂（花牌）、鉻娘子（車隊背章）、野良（噴漆模板）、萬華鏡（花俏）。
輸出 docs/art/style/emblems-v1-samples.svg
用法：python3 tools/art/gen_emblems_v1.py"""
import math, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'docs', 'art', 'style', 'emblems-v1-samples.svg')


def rot(body, n, cx=60, cy=60):
    return ''.join(f'<g transform="rotate({i * 360 / n} {cx} {cy})">{body}</g>' for i in range(n))


# 緋櫻重工：丸に櫻的家紋。單色，靠負空間分出花瓣。
petal = '<path d="M60 58C51 52 47 40 50 29L56 33L60 25L64 33L70 29C73 40 69 52 60 58Z"/>'
hizakura = (f'<g fill="#E8455B"><circle cx="60" cy="60" r="52" fill="none" stroke="#E8455B" stroke-width="9"/>'
            f'{rot(petal, 5)}<circle cx="60" cy="60" r="7" fill="#17111F"/>'
            + ''.join(f'<circle cx="{60 + 11 * math.cos(math.radians(a))}" cy="{60 + 11 * math.sin(math.radians(a))}" r="2.2" fill="#17111F"/>' for a in range(-90, 270, 72)) + '</g>')

# 夜鶯系統：粗硬的幾何標誌，單色。兩片斜切的翼加一個喙，同時讀得出一個 N。
nightingale = ('<g fill="#45D6C5">'
               '<path d="M14 84L50 30H70L34 84Z"/>'
               '<path d="M44 96L80 42H100L64 96Z"/>'
               '<path d="M74 30L110 18L96 40H80Z"/>'
               '<path d="M12 96H40L36 102H8Z"/></g>')

# 胭脂堂：花牌（梅）的樣子。三色：緋紅底、黑枝、白梅，加一條短冊。
plum = '<circle cx="0" cy="-7" r="6"/>'
def blossom(x, y, s=1):
    return f'<g transform="translate({x} {y}) scale({s})" fill="#F3E9FF">{"".join(f"<g transform=\'rotate({a})\'>{plum}</g>" for a in range(0, 360, 72))}<circle r="3" fill="#C2264B"/></g>'
rouge = ('<rect x="22" y="6" width="76" height="108" rx="6" fill="#C2264B"/>'
         '<rect x="28" y="12" width="64" height="96" rx="3" fill="none" stroke="#17111F" stroke-width="2"/>'
         '<path d="M30 100C46 86 50 70 62 58S84 40 88 26" fill="none" stroke="#17111F" stroke-width="7" stroke-linecap="round"/>'
         '<path d="M58 62C50 54 46 46 48 38" fill="none" stroke="#17111F" stroke-width="4" stroke-linecap="round"/>'
         + blossom(78, 34) + blossom(50, 40, .8) + blossom(64, 70, .9) + blossom(40, 84, .7) +
         '<rect x="34" y="16" width="14" height="40" rx="2" fill="#F3E9FF"/><path d="M41 22v28" stroke="#C2264B" stroke-width="2.4"/>')

# 鉻娘子：不用字。半張女性側臉，後腦是齒輪，鉻色加一點粉。
chrome = ('<defs><linearGradient id="chr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#9AA3B5"/><stop offset=".55" stop-color="#5A6275"/><stop offset="1" stop-color="#D5DBE6"/></linearGradient></defs>'
          '<rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(-40)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(-18)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(4)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(26)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(48)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(70)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(92)"/><rect x="-5" y="-38" width="10" height="12" rx="2" fill="url(#chr)" transform="translate(78 54) rotate(114)"/>'
          '<path d="M72 18C52 18 40 32 40 48L32 60L40 62L38 70L42 72L40 78C42 86 50 88 58 86L60 104H90L88 86C100 78 106 64 104 48C102 30 90 18 72 18Z" fill="url(#chr)" stroke="#17111F" stroke-width="3"/>'
          '<circle cx="78" cy="54" r="15" fill="none" stroke="#17111F" stroke-width="3"/><circle cx="78" cy="54" r="5" fill="#17111F"/>'
          '<path d="M66 22C64 40 64 70 70 90" fill="none" stroke="#17111F" stroke-width="3"/>'
          '<path d="M44 46h10" stroke="#F06AA0" stroke-width="5" stroke-linecap="round"/>'
          '<path d="M64 96v10M72 96v10M80 96v10" stroke="#17111F" stroke-width="2.4"/>')

# 野良：噴漆的模板貓，橘色，有滴下來的漆與飛沫。
nora = ('<g fill="#FF9D4D"><path d="M28 86V44L36 22L50 38H70L84 22L92 44V86Z"/>'
        '<path d="M34 86v10a2 2 0 0 0 4 0V86M58 86v16a2 2 0 0 0 4 0V86M80 86v7a2 2 0 0 0 4 0V86"/>'
        + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y, r in [(22, 30, 1.6), (98, 34, 2), (100, 70, 1.4), (18, 72, 1.8), (26, 100, 1.2), (96, 98, 1.6), (106, 52, 1)]) +
        '</g><g fill="#17111F"><path d="M42 56l10 4-10 4z"/><path d="M78 56l-10 4 10 4z"/><path d="M56 72h8l-4 4z"/>'
        '<path d="M40 50h40v3H40z" opacity=".0"/></g>'
        '<path d="M30 78h60" stroke="#17111F" stroke-width="3" stroke-dasharray="8 4"/>')

# 萬華鏡：花俏，六重對稱的萬花筒，多色漸層。
kseg = '<path d="M60 60L60 10L88 32Z" fill="url(#k1)"/><path d="M60 60L88 32L84 60Z" fill="url(#k2)"/>'
kaleido = ('<defs><linearGradient id="k1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7DBD"/><stop offset="1" stop-color="#B39DF0"/></linearGradient>'
           '<linearGradient id="k2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#45D6C5"/><stop offset="1" stop-color="#F2C14E"/></linearGradient></defs>'
           + rot(kseg, 6) + '<circle cx="60" cy="60" r="12" fill="#17111F"/><circle cx="60" cy="60" r="6" fill="#F3E9FF"/>')

SAMPLES = [
    ('緋櫻重工', '戰國家紋：丸に櫻，單色', hizakura),
    ('夜鶯系統', '粗硬的幾何標誌，單色；兩片翼讀成 N', nightingale),
    ('胭脂堂', '花牌的梅，三色（緋、黑、白）', rouge),
    ('鉻娘子', '半機娘側臉，後腦是齒輪；鉻色＋一點粉', chrome),
    ('野良', '噴漆模板貓，單色加漆滴', nora),
    ('萬華鏡', '花俏：六重對稱的萬花筒', kaleido),
]


def main():
    cw, ch = 300, 300
    Wd, Hd = cw * 3 + 40, ch * 2 + 110
    cells = []
    for i, (name, note, body) in enumerate(SAMPLES):
        x, y = 20 + (i % 3) * cw, 90 + (i // 3) * ch
        cells.append(f'<g transform="translate({x + cw / 2 - 80} {y}) scale(1.333)">{body}</g>'
                     f'<g transform="translate({x + cw / 2 + 70} {y + 130}) scale(.3)">{body.replace(chr(105)+"d=", "data-id=")}</g>'
                     f'<text x="{x + cw / 2}" y="{y + 190}" text-anchor="middle" font-size="18" font-weight="800" fill="#F3E9FF">{name}</text>'
                     f'<text x="{x + cw / 2}" y="{y + 214}" text-anchor="middle" font-size="13" fill="#8C7AA6">{note}</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Hd}" width="{Wd}" height="{Hd}" font-family="\'Noto Sans TC\',\'PingFang TC\',sans-serif">'
           f'<rect width="{Wd}" height="{Hd}" fill="#17111F"/>'
           f'<text x="20" y="44" font-size="26" font-weight="900" fill="#F06AA0" letter-spacing="3">勢力徽記 v1・方向樣本</text>'
           f'<text x="20" y="70" font-size="13" fill="#8C7AA6">每個勢力用自己的風格；企業多半單色或雙色，花俏的勢力才用多色。右下是縮小的樣子。</text>'
           + ''.join(cells) + '</svg>')
    open(OUT, 'w', encoding='utf-8').write(svg)
    print('→', OUT)


if __name__ == '__main__':
    main()
