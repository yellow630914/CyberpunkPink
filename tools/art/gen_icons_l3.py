#!/usr/bin/env python3
"""第 3 層圖標：每一件物品、每一個技能各一個。
主體圖庫在 tools/art/subjects/（weapons、wear、parts、skills），一個主體畫一次；
每件物品再依名字與牌子決定配色、依等級加點綴、獨特物品加一圈淡紫的光，組成自己的圖標。
輸出：
  docs/art/style/icons-l3-sprite.svg   主體 <symbol id="sub-…"> ＋ 每一件 <symbol id="it_…">／<symbol id="sk_…">
  docs/mockups/icons-l3.html          原型裡可以搜尋、照分類瀏覽的總覽
id 與 docs/art/icons/items.csv、skills.csv 的 id 一致（由名字算出）。
用法：python3 tools/art/gen_icons_l3.py        （主體改了加 --measure 重新量置中）"""
import csv, hashlib, html, importlib, json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'docs', 'art', 'icons')
STYLE_DIR = os.path.join(ROOT, 'docs', 'art', 'style')
CENTERS_PATH = os.path.join(STYLE_DIR, 'icon-l3-centers.json')
S_CSS = '.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}'

# 牌子的配色（--b 主體、--c 亮部）；名字裡有顏色字的話以名字為準
BRAND = {
    '緋櫻': ('#E0475B', '#FFE3E8'), '星旗': ('#6F7F4E', '#E4E8D0'), '崑崙': ('#3FA37A', '#DDF5E8'), '蜜腺': ('#E0A23A', '#FFF0CF'),
    '夜鶯': ('#2FA6A0', '#D8F5F2'), '萬華鏡': ('#B07BE8', '#F4E7FF'), '伊甸園': ('#C9A23E', '#2A2230'), '黑泉': ('#5B6170', '#D5D9E0'),
    '織女': ('#9C8BE0', '#EFEAFF'), '甜心': ('#F59AC0', '#FFF0F6'), '同人': ('#E89A5C', '#FFF1E2'), '聖堂': ('#7A4FA8', '#EADCF7'),
    '鉻娘子': ('#A9B4C2', '#F3F6FA'), '胭脂堂': ('#C23B3B', '#FBE3D6'), '拆體客': ('#8C7356', '#EBDDCB'), '天使': ('#BFD3E6', '#FFFFFF'),
    '貞網局': ('#4D6E96', '#DCE6F2'), '特攻姬': ('#2A2230', '#E8C35A'), '蕾絲': ('#E07BB0', '#FFF0F8'),
}
COLOR_WORDS = [  # 先比對的先用
    ('黑', ('#3A3046', '#B9A9CC')), ('白', ('#E9E3F2', '#FFFFFF')), ('粉', ('#F28DB8', '#FFE6F1')), ('緋', ('#E0475B', '#FFE3E8')),
    ('紅', ('#E0475B', '#FFE3E8')), ('赤', ('#E0475B', '#FFE3E8')), ('櫻', ('#F4A3C0', '#FFF0F5')), ('金', ('#E3B341', '#FFF3CC')),
    ('銀', ('#B8C2D0', '#F5F7FA')), ('鉻', ('#A9B4C2', '#F3F6FA')), ('藍', ('#5C8FE0', '#E3EDFF')), ('青', ('#2FB3A6', '#DDF7F3')),
    ('翠', ('#3FA37A', '#DDF5E8')), ('綠', ('#5DB36A', '#E2F5E5')), ('紫', ('#9A6FD6', '#F0E7FF')), ('橘', ('#F08A3C', '#FFEBDB')),
    ('黃', ('#E8C24A', '#FFF6D6')), ('棕', ('#8C6A4F', '#EEDFD0')), ('灰', ('#8A8796', '#E6E4EC')), ('透明', ('#BFE7F0', '#FFFFFF')),
]
FALLBACK = [('#8E7CC3', '#F3E9FF'), ('#6FA8DC', '#E8F2FC'), ('#45B8A8', '#E0F7F3'), ('#C98BD8', '#F7E8FB'), ('#7E8BB8', '#E9ECF7'),
            ('#D58AA8', '#FCEAF1'), ('#9DA86A', '#F0F3E2'), ('#B89A72', '#F5EDE2')]
