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


G = '#17111F'  # 縫

def star_pts(cx, cy, r1, r2, n=5, rot=-90):
    pts = []
    for k in range(n * 2):
        r = r1 if k % 2 == 0 else r2
        a = math.radians(rot + k * 180 / n)
        pts.append(f'{cx + r * math.cos(a):.1f} {cy + r * math.sin(a):.1f}')
    return 'M' + 'L'.join(pts) + 'Z'

# 星旗防務：模板噴漆的星與三道 V 形，單色，留橋（模板的連接處）
starbelle = (f'<g fill="#6F95E8"><path d="{star_pts(60, 42, 30, 12)}"/>'
             '<path d="M20 74L60 92L100 74V84L60 102L20 84Z"/><path d="M28 64L60 78L92 64V70L60 84L28 70Z"/></g>'
             f'<g stroke="{G}" stroke-width="3"><path d="M60 12V72M30 42H90"/><path d="M60 88V104M60 74V86"/></g>')

# 崑崙智造：玉璧，中間挖出崑崙的山峰，山頂一點雪。玉綠與淺玉。
kunlun = ('<circle cx="60" cy="60" r="52" fill="#2FB59A"/>'
          '<circle cx="60" cy="60" r="26" fill="#17111F"/>'
          '<path d="M34 66L46 48L53 57L62 40L74 58L80 52L86 66A26 26 0 0 1 34 66Z" fill="#C9F5E8"/>'
          '<circle cx="60" cy="60" r="44" fill="none" stroke="#17111F" stroke-width="2" stroke-dasharray="2 5"/>')

def hexp(cx, cy, r):
    return 'M' + 'L'.join(f'{cx + r * math.cos(math.radians(a)):.1f} {cy + r * math.sin(math.radians(a)):.1f}' for a in range(-90, 270, 60)) + 'Z'

# 蜜腺生技：藥廠的圓潤標誌。六角環＋一滴蜜，琥珀與白。
nectar = (f'<path d="{hexp(60, 60, 46)}" fill="none" stroke="#F2A93B" stroke-width="12" stroke-linejoin="round"/>'
          '<path d="M60 28C70 44 78 54 78 66a18 18 0 0 1-36 0c0-12 8-22 18-38z" fill="#F3E9FF"/>'
          '<path d="M52 66a8 8 0 0 0 8 8" fill="none" stroke="#F2A93B" stroke-width="4" stroke-linecap="round"/>')

# 伊甸園：奢華的細線徽。細圓、蘋果的輪廓、中間一個鑰匙孔，金。
eden = ('<g fill="none" stroke="#E6C27A" stroke-width="2.6" stroke-linecap="round">'
        '<circle cx="60" cy="60" r="50"/><circle cx="60" cy="60" r="45" stroke-width="1"/>'
        '<path d="M60 40C50 32 32 34 32 56c0 20 14 36 28 36s28-16 28-36c0-22-18-24-28-16z"/>'
        '<path d="M60 40c0-8 4-14 10-16"/><path d="M66 26c6-4 14-3 16 0-5 3-11 4-16 0z" fill="#E6C27A"/>'
        '</g><circle cx="60" cy="60" r="6" fill="#E6C27A"/><path d="M57 62h6l2 14h-10z" fill="#E6C27A"/>')

# 黑泉能源：工業的粗塊。金色方塊，挖出黑色的油滴與兩道泉。
blackspring = ('<rect x="16" y="16" width="88" height="88" rx="4" fill="#E2B13C"/>'
               f'<path d="M60 26C72 44 80 56 80 68a20 20 0 0 1-40 0c0-12 8-24 20-42z" fill="{G}"/>'
               '<path d="M24 92q9-6 18 0t18 0 18 0 18 0" fill="none" stroke="#17111F" stroke-width="5" stroke-linecap="round"/>'
               '<path d="M52 66a8 8 0 0 0 8 10" fill="none" stroke="#E2B13C" stroke-width="4" stroke-linecap="round"/>')