# 名字裡的花紋字 → 右下角一個小花紋（在圖標上面）
MOTIF = [('櫻', 'sakura'), ('蕾絲', 'lace'), ('心', 'heart'), ('星', 'star'), ('月', 'moon'), ('蝶', 'butterfly'), ('貓', 'cat'), ('雪', 'snow'), ('冰', 'snow'), ('火', 'flame'), ('炎', 'flame')]
MOTIF_SVG = {
    'sakura': ''.join(f'<ellipse cx="0" cy="-8" rx="6" ry="9" fill="#F7B6CF" stroke="#17111F" stroke-width="2.5" transform="rotate({a})"/>' for a in range(0, 360, 72)) + '<circle r="3.5" fill="#F06AA0"/>',
    'lace': '<circle r="13" fill="#FFFFFF" stroke="#17111F" stroke-width="3"/>' + ''.join(f'<circle cx="{9 * __import__("math").cos(a / 57.3):.1f}" cy="{9 * __import__("math").sin(a / 57.3):.1f}" r="2.4" fill="#17111F"/>' for a in range(0, 360, 45)),
    'heart': '<path d="M0 12C-16 1-14-12-6-12Q-2-12 0-7Q2-12 6-12C14-12 16 1 0 12Z" fill="#F06AA0" stroke="#17111F" stroke-width="3"/>',
    'star': '<path d="M0-14l4.1 8.3 9.2 1.3-6.6 6.5 1.6 9.1L0 6.9l-8.3 4.3 1.6-9.1-6.6-6.5 9.2-1.3z" fill="#F2C14E" stroke="#17111F" stroke-width="3"/>',
    'moon': '<path d="M4-13A13 13 0 1 0 10 9A10 10 0 1 1 4-13Z" fill="#F3E9FF" stroke="#17111F" stroke-width="3"/>',
    'butterfly': '<path d="M0 0C-6-14-18-12-14-2C-18 6-8 12 0 4C8 12 18 6 14-2C18-12 6-14 0 0Z" fill="#B39DF0" stroke="#17111F" stroke-width="3"/>',
    'cat': '<path d="M-12 10V-12L-5-5H5L12-12V10Z" fill="#F3E9FF" stroke="#17111F" stroke-width="3"/><circle cx="-4" cy="1" r="2" fill="#17111F"/><circle cx="4" cy="1" r="2" fill="#17111F"/>',
    'snow': '<g stroke="#17111F" stroke-width="6" stroke-linecap="round"><path d="M0-12V12M-10-6L10 6M-10 6L10-6"/></g><g stroke="#BFE7F0" stroke-width="3" stroke-linecap="round"><path d="M0-12V12M-10-6L10 6M-10 6L10-6"/></g>',
    'flame': '<path d="M0 13C-11 13-13 3-8-5C-6 0-3 0-3-3C-4-8 0-12 3-14C3-7 11-4 9 5C8 10 5 13 0 13Z" fill="#FF8A3D" stroke="#17111F" stroke-width="3"/>',
}
SPARK = '<path d="M0-12Q2-2 12 0Q2 2 0 12Q-2 2-12 0Q-2-2 0-12Z" fill="#FFF3B0" stroke="#17111F" stroke-width="3"/>'


def h(s, n):
    return int(hashlib.md5(s.encode()).hexdigest(), 16) % n


def load_subjects():
    subs, item_map, skill_map = {}, {}, {}
    for mod in ('weapons', 'wear', 'parts', 'skills'):
        try:
            m = importlib.import_module('subjects.' + mod)
        except ModuleNotFoundError:
            print('（缺主體檔）', mod)
            continue
        for k, v in m.SUBJECTS.items():
            subs[('sk:' if mod == 'skills' else '') + k] = v
        item_map.update(getattr(m, 'ITEM_SUBJECT', {}))
        skill_map.update(getattr(m, 'SKILL_SUBJECT', {}))
    return subs, item_map, skill_map