# 天使急救：醫療的乾淨標誌。一對三片羽的翼＋紅色圓角十字。
wing = ''.join(f'<rect x="{6 + k * 4}" y="{40 + k * 12}" width="{40 - k * 8}" height="9" rx="4.5" fill="#F3E9FF"/>' for k in range(3))
angel = (wing + f'<g transform="translate(120 0) scale(-1 1)">{wing}</g>'
         '<path d="M52 30h16v20h20v16H68v20H52V66H32V50h20z" fill="#E8455B" stroke="#17111F" stroke-width="3" stroke-linejoin="round" transform="translate(0 2)"/>')

# 織女電子：織女星。一顆柔和的四芒星，一條絲線斜斜穿過（挖空），單色薰衣草。
orihime = ('<path d="M60 8C63 40 80 57 112 60C80 63 63 80 60 112C57 80 40 63 8 60C40 57 57 40 60 8Z" fill="#C9B8E8"/>'
           '<path d="M30 84C46 74 74 50 90 36" fill="none" stroke="#17111F" stroke-width="6" stroke-linecap="round"/>'
           '<circle cx="96" cy="94" r="5" fill="#C9B8E8"/>')

# 貞網局：公文體的盾，挖出一隻眼，下面三道橫槓。單色鋼藍。
netvigil = ('<path d="M60 10L100 22V56C100 82 84 100 60 110C36 100 20 82 20 56V22Z" fill="#6E9AE0"/>'
            f'<path d="M30 50C42 34 78 34 90 50C78 66 42 66 30 50Z" fill="{G}"/><circle cx="60" cy="50" r="9" fill="#6E9AE0"/>'
            f'<path d="M38 76h44M42 86h36M48 96h24" stroke="{G}" stroke-width="5"/>')

# 甜心食品：花俏。桃子吉祥物：粉色漸層的桃子、綠葉、豆豆眼、腮紅。
sweetheart = ('<defs><radialGradient id="pch" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#FFE0E6"/><stop offset=".6" stop-color="#FF9EAE"/><stop offset="1" stop-color="#F06A8A"/></radialGradient></defs>'
              '<path d="M60 100C30 96 16 78 18 58c2-20 18-32 34-28 4 1 6 3 8 6 2-3 4-5 8-6 16-4 32 8 34 28 2 20-12 38-42 42z" fill="url(#pch)" stroke="#1E2346" stroke-width="3.5"/>'
              '<path d="M60 36c2-10 10-18 22-18-2 10-10 18-22 18z" fill="#6FD08C" stroke="#1E2346" stroke-width="3"/>'
              '<circle cx="46" cy="64" r="4" fill="#1E2346"/><circle cx="74" cy="64" r="4" fill="#1E2346"/>'
              '<path d="M54 74q6 5 12 0" fill="none" stroke="#1E2346" stroke-width="3" stroke-linecap="round"/>'
              '<ellipse cx="36" cy="74" rx="6" ry="3.5" fill="#FF6F91"/><ellipse cx="84" cy="74" rx="6" ry="3.5" fill="#FF6F91"/>')

# 蜜糖會：霓虹招牌的唇印。粉色的燈管輪廓加外暈。
lips = 'M14 60C26 44 42 38 52 46C56 42 64 42 68 46C78 38 94 44 106 60C94 80 78 88 60 88S26 80 14 60Z'
honey = ('<defs><filter id="neon" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
         f'<g filter="url(#neon)" fill="none" stroke="#FF4FA3" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><path d="{lips}"/><path d="M14 60C40 64 80 64 106 60"/></g>'
         '<g fill="none" stroke="#FFD0E6" stroke-width="1.6"><path d="M14 60C26 44 42 38 52 46C56 42 64 42 68 46C78 38 94 44 106 60"/></g>')

# 特攻姬：黑色的尖角菱盾，金線框，裡面是白色毛筆字的「夜露死苦」。暴走族的味道，所以這一個用字。
_G = __import__('json').load(open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'yoroshiku-glyphs.json'), encoding='utf-8'))
def brush(ch, x, y, size):
    """毛筆字（Yuji Boku，OFL；tools/art/yoroshiku-glyphs.json）轉成路徑，(x, y) 是字的左上角。"""
    k = size / 1000
    return f'<path transform="translate({x} {y}) scale({k})" d="{_G[ch]["d"]}"/>'

tokko = ('<path d="M60 4L108 32L92 108L60 96L28 108L12 32Z" fill="#141018" stroke="#E2B13C" stroke-width="3"/>'
         '<path d="M60 14L98 36L84 98L60 88L36 98L22 36Z" fill="none" stroke="#E2B13C" stroke-width="1.4"/>'
         + ''.join(f'<g fill="{f}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round">' + brush('夜', 30, 26, 30) + brush('露', 60, 26, 30) + brush('死', 30, 58, 30) + brush('苦', 60, 58, 30) + '</g>' for f, c, w in (('#141018', '#141018', 70), ('#F3E9FF', '#F3E9FF', 22))) +
         '<path d="M54 96L60 104L66 96" fill="#E2B13C"/>')

# 牆語者：細線的秘儀符號。圓、倒三角、一道往裡捲的耳形螺旋、放射的短線。單色暗紫（提亮一點才看得見）。
spiral = 'M60 40c12 0 20 8 20 18s-8 16-16 16-12-6-12-12 4-8 8-8 6 3 6 6'
whisper = ('<g fill="none" stroke="#9B7BE6" stroke-width="3" stroke-linecap="round">'
           '<circle cx="60" cy="60" r="44"/><path d="M24 40H96L60 102Z"/>'
           f'<path d="{spiral}" stroke-width="4"/>'
           + ''.join(f'<path d="M60 8V14" transform="rotate({a} 60 60)"/>' for a in range(0, 360, 30)) + '</g>')

# 野薔薇：生鏽鐵板切出的薔薇。圓形鐵板（鏽紅），薔薇是挖空的，四顆螺栓孔。
rose = ('<circle cx="60" cy="60" r="50" fill="#B5462F"/>'
        f'<g fill="{G}"><circle cx="60" cy="48" r="20"/><path d="M58 66h4v34h-4z"/><path d="M60 82c-10-2-16 2-18 8 8 2 14 0 18-8z"/><path d="M60 76c10-2 16 2 18 8-8 2-14 0-18-8z"/>'
        + ''.join(f'<circle cx="{60 + 42 * math.cos(math.radians(a))}" cy="{60 + 42 * math.sin(math.radians(a))}" r="3.4"/>' for a in (45, 135, 225, 315)) + '</g>'
        '<path d="M60 48c6-8 12-2 6 4-6 6-14 0-8-8 5-6 13-3 14 3" fill="none" stroke="#B5462F" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M22 40c8 4 10 10 6 14M92 94c-6-6-4-12 2-14" stroke="#7A2E20" stroke-width="3" fill="none"/>')

# 祭典組：花俏。狐面：白色的面具、紅色的紋、金色的點綴。
festival = ('<path d="M20 20L44 44H76L100 20L94 70C90 92 76 106 60 106S30 92 26 70Z" fill="#F3E9FF" stroke="#17111F" stroke-width="3" stroke-linejoin="round"/>'
            '<path d="M26 28L40 46M94 28L80 46" stroke="#E8455B" stroke-width="5" stroke-linecap="round"/>'
            '<path d="M38 62q8-6 16 2M82 62q-8-6-16 2" stroke="#E8455B" stroke-width="5" fill="none" stroke-linecap="round"/>'
            '<path d="M56 90h8" stroke="#E8455B" stroke-width="5" stroke-linecap="round"/>'
            '<path d="M60 52l4 8-4 8-4-8z" fill="#F2C14E"/><circle cx="34" cy="80" r="3" fill="#F2C14E"/><circle cx="86" cy="80" r="3" fill="#F2C14E"/>')