def measure(subs):
    """量每個主體的幾何外框，存成 {主體: [cx, cy, w, h]}。"""
    keys = list(subs)
    doc = '<!doctype html><body>' + ''.join(
        f'<svg width="200" height="200" viewBox="0 0 200 200" style="--o:#000;--a:#f0a;--b:#888;--c:#eee"><defs><style>{S_CSS}</style></defs><g data-k="{k}">{subs[k]}</g></svg>'
        for k in keys) + '</body>'
    tmp = tempfile.mkdtemp()
    open(os.path.join(tmp, 'm.html'), 'w', encoding='utf-8').write(doc)
    js = ("const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();"
          f"await p.goto('file://{tmp}/m.html');"
          "const r=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('g[data-k]')].map((g,i)=>{const x=g.getBBox();return [i,[x.x+x.width/2,x.y+x.height/2,x.width,x.height].map(v=>Math.round(v*10)/10)]})));"
          "console.log(JSON.stringify(r));await b.close();})();")
    out = json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)
    res = {k: out[str(i)] for i, k in enumerate(keys)}
    json.dump(res, open(CENTERS_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=0, sort_keys=True)
    print('→ icon-l3-centers.json', len(res))
    return res


def sub_id(k):
    return 'sub-' + hashlib.md5(k.encode()).hexdigest()[:8]


def palette(name, brand):
    for k, v in COLOR_WORDS:
        if k in name:
            return v
    for k, v in BRAND.items():
        if k in brand or k in name:
            return v
    return FALLBACK[h(name, len(FALLBACK))]


EXTRA_ITEM = [('兔女郎', 'a swimsuit'), ('兔男郎', 'a vest top'), ('逆兔', 'a swimsuit'), ('蜜裁', 'a dress')]  # 主體檔沒對到的補在這裡


def subject_of_item(r, subs, item_map):
    k = item_map.get(r['名字']) or next((v for t, v in EXTRA_ITEM if t in r['名字']), None)
    if k and k in subs:
        return k
    k = r['prompt'].split('no letters, ')[1].split(',')[0]
    return k if k in subs else None


def build_item(r, subs, centers, item_map):
    k = subject_of_item(r, subs, item_map)
    if not k:
        return None, None
    name, grade, unique = r['名字'], r['等級'], bool(r['獨特'])
    b, c = palette(name, r['牌子'])
    cx, cy, w, hh = centers[k]
    sc = min(1.0, 150 / max(w, hh))
    flip = h(name + 'f', 3) == 0 and not any(t in k for t in ('glasses', 'panties', 'bra', 'mask'))
    tf = f'translate(100 100) scale({-sc if flip else sc:.3f} {sc:.3f}) translate({-cx:.1f} {-cy:.1f})'
    parts = []
    if unique:
        parts.append('<circle cx="100" cy="100" r="88" fill="#9A6FD6" opacity=".22"/><circle cx="100" cy="100" r="88" fill="none" stroke="#B39DF0" stroke-width="3" stroke-dasharray="4 8" opacity=".7"/>')
    parts.append(f'<use href="#{sub_id(k)}" transform="{tf}"/>')
    motif = next((v for t, v in MOTIF if t in name), None)
    if motif:
        parts.append(f'<g transform="translate(160 160) scale(1.15)">{MOTIF_SVG[motif]}</g>')
    if r['分類'].startswith('ITEMS 11'):  # 網內的東西：左下角一個青色的游標
        parts.append('<g transform="translate(30 168)"><path d="M-12-16L14 2L2 4L8 16L2 19L-4 7L-12 14Z" fill="#45D6C5" stroke="#17111F" stroke-width="3.5" stroke-linejoin="round"/></g>')
    if grade in ('IV', 'V'):
        parts.append(f'<g transform="translate(36 36)">{SPARK}</g>')
    if grade == 'V':
        parts.append(f'<g transform="translate(58 22) scale(.6)">{SPARK}</g>')
    return f'<symbol id="{r["id"]}" viewBox="0 0 200 200"><title>{html.escape(name)}</title><g style="--b:{b};--c:{c}">{"".join(parts)}</g></symbol>', k


def build_skill(r, subs, centers, skill_map):
    import gen_icons as g
    k = skill_map.get(r['名字'])
    if not k or 'sk:' + k not in subs:
        return None, None
    key = 'sk:' + k
    tid = r['第2層'].split('_')[1]
    shape, col = next((sh, cl) for t, n, sh, cl in g.TREES if t == tid)
    cx, cy, w, hh = centers[key]
    sc = min(.62, 96 / max(w, hh))
    body = (g.FRAME[shape].format(c=col)
            + (f'<path d="M100 22l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" fill="#F2C14E" stroke="#17111F" stroke-width="4"/>' if r['獨特'] else '')
            + f'<use href="#{sub_id(key)}" transform="translate(100 {106 if shape == "heart" else 100}) scale({sc:.3f}) translate({-cx:.1f} {-cy:.1f})"/>'
            + f'<circle cx="160" cy="160" r="22" fill="#17111F"/>{g.BADGE[tid]}')
    return f'<symbol id="{r["id"]}" viewBox="0 0 200 200"><title>{html.escape(r["名字"])}</title><g style="--c:#F3E9FF">{body}</g></symbol>', key


def main():
    subs, item_map, skill_map = load_subjects()
    centers = json.load(open(CENTERS_PATH, encoding='utf-8')) if os.path.exists(CENTERS_PATH) else {}
    if '--measure' in sys.argv or any(k not in centers for k in subs):
        centers = measure(subs)
    items = list(csv.DictReader(open(os.path.join(ICONS, 'items.csv'), encoding='utf-8-sig')))
    skills = list(csv.DictReader(open(os.path.join(ICONS, 'skills.csv'), encoding='utf-8-sig')))
    syms, used, rows, missing = [], set(), [], []
    for r in items:
        s, k = build_item(r, subs, centers, item_map)
        if s:
            syms.append(s); used.add(k); rows.append(('物品', r))
        else:
            missing.append(r['名字'])
    for r in skills:
        s, k = build_skill(r, subs, centers, skill_map)
        if s:
            syms.append(s); used.add(k); rows.append(('技能', r))
        else:
            missing.append(r['名字'])
    base = [f'<symbol id="{sub_id(k)}" viewBox="0 0 200 200" overflow="visible">{subs[k]}</symbol>' for k in sorted(used)]
    sprite = (f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs><style>{S_CSS}</style></defs>\n'
              + '\n'.join(base + syms) + '\n</svg>\n')
    open(os.path.join(STYLE_DIR, 'icons-l3-sprite.svg'), 'w', encoding='utf-8').write(sprite)
    write_page(sprite, rows)
    print(f'→ icons-l3-sprite.svg：主體 {len(base)}、圖標 {len(syms)}；沒有主體的 {len(missing)}', missing[:20])


def write_page(sprite, rows):
    cells = []
    for kind, r in rows:
        grade = r['等級']
        gcls = {'I': 'g1', 'II': 'g2', 'III': 'g3', 'IV': 'g4', 'V': 'g5'}.get(grade, 'g0') if kind == '物品' else 'gs'
        uniq = '<i class="u"></i>' if (kind == '物品' and r['獨特']) else ''
        cells.append(f'<div class="c {gcls}" data-k="{kind}" data-t="{html.escape(r["名字"] + " " + r["分類"] + " " + r["牌子"])}">'
                     f'<div class="f"><svg viewBox="0 0 200 200"><use href="#{r["id"]}"/></svg>{uniq}</div>'
                     f'<b>{html.escape(r["名字"])}</b><small>{html.escape(r["分類"])}{(" ・" + grade) if grade and kind == "物品" else ""}</small></div>')
    page = f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>第 3 層圖標</title>
<style>
:root{{--bg:#17111F;--bg1:#211829;--line:#3A2D47;--ink:#F3E9FF;--ink2:#C9B8E8;--ink3:#8C7AA6;--pink:#F06AA0}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;padding:16px}}
h1{{font-size:20px;margin:0 0 4px;color:var(--pink)}} p{{margin:0 0 12px;color:var(--ink3);font-size:12.5px}}
.bar{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;position:sticky;top:0;background:var(--bg);padding:6px 0;z-index:2}}
input{{flex:1;min-width:160px;background:var(--bg1);border:0;box-shadow:inset 0 0 0 1px var(--line);color:var(--ink);padding:8px 10px;border-radius:8px;font:inherit}}
button{{background:var(--bg1);border:0;color:var(--ink2);padding:6px 12px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer}} button.on{{background:var(--pink);color:#fff}}
.skin button{{padding:6px 10px}}
#grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}}
.c{{text-align:center;font-size:11px;min-width:0}} .c b{{display:block;font-size:11.5px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}} .c small{{color:var(--ink3);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.f{{position:relative;aspect-ratio:1;background:#120D19;border-radius:10px;box-shadow:inset 0 0 0 2px var(--gc,#3A2D47);display:grid;place-items:center}}
.f svg{{width:72%;height:72%}}
.g1{{--gc:#E9E3F2}} .g2{{--gc:#5DD37A}} .g3{{--gc:#5C9DFF}} .g4{{--gc:#F2C14E}} .g5{{--gc:#FF8A3D}} .gs .f{{box-shadow:none}}
.u{{position:absolute;right:-3px;top:-3px;width:14px;height:14px;background:#9A6FD6;border-radius:3px;box-shadow:0 0 0 2px var(--bg)}}
body.net{{--bg:#F8C3D8;--bg1:#FFF4E8;--line:#1E2346;--ink:#1E2346;--ink2:#3B4170;--ink3:#6D6F94}} body.net .f{{background:#FFE6F0}}
#grid{{--o:#17111F;--a:#F06AA0}} body.net #grid{{--o:#1E2346}}
.n{{color:var(--ink3);font-size:12px;margin:0 0 8px}}
</style></head><body>
{sprite}
<h1>第 3 層圖標</h1><p>每一件物品、每一個技能各一個。格子的框色是等級（白、綠、藍、金、橘），右上角紫色小標是獨特物品；主體一樣的物品靠牌子與名字裡的顏色、花紋分開，IV、V 級多一兩顆星光。</p>
<div class="bar"><input id="q" placeholder="搜尋名字、分類、牌子"><button class="on" data-f="">全部</button><button data-f="物品">物品</button><button data-f="技能">技能</button><span class="skin"><button class="on" data-s="">現實皮</button><button data-s="net">內海皮</button></span></div>
<div class="n" id="n"></div>
<div id="grid">{"".join(cells)}</div>
<script>
const cs=[...document.querySelectorAll('.c')],q=document.getElementById('q'),n=document.getElementById('n');let f='';
function run(){{const t=q.value.trim();let k=0;cs.forEach(c=>{{const ok=(!f||c.dataset.k===f)&&(!t||c.dataset.t.includes(t));c.style.display=ok?'':'none';if(ok)k++;}});n.textContent=k+' 個';}}
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{{document.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('on'));b.classList.add('on');f=b.dataset.f;run();}});
document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{{document.querySelectorAll('[data-s]').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.body.className=b.dataset.s;}});
q.oninput=run;run();
</script></body></html>'''
    open(os.path.join(ROOT, 'docs', 'mockups', 'icons-l3.html'), 'w', encoding='utf-8').write(page)
    print('→ docs/mockups/icons-l3.html')


if __name__ == '__main__':
    main()