# 女僕公會：公會紋章。白色的盾形外框，裡面上面是荷葉邊頭飾，下面是一只茶杯。黑白。
frill = ''.join(f'<circle cx="{x}" cy="40" r="6"/>' for x in range(34, 90, 10))
maids = ('<path d="M60 8L102 20V58C102 86 84 104 60 112C36 104 18 86 18 58V20Z" fill="#F3E9FF"/>'
         f'<g fill="{G}"><path d="M30 40C34 26 46 20 60 20S86 26 90 40Z"/>{frill}'
         '<path d="M40 62H80V72A20 20 0 0 1 40 72Z"/><path d="M78 66c10-2 12 10 2 12" fill="none" stroke="#17111F" stroke-width="4"/>'
         '<path d="M36 96H84" stroke="#17111F" stroke-width="5" stroke-linecap="round"/></g>')

# 拆體客：廢料貼紙。警示斜紋的圓角框，中間是扳手壓著一顆螺栓。灰與警示黃。
strippers = ('<defs><pattern id="hz" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="14" fill="#F2C14E"/><rect x="7" width="7" height="14" fill="#17111F"/></pattern></defs>'
             '<rect x="10" y="10" width="100" height="100" rx="16" fill="url(#hz)"/><rect x="22" y="22" width="76" height="76" rx="10" fill="#8F98A8"/>'
             f'<path d="M36 84L72 48" stroke="{G}" stroke-width="10" stroke-linecap="round"/><path d="M70 50a14 14 0 1 1 14 14l-7-7z" fill="{G}"/>'
             f'<path d="{hexp(42, 78, 11)}" fill="#F2C14E" stroke="{G}" stroke-width="3"/><circle cx="42" cy="78" r="4" fill="{G}"/>')

# 同人眾：手繪的貼紙。白色的貼紙邊，打開的本子（青）與一支筆尖（粉）。
doujin = ('<path d="M18 30Q14 18 26 16L92 12Q106 12 106 26L108 92Q108 106 94 106L26 108Q12 108 12 94Z" fill="#F3E9FF"/>'
          '<path d="M24 40Q42 34 60 42V96Q42 88 24 94Z" fill="#45D6C5" stroke="#17111F" stroke-width="3" stroke-linejoin="round"/>'
          '<path d="M96 40Q78 34 60 42V96Q78 88 96 94Z" fill="#7EE6D9" stroke="#17111F" stroke-width="3" stroke-linejoin="round"/>'
          '<path d="M90 16L104 30L78 62L66 66L70 54Z" fill="#F06AA0" stroke="#17111F" stroke-width="3" stroke-linejoin="round"/><circle cx="74" cy="58" r="2.4" fill="#17111F"/>')

# 親衛隊：花俏。一顆愛心，後面交叉兩支螢光棒，四色螢光與外暈。
guard = ('<defs><filter id="glw" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
         '<linearGradient id="gh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset="1" stop-color="#FFB0E0"/></linearGradient></defs>'
         '<g filter="url(#glw)"><path d="M22 100L70 26" stroke="#45D6C5" stroke-width="9" stroke-linecap="round"/><path d="M98 100L50 26" stroke="#F2C14E" stroke-width="9" stroke-linecap="round"/></g>'
         '<path d="M60 96C30 76 24 60 24 50a16 16 0 0 1 36-6 16 16 0 0 1 36 6c0 10-6 26-36 46z" fill="url(#gh)" stroke="#17111F" stroke-width="3.5"/>'
         '<path d="M38 50a8 8 0 0 1 8-8" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round"/>'
         '<path d="M96 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#B39DF0"/><path d="M20 22l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="#45D6C5"/>')

# 孤星連：警長星徽。藍色的圓章、白色的六角星，星尖是圓球。
pts6 = [(60 + 34 * math.cos(math.radians(-90 + k * 60)), 60 + 34 * math.sin(math.radians(-90 + k * 60))) for k in range(6)]
lonestar = ('<circle cx="60" cy="60" r="52" fill="#4F72B8"/><circle cx="60" cy="60" r="46" fill="none" stroke="#F3E9FF" stroke-width="2"/>'
            f'<path d="{star_pts(60, 60, 34, 17, 6)}" fill="#F3E9FF" stroke="#4F72B8" stroke-width="2"/>'
            + ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#F3E9FF"/>' for x, y in pts6) + '<circle cx="60" cy="60" r="7" fill="#4F72B8"/>')

# 素體教：墨線的手掌與圓。白色的粗筆畫手掌，掌上一個紅色的圓。
bare = ('<g fill="none" stroke="#F3E9FF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M42 104V62M42 62V30M54 60V22M66 60V24M78 64V34M42 76C36 70 28 66 24 72L40 98C46 106 54 108 66 108C80 108 86 98 86 84V66"/></g>'
        '<circle cx="62" cy="80" r="10" fill="#E8455B"/>')

# 夜宴社：深紅的新月，月彎裡飛著一隻蝙蝠。兩種紅。
banquet = ('<path d="M74 10A50 50 0 1 0 110 74A40 40 0 1 1 74 10Z" fill="#B0263F"/>'
           '<g transform="translate(64 58) scale(1.7) translate(-60 -56)"><path d="M38 56C44 50 48 50 52 54L54 46L58 52H62L66 46L68 54C72 50 76 50 82 56C76 56 74 60 74 64C70 60 66 62 64 66L60 62L56 66C54 62 50 60 46 64C46 60 44 56 38 56Z" fill="#E8455B" stroke="#17111F" stroke-width="1.6" stroke-linejoin="round"/></g>')

# 市警：警徽。金色的徽章盾，藏青的五角星。
police = ('<path d="M60 8C72 18 88 20 102 18C104 60 92 92 60 112C28 92 16 60 18 18C32 20 48 18 60 8Z" fill="#E2B13C" stroke="#17111F" stroke-width="3"/>'
          f'<path d="{star_pts(60, 58, 28, 12)}" fill="#26387A"/><circle cx="60" cy="58" r="6" fill="#E2B13C"/>')

# 鎮溺隊：花俏。魔法少女的徽章：粉色漸層的愛心、白色的翼、中間的星、閃光。
suppress = ('<defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB0D8"/><stop offset="1" stop-color="#F06AA0"/></linearGradient></defs>'
            '<path d="M44 56C30 40 12 40 6 50c8 0 14 4 16 10-6-2-12 0-14 4 10 0 18 2 24 8z" fill="#F3E9FF" stroke="#17111F" stroke-width="2.4"/>'
            '<path d="M76 56C90 40 108 40 114 50c-8 0-14 4-16 10 6-2 12 0 14 4-10 0-18 2-24 8z" fill="#F3E9FF" stroke="#17111F" stroke-width="2.4"/>'
            '<path d="M60 102C38 86 30 72 30 60a15 15 0 0 1 30-6 15 15 0 0 1 30 6c0 12-8 26-30 42z" fill="url(#mg)" stroke="#17111F" stroke-width="3.5"/>'
            f'<path d="{star_pts(60, 68, 14, 6)}" fill="#F3E9FF"/>'
            '<path d="M60 10l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#F2C14E"/>')

ALL = [  # (id, 名字, 一句方向, 內容)
    ('hizakura', '緋櫻重工', '戰國家紋：丸に櫻', hizakura),
    ('starbelle', '星旗防務', '模板噴漆的星與 V 形', starbelle),
    ('kunlun', '崑崙智造', '玉璧與崑崙的山峰', kunlun),
    ('nectar', '蜜腺生技', '六角環與一滴蜜', nectar),
    ('nightingale', '夜鶯系統', '粗硬的幾何翼，讀成 N', nightingale),
    ('kaleido', '萬華鏡', '六重對稱的萬花筒', kaleido),
    ('eden', '伊甸園', '細線的蘋果與鑰匙孔', eden),
    ('blackspring', '黑泉能源', '金色方塊挖出油滴', blackspring),
    ('angel', '天使急救', '一對翼與紅十字', angel),
    ('orihime', '織女電子', '四芒星與穿過的絲線（織女星）', orihime),
    ('netvigil', '貞網局', '盾、眼與三道槓', netvigil),
    ('sweetheart', '甜心食品', '桃子吉祥物', sweetheart),
    ('honey', '蜜糖會', '霓虹燈管的唇印', honey),
    ('rouge', '胭脂堂', '花牌的梅', rouge),
    ('chrome', '鉻娘子', '半機娘側臉與齒輪', chrome),
    ('tokko', '特攻姬', '菱盾與「夜露死苦」', tokko),
    ('nora', '野良', '噴漆模板的貓', nora),
    ('whisper', '牆語者', '細線的秘儀符號', whisper),
    ('rose', '野薔薇', '鏽鐵板挖空的薔薇', rose),
    ('festival', '祭典組', '狐面', festival),
    ('maids', '女僕公會', '頭飾與茶杯的紋章', maids),
    ('strippers', '拆體客', '警示斜紋的廢料貼紙', strippers),
    ('doujin', '同人眾', '手繪貼紙：本子與筆尖', doujin),
    ('guard', '親衛隊', '愛心與交叉的螢光棒', guard),
    ('lonestar', '孤星連', '警長星徽', lonestar),
    ('bare', '素體教', '墨線的手掌與紅圓', bare),
    ('banquet', '夜宴社', '新月與蝙蝠', banquet),
    ('police', '市警', '金色警徽與藏青星', police),
    ('suppress', '鎮溺隊', '魔法少女的愛心翼徽章', suppress),
]


def uniq(body, fid):
    """每個徽記的 id 加上前綴，避免同一頁裡互相蓋掉。"""
    import re
    ids = re.findall(r'id="([^"]+)"', body)
    for x in ids:
        body = body.replace(f'id="{x}"', f'id="{fid}-{x}"').replace(f'url(#{x})', f'url(#{fid}-{x})').replace(f'href="#{x}"', f'href="#{fid}-{x}"')
    return body


def main():
    import os
    syms = '\n'.join(f'<symbol id="em-{fid}" viewBox="0 0 120 120"><title>{name}</title>{uniq(body, fid)}</symbol>' for fid, name, _, body in ALL)
    open(os.path.join(os.path.dirname(OUT), 'emblems-sprite.svg'), 'w', encoding='utf-8').write(f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n{syms}\n</svg>\n')
    cols, cw, ch = 6, 200, 210
    rows = (len(ALL) + cols - 1) // cols
    Wd, Hd = cols * cw + 40, rows * ch + 110
    cells = []
    for i, (fid, name, note, _) in enumerate(ALL):
        x, y = 20 + (i % cols) * cw, 96 + (i // cols) * ch
        cells.append(f'<use href="#em-{fid}" x="{x + cw / 2 - 55}" y="{y}" width="110" height="110"/>'
                     f'<use href="#em-{fid}" x="{x + cw / 2 + 60}" y="{y + 82}" width="28" height="28"/>'
                     f'<text x="{x + cw / 2}" y="{y + 138}" text-anchor="middle" font-size="16" font-weight="800" fill="#F3E9FF">{name}</text>'
                     f'<text x="{x + cw / 2}" y="{y + 160}" text-anchor="middle" font-size="12" fill="#8C7AA6">{note}</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {Wd} {Hd}" width="{Wd}" height="{Hd}" font-family="\'Noto Sans TC\',\'PingFang TC\',sans-serif">'
           f'<defs>{syms}</defs><rect width="{Wd}" height="{Hd}" fill="#17111F"/>'
           f'<text x="20" y="46" font-size="28" font-weight="900" fill="#F06AA0" letter-spacing="3">勢力徽記 v1</text>'
           f'<text x="20" y="72" font-size="13" fill="#8C7AA6">每個勢力用自己的風格；企業多半單色或雙色，花俏的才用多色；除了特攻姬的「夜露死苦」不用字。右下是 28px 的樣子。</text>'
           + ''.join(cells) + '</svg>')
    open(os.path.join(os.path.dirname(OUT), 'emblems-v1.svg'), 'w', encoding='utf-8').write(svg)
    print('→ emblems-v1.svg, emblems-sprite.svg', len(ALL))


if __name__ == '__main__':
    main()
