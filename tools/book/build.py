#!/usr/bin/env python3
"""把 docs/ 的所有文件照閱讀順序編成一個單檔的設計書。
輸出：docs/book/CyberpunkPink-設計書.html（PDF 由 tools/book/pdf.mjs 另外轉）
用法：python3 tools/book/build.py
      python3 tools/book/build.py --artifact <輸出路徑>   產生給 Claude 成品（Artifact）用的版本
不依賴任何套件：內建一個只支援本專案用到的語法的 Markdown 轉換器。"""
import base64, html, os, re, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
DOCS = os.path.join(ROOT, 'docs')
OUT = os.path.join(DOCS, 'book', 'CyberpunkPink-設計書.html')

PARTS = [  # 依 plan/DESIGN_ORDER 的分層編排：(標題, 這一層的說明, 文件)
    ('總綱', '這是什麼遊戲，以及系統分成哪幾層、照什麼順序設計。',
     ['GAME_DESIGN.md', 'plan/DESIGN_ORDER.md', 'plan/AUDIT.md']),
    ('L0 世界', '這座城市是什麼、用什麼詞。大致定了；勢力與流竄 AI 會再加。',
     ['world/WORLD.md', 'world/CORPORATIONS.md', 'world/GANGS.md', 'world/CULTURE.md',
      'world/DISTRICTS.md', 'world/LIFE.md', 'world/NPCS.md', 'world/FACTIONS.md']),
    ('L1 核心規則', '一個角色由哪些數字組成、怎麼擲骰。多數已確認。',
     ['systems/CORE_RULES.md', 'systems/CHARACTER.md', 'DOMAINS.md']),
    ('L2 核心玩法', '三個戰場怎麼打。下一步要過的一層。',
     ['systems/COMBAT_SYSTEM.md', 'systems/CYBERSPACE.md', 'systems/NETRUNNING.md',
      'systems/OPINION.md', 'systems/MEDIA.md']),
    ('L3 框架', '內容的格式與規則，不含內容本身。部分已確認。',
     ['systems/SKILLS.md', 'gear/CYBERWARE.md', 'gear/CRAFTING.md', 'gear/EQUIPMENT.md', 'systems/ENEMIES.md',
      'systems/NPC_SYSTEM.md', 'systems/EVENTS.md', 'systems/SERIES.md', 'systems/COMMISSIONS.md', 'systems/FIXER.md',
      'systems/TRADE.md', 'systems/DOWNTIME.md', 'systems/LEWD_SYSTEM.md']),
    ('L4 內容（素材）', '實際的條目。暫停：第一版草稿當素材留著，等 L1～L3 定了再生成。',
     ['gear/ITEMS.md', 'world/SITES.md', 'world/STORY_QUESTS.md']),
    ('L5 呈現', '給玩家看的畫面與給 AI 讀的提示詞。跟著 L2、L3 調。',
     ['art/ART_STYLE.md', 'art/UI.md', 'systems/PROMPTS.md', 'plan/AI_TASKS.md']),
    ('附錄：計畫', '盤點、路線圖、ElondiaRPG 的遷移與掃描。',
     ['plan/SYSTEMS_REVIEW.md', 'plan/ROADMAP.md', 'plan/WORLD_ITEMS.md', 'plan/MIGRATION.md',
      'plan/IMPLEMENTATION.md', 'plan/CODESCAN.md', 'plan/IDEAS.md']),
]
FIGURES = {  # 在某份文件的標題後面插圖
    'world/DISTRICTS.md': [('art/city-map.svg', '緋夜城地圖（示意）'), ('art/district-blocks.svg', '各區的街區結構'), ('art/map-scale.svg', '地圖規模')],
    'systems/CYBERSPACE.md': [('art/cyberspace.svg', '內海的結構')],
    'world/FACTIONS.md': [('art/factions.svg', '勢力關係圖（草稿）')],
}
DEMOS = {  # 在某份文件的標題後面嵌入可以操作的 Demo（取檔案裡 <!--demo:start--> 到 <!--demo:end--> 之間的內容）
    'systems/COMBAT_SYSTEM.md': ('mockups/combat-demo.html', '可以直接操作的 Demo：四對四的現實戰鬥'),
    'systems/CYBERSPACE.md': ('mockups/net-demo.html', '可以直接操作的 Demo：內海戰鬥'),
    'systems/OPINION.md': ('mockups/opinion-demo.html', '可以直接操作的 Demo：輿論戰（搶地盤）'),
}
ALL = [d for _, _, ds in PARTS for d in ds]
DOC_ID = {d: 'doc-' + os.path.splitext(os.path.basename(d))[0].lower().replace('_', '-') for d in ALL}


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    mime = {'.svg': 'image/svg+xml', '.png': 'image/png'}[ext]
    return f'data:{mime};base64,' + base64.b64encode(open(path, 'rb').read()).decode()


def inline(text, doc):
    """行內語法：`code`、**粗體**、![圖](路徑)、[連結](路徑)。"""
    codes = []
    def stash(m):
        codes.append(m.group(1)); return f'\x00{len(codes)-1}\x00'
    text = re.sub(r'`([^`]+)`', stash, text)
    text = html.escape(text, quote=False)

    def img(m):
        alt, target = m.group(1), m.group(2)
        p = os.path.normpath(os.path.join(DOCS, os.path.dirname(doc), target))
        svg = os.path.join(DOCS, 'art', os.path.splitext(os.path.basename(p))[0] + '.svg')
        src = svg if os.path.exists(svg) else p
        return f'<img alt="{alt}" src="{data_uri(src)}">' if os.path.exists(src) else alt
    text = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)', img, text)

    def link(m):
        label, target = m.group(1), m.group(2)
        if re.match(r'^[a-z]+:', target):
            return f'<a href="{target}" target="_blank" rel="noopener">{label}</a>'
        rel = os.path.normpath(os.path.join(os.path.dirname(doc), target.split('#')[0])).replace(os.sep, '/')
        if rel in DOC_ID:
            return f'<a href="#{DOC_ID[rel]}">{label}</a>'
        return f'<span class="ext" title="{rel}">{label}</span>'
    text = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    return re.sub(r'\x00(\d+)\x00', lambda m: '<code>' + html.escape(codes[int(m.group(1))], quote=False) + '</code>', text)


def convert(md, doc, toc):
    out, lines, i = [], md.split('\n'), 0
    did = DOC_ID[doc]
    para = []
    def flush():
        if para:
            out.append('<p>' + inline(' '.join(para), doc) + '</p>'); para.clear()
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            flush(); lang = line[3:].strip(); i += 1; buf = []
            while i < len(lines) and not lines[i].startswith('```'):
                buf.append(lines[i]); i += 1
            i += 1
            if lang != 'mermaid':
                out.append('<pre><code>' + html.escape('\n'.join(buf), quote=False) + '</code></pre>')
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            flush(); level, title = len(m.group(1)), m.group(2)
            if level == 1:
                out.append(f'<h1 id="{did}">{inline(title, doc)}</h1>')
                toc.append((1, did, re.sub(r'<[^>]+>', '', inline(title, doc))))
                for path, cap in FIGURES.get(doc, []):
                    out.append(f'<figure><img alt="{cap}" src="{data_uri(os.path.join(DOCS, path))}"><figcaption>{cap}</figcaption></figure>')
                if doc in DEMOS:
                    path, cap = DEMOS[doc]
                    src = open(os.path.join(DOCS, path), encoding='utf-8').read()
                    frag = src.split('<!--demo:start-->', 1)[1].split('<!--demo:end-->', 1)[0]
                    out.append(f'<p><strong>{cap}</strong></p>{frag}')
            else:
                num = re.match(r'^(\d+(?:\.\d+)*)', title)
                hid = f'{did}-{num.group(1).replace(".", "-")}' if num else f'{did}-h{len(out)}'
                out.append(f'<h{level} id="{hid}">{inline(title, doc)}</h{level}>')
                if level == 2:
                    toc.append((2, hid, re.sub(r'<[^>]+>', '', inline(title, doc))))
            i += 1; continue
        if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|\s*$', lines[i + 1]):
            flush()
            cells = lambda l: [c.strip() for c in re.split(r'(?<!\\)\|', l.strip().strip('|'))]
            head = cells(line); i += 2; rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(cells(lines[i])); i += 1
            t = ['<div class="tw"><table><thead><tr>' + ''.join(f'<th>{inline(c, doc)}</th>' for c in head) + '</tr></thead><tbody>']
            for r in rows:
                t.append('<tr>' + ''.join(f'<td>{inline(c, doc)}</td>' for c in r) + '</tr>')
            out.append(''.join(t) + '</tbody></table></div>'); continue
        if line.startswith('>'):
            flush(); buf = []
            while i < len(lines) and lines[i].startswith('>'):
                buf.append(lines[i][1:].strip()); i += 1
            out.append('<blockquote>' + '<br>'.join(inline(b, doc) for b in buf if b) + '</blockquote>'); continue
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', line)
        if m:
            flush(); stack = []
            while i < len(lines):
                m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lines[i])
                if not m:
                    if lines[i].strip() and lines[i].startswith('  ') and stack:
                        out.append(' ' + inline(lines[i].strip(), doc)); i += 1; continue
                    break
                ind, tag = len(m.group(1)), 'ol' if m.group(2)[0].isdigit() else 'ul'
                while stack and stack[-1][0] > ind:
                    out.append(f'</li></{stack.pop()[1]}>')
                if stack and stack[-1][0] == ind:
                    out.append('</li>')
                else:
                    out.append(f'<{tag}>'); stack.append((ind, tag))
                out.append('<li>' + inline(m.group(3), doc)); i += 1
            while stack:
                out.append(f'</li></{stack.pop()[1]}>')
            continue
        if not line.strip():
            flush(); i += 1; continue
        if re.match(r'^-{3,}\s*$', line):
            flush(); out.append('<hr>'); i += 1; continue
        para.append(line.strip()); i += 1
    flush()
    return '\n'.join(out)


CSS = '''
:root{--bg:#0d0a14;--bg1:#151020;--bg2:#1d1630;--line:#3a2d52;--ink:#efe9f7;--ink2:#b8adc9;--ink3:#7d7390;--pink:#ff4fa3;--pinkhi:#ff8fc8;--mint:#5dffb0;--gold:#ffd66b;
 --font:'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif;--mono:'JetBrains Mono','Cascadia Code',Consolas,monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15.5px;line-height:1.75}
nav{position:fixed;inset:0 auto 0 0;width:290px;overflow-y:auto;background:var(--bg1);border-right:1px solid var(--line);padding:22px 0 60px;font-size:13.5px}
nav .brand{padding:0 20px 14px;color:var(--pink);font-size:21px;font-weight:900;letter-spacing:3px}
nav .brand small{display:block;color:var(--ink3);font-size:11px;font-weight:400;letter-spacing:2px;margin-top:2px}
nav .part{margin:16px 20px 4px;color:var(--pinkhi);font-size:12px;letter-spacing:4px;border-top:1px solid var(--line);padding-top:12px}
nav a{display:block;color:var(--ink2);text-decoration:none;padding:3px 20px;border:0;border-left:2px solid transparent}
nav a.d{color:var(--ink);font-weight:700;margin-top:6px}
nav a.s{padding-left:34px;font-size:12.5px;color:var(--ink3)}
nav a:hover{color:var(--pinkhi);border-left-color:var(--pink);background:#ff4fa30d}
main{margin-left:290px;padding:40px 56px 120px;max-width:1180px}
.cover{min-height:70vh;display:flex;flex-direction:column;justify-content:center;border-bottom:1px solid var(--line);margin-bottom:40px}
.cover h1{font-size:64px;margin:0;color:var(--pink);letter-spacing:8px;text-shadow:0 0 28px #ff4fa366;border:0;padding:0}
.cover p{color:var(--ink2);font-size:17px;max-width:720px}.cover .tag{font-family:var(--mono);font-size:12px;color:var(--ink3);letter-spacing:3px}
.cover ul{color:var(--ink2);max-width:760px}
.parthead{margin:90px 0 0;padding:26px 0 8px;border-top:2px solid var(--pink);color:var(--pink);font-size:13px;letter-spacing:8px}
.partdesc{color:var(--ink2);margin:4px 0 0;font-size:15px}
h1{font-size:34px;margin:28px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line);letter-spacing:1px}
h2{font-size:22px;margin:44px 0 12px;color:var(--pinkhi);display:flex;align-items:center;gap:12px}
h2::before{content:"";width:18px;height:2px;background:var(--pink);flex:none}
h3{font-size:17.5px;margin:30px 0 8px;color:var(--ink)}h4{font-size:15.5px;margin:22px 0 6px;color:var(--ink2)}
p{margin:10px 0}a{color:var(--pinkhi);text-decoration:none;border-bottom:1px dotted #ff8fc866}a:hover{color:#fff}
.ext{color:var(--ink2);border-bottom:1px dotted var(--ink3)}
strong{color:#fff}code{font-family:var(--mono);font-size:.86em;color:var(--mint);background:#ffffff0a;padding:1px 5px;border-radius:3px}
pre{background:var(--bg1);border:1px solid var(--line);padding:14px 16px;overflow-x:auto;line-height:1.5;font-size:12.5px}
pre code{background:none;padding:0;color:var(--ink2)}
blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--pink);background:#ff4fa30a;color:var(--ink2);font-size:14px}
ul,ol{padding-left:24px;margin:8px 0}li{margin:4px 0}
.tw{overflow-x:auto;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14px}
th{background:var(--bg2);color:var(--pinkhi);text-align:left;font-weight:700;white-space:nowrap}
th,td{border:1px solid var(--line);padding:7px 11px;vertical-align:top}tr:nth-child(even) td{background:#ffffff05}
figure{margin:20px 0}figure img,p img{max-width:100%;border:1px solid var(--line);display:block}
figcaption{color:var(--ink3);font-size:12.5px;margin-top:6px;letter-spacing:1px}
hr{border:0;border-top:1px solid var(--line);margin:30px 0}
article{margin-top:60px}
@media (max-width:900px){nav{display:none}main{margin-left:0;padding:24px 18px 80px}.cover h1{font-size:42px}}
@media print{nav{display:none}main{margin:0;padding:0;max-width:none}body{background:#fff;color:#111;font-size:11pt}
 h1,h2,h3,strong{color:#111}h2{color:#b0206a}th{background:#f1e6ee;color:#7a1447}th,td{border-color:#bbb}tr:nth-child(even) td{background:#faf6f9}
 code{color:#0a6b46;background:#f2f2f2}pre{background:#f7f7f7;border-color:#ccc}pre code{color:#222}blockquote{background:#fbf1f6;color:#444}
 a{color:#b0206a;border:0}.cover h1{color:#d81b78;text-shadow:none}.cover p,.cover ul,figcaption,.cover .tag{color:#555}
 article{page-break-before:always}.parthead{page-break-before:always;margin-top:0}h1,h2,h3{page-break-after:avoid}tr,figure{page-break-inside:avoid}}
'''


ART_CSS = '''
/* 版面：左側固定目錄＋右側長文；窄螢幕時目錄收進頂端的摺疊區。深色為主，淺色主題只換色票。 */
:root{--bg:#0d0a14;--bg1:#151020;--bg2:#1d1630;--line:#3a2d52;--ink:#efe9f7;--ink2:#b8adc9;--ink3:#8a7f9e;--pink:#ff4fa3;--pinkhi:#ff8fc8;--mint:#5dffb0;--strong:#ffffff;--tint:#ff4fa312;--zebra:#ffffff07;
 --font:'Noto Sans TC','PingFang TC','Microsoft JhengHei','WenQuanYi Zen Hei',sans-serif;--mono:'JetBrains Mono','Cascadia Code',Consolas,monospace;color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#fbf7fa;--bg1:#f3ecf2;--bg2:#eadfe8;--line:#d9c9d6;--ink:#231a2c;--ink2:#54485f;--ink3:#7b6f86;--pink:#c2186b;--pinkhi:#a3155b;--mint:#0a6b46;--strong:#120b18;--tint:#c2186b10;--zebra:#00000006;color-scheme:light}}
:root[data-theme="light"]{--bg:#fbf7fa;--bg1:#f3ecf2;--bg2:#eadfe8;--line:#d9c9d6;--ink:#231a2c;--ink2:#54485f;--ink3:#7b6f86;--pink:#c2186b;--pinkhi:#a3155b;--mint:#0a6b46;--strong:#120b18;--tint:#c2186b10;--zebra:#00000006;color-scheme:light}
*{box-sizing:border-box}html{scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15.5px;line-height:1.75}
nav{position:fixed;top:0;bottom:0;left:0;width:calc(290px + env(safe-area-inset-left, 0px));overflow-y:auto;background:var(--bg1);border-right:1px solid var(--line);
 padding:calc(22px + env(safe-area-inset-top, 0px)) 0 60px env(safe-area-inset-left, 0px);font-size:13.5px}
.brand{padding:0 20px 14px;color:var(--pink);font-size:21px;font-weight:900;letter-spacing:3px}
.brand small{display:block;color:var(--ink3);font-size:11px;font-weight:400;letter-spacing:2px;margin-top:2px}
.part{margin:16px 20px 4px;color:var(--pinkhi);font-size:12px;letter-spacing:4px;border-top:1px solid var(--line);padding-top:12px}
.toc a{display:block;color:var(--ink2);text-decoration:none;padding:3px 20px;border:0;border-left:2px solid transparent}
.toc a.d{color:var(--ink);font-weight:700;margin-top:6px}.toc a.s{padding-left:34px;font-size:12.5px;color:var(--ink3)}
.toc a:hover,.toc a:focus-visible{color:var(--pinkhi);border-left-color:var(--pink);background:var(--tint);outline:none}
main{margin-left:calc(290px + env(safe-area-inset-left, 0px));padding-block:40px 120px;padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px));min-width:0}
.col{max-width:1080px;margin:0 auto;padding:0 32px;min-width:0}
details.mtoc{display:none;border:1px solid var(--line);background:var(--bg1);margin-bottom:24px}
details.mtoc summary{padding:12px 16px;color:var(--pinkhi);letter-spacing:3px;cursor:pointer}
.cover{padding:48px 0 40px;border-bottom:1px solid var(--line);margin-bottom:8px}
.cover h1{font-size:clamp(38px,7vw,64px);margin:6px 0 12px;color:var(--pink);letter-spacing:6px;border:0;padding:0;overflow-wrap:anywhere}
.cover p{color:var(--ink2);font-size:17px;max-width:720px}.tag{font-family:var(--mono);font-size:12px;color:var(--ink3);letter-spacing:3px}
.cover ul{color:var(--ink2);max-width:760px}
.parthead{margin:80px 0 0;padding:22px 0 8px;border-top:2px solid var(--pink);color:var(--pink);font-size:13px;letter-spacing:8px}
.partdesc{color:var(--ink2);margin:4px 0 0;font-size:15px}
h1{font-size:32px;margin:28px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line);letter-spacing:1px;text-wrap:balance}
h2{font-size:22px;margin:44px 0 12px;color:var(--pinkhi);display:flex;align-items:baseline;gap:12px;text-wrap:balance}
h2::before{content:"";width:18px;height:2px;background:var(--pink);flex:none;align-self:center}
h3{font-size:17.5px;margin:30px 0 8px;color:var(--ink)}h4{font-size:15.5px;margin:22px 0 6px;color:var(--ink2)}
p{margin:10px 0;max-width:46em}li{max-width:46em}a{color:var(--pinkhi);text-decoration:none;border-bottom:1px dotted var(--pinkhi)}a:hover{color:var(--strong)}
.ext{color:var(--ink2);border-bottom:1px dotted var(--ink3)}
strong{color:var(--strong)}code{font-family:var(--mono);font-size:.86em;color:var(--mint);background:var(--zebra);padding:1px 5px;border-radius:3px;overflow-wrap:anywhere}
pre{background:var(--bg1);border:1px solid var(--line);padding:14px 16px;overflow-x:auto;line-height:1.5;font-size:12.5px}
pre code{background:none;padding:0;color:var(--ink2);overflow-wrap:normal}
blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--pink);background:var(--tint);color:var(--ink2);font-size:14px}
ul,ol{padding-left:24px;margin:8px 0}li{margin:4px 0}
.tw{overflow-x:auto;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
th{background:var(--bg2);color:var(--pinkhi);text-align:left;font-weight:700;white-space:nowrap}
th,td{border:1px solid var(--line);padding:7px 11px;vertical-align:top;min-width:5em}tr:nth-child(even) td{background:var(--zebra)}
figure{margin:20px 0}figure img,p img{max-width:100%;height:auto;border:1px solid var(--line);display:block}
figcaption{color:var(--ink3);font-size:12.5px;margin-top:6px;letter-spacing:1px}
hr{border:0;border-top:1px solid var(--line);margin:30px 0}article{margin-top:56px}
.toc a.cur{color:var(--pinkhi);border-left-color:var(--pink)}
.navbtn,.scrim,.navhead button{display:none}
@media (max-width:900px){
 nav{transform:translateX(-102%);transition:transform .22s ease;z-index:50;width:min(88vw,360px);box-shadow:8px 0 30px #0008;padding-bottom:calc(90px + env(safe-area-inset-bottom, 0px));overscroll-behavior:contain}
 body.nav-open nav{transform:none}
 body.nav-open{overflow:hidden}
 .scrim{position:fixed;inset:0;background:#000a;z-index:40}body.nav-open .scrim{display:block}
 .navbtn{display:flex;align-items:center;gap:8px;position:fixed;z-index:60;right:calc(14px + env(safe-area-inset-right, 0px));bottom:calc(14px + env(safe-area-inset-bottom, 0px));height:50px;padding:0 18px;
  font:inherit;font-weight:700;letter-spacing:3px;color:var(--bg);background:var(--pink);border:0;border-radius:25px;box-shadow:0 4px 16px #0008;cursor:pointer}
 .navbtn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
 .navhead{display:flex;align-items:center;gap:8px;padding:0 20px 10px}
 .navhead button{display:block;font:inherit;font-size:12.5px;color:var(--ink);background:var(--bg2);border:1px solid var(--line);padding:8px 12px;min-height:40px;cursor:pointer}
 .navhead button[aria-pressed="true"]{border-color:var(--pink);color:var(--pinkhi)}
 .toc a{padding:10px 20px}.toc a.d{margin-top:0;border-top:1px solid var(--line)}
 .toc a.s{display:none;padding:8px 20px 8px 34px}
 nav.all .toc a.s,.toc a.s.open{display:block}
 main{margin-left:0;padding-block:20px 110px}.col{padding:0}
 body{font-size:15px}h1{font-size:26px}h2{font-size:19.5px}h3{font-size:16.5px}
 table{font-size:13px}th,td{padding:6px 8px;min-width:4.5em}
 html{scroll-padding-top:8px}
}
@media (prefers-reduced-motion:reduce){nav{transition:none}}
'''

NAV_JS = r'''
(function(){
 var nav=document.getElementById('booknav'),btn=document.getElementById('navbtn'),scrim=document.getElementById('scrim'),all=document.getElementById('navall');
 if(!nav||!btn)return;
 var docs=[].slice.call(nav.querySelectorAll('.toc a.d'));
 function current(){var best=docs[0];for(var i=0;i<docs.length;i++){var el=document.getElementById(docs[i].getAttribute('href').slice(1));if(el&&el.getBoundingClientRect().top<=120)best=docs[i];else if(el)break}return best}
 function mark(){var c=current();nav.querySelectorAll('.cur').forEach(function(a){a.classList.remove('cur')});nav.querySelectorAll('.open').forEach(function(a){a.classList.remove('open')});
  if(!c)return c;c.classList.add('cur');for(var n=c.nextElementSibling;n&&n.classList.contains('s');n=n.nextElementSibling)n.classList.add('open');return c}
 function open(){var c=mark();document.body.classList.add('nav-open');btn.setAttribute('aria-expanded','true');if(c)nav.scrollTop=Math.max(0,c.offsetTop-90)}
 function close(){document.body.classList.remove('nav-open');btn.setAttribute('aria-expanded','false')}
 btn.addEventListener('click',function(){document.body.classList.contains('nav-open')?close():open()});
 scrim.addEventListener('click',close);
 document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
 nav.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;
  if(a.classList.contains('d')&&window.matchMedia('(max-width:900px)').matches&&!a.classList.contains('cur')&&!nav.classList.contains('all')){
   var has=a.nextElementSibling&&a.nextElementSibling.classList.contains('s');
   if(has&&!a.nextElementSibling.classList.contains('open')){e.preventDefault();nav.querySelectorAll('.open').forEach(function(x){x.classList.remove('open')});
    for(var n=a.nextElementSibling;n&&n.classList.contains('s');n=n.nextElementSibling)n.classList.add('open');a.insertAdjacentHTML;return}}
  close()});
 if(all)all.addEventListener('click',function(){var on=nav.classList.toggle('all');all.setAttribute('aria-pressed',on);all.textContent=on?'只看文件':'展開全部章節'});
 var t;window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){if(!document.body.classList.contains('nav-open')){var c=current();nav.querySelectorAll('.cur').forEach(function(a){a.classList.remove('cur')});if(c)c.classList.add('cur')}},150)},{passive:true});
})();
'''


def build():
    toc_html, body = [], []
    for part, desc, docs in PARTS:
        toc_html.append(f'<div class="part">{part}</div>')
        body.append(f'<div class="parthead">{part}</div><p class="partdesc">{html.escape(desc)}</p>')
        for doc in docs:
            toc = []
            md = open(os.path.join(DOCS, doc), encoding='utf-8').read()
            body.append(f'<article>{convert(md, doc, toc)}</article>')
            for level, hid, title in toc:
                toc_html.append(f'<a class="{"d" if level == 1 else "s"}" href="#{hid}">{html.escape(title)}</a>')
    return ''.join(toc_html), ''.join(body)


def artifact(out):
    toc, body = build()
    n_docs = len(ALL)
    cover = f'''<section class="cover"><div class="tag">設計書 · 緋夜城 2069 · 設計階段</div><h1>CyberpunkPink</h1>
<p>一款成人向的賽博龐克跑團風格 RPG。這本設計書把 {n_docs} 份設計文件依設計的分層編在一起：L0 世界、L1 核心規則、L2 核心玩法、L3 框架、L4 內容、L5 呈現。下層定了，上層才展開。</p>
<ul><li>所有數值都是初稿；還沒有程式。</li><li>本作是成人向虛構作品，所有登場角色皆為成年人。</li>
<li>文件之間的連結會跳到這本書裡對應的章節。</li></ul></section>'''
    page = f'''<title>CyberpunkPink 設計書</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&family=JetBrains+Mono:wght@400&display=swap">
<style>{ART_CSS}</style>
<nav aria-label="目錄" id="booknav"><div class="brand">CyberpunkPink<small>設計書 · 緋夜城 2069</small></div>
<div class="navhead"><button type="button" id="navall" aria-pressed="false">展開全部章節</button></div><div class="toc">{toc}</div></nav>
<div class="scrim" id="scrim"></div>
<button type="button" class="navbtn" id="navbtn" aria-controls="booknav" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg>目錄</button>
<main><div class="col">
{cover}{body}</div></main>
<script>{NAV_JS}</script>'''
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(page)
    print(f'→ {out}  {n_docs} 份文件  {len(page)//1024} KB')


def main():
    toc_html, body = [], []
    for part, desc, docs in PARTS:
        toc_html.append(f'<div class="part">{part}</div>')
        body.append(f'<div class="parthead">{part}</div><p class="partdesc">{html.escape(desc)}</p>')
        for doc in docs:
            toc = []
            md = open(os.path.join(DOCS, doc), encoding='utf-8').read()
            body.append(f'<article>{convert(md, doc, toc)}</article>')
            for level, hid, title in toc:
                toc_html.append(f'<a class="{"d" if level == 1 else "s"}" href="#{hid}">{html.escape(title)}</a>')
    try:
        rev = subprocess.check_output(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'], text=True).strip()
    except Exception:
        rev = ''
    n_docs = len(ALL)
    cover = f'''<section class="cover"><div class="tag">設計書 · 緋夜城 2069 · 設計階段</div><h1>CyberpunkPink</h1>
<p>一款成人向的賽博龐克跑團風格 RPG。這本設計書把 <code>docs/</code> 裡的 {n_docs} 份文件依設計的分層編在一起：L0 世界、L1 核心規則、L2 核心玩法、L3 框架、L4 內容、L5 呈現。下層定了，上層才展開。</p>
<ul><li>所有數值都是初稿；還沒有程式。</li><li>本作是成人向虛構作品，所有登場角色皆為成年人。</li>
<li>左側是目錄。文件之間的連結在這本書裡會跳到對應的章節。</li><li>這個檔案由 <code>tools/book/build.py</code> 產生，不要手改；改文件後重跑。</li></ul>
<div class="tag">{("版本 " + rev) if rev else ""}</div></section>'''
    page = f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CyberpunkPink 設計書</title><style>{CSS}</style></head><body>
<nav><div class="brand">CyberpunkPink<small>設計書 · 緋夜城 2069</small></div>{"".join(toc_html)}</nav>
<main>{cover}{"".join(body)}</main></body></html>'''
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(page)
    print(f'→ docs/book/{os.path.basename(OUT)}  {n_docs} 份文件  {len(page)//1024} KB')


if __name__ == '__main__':
    import sys
    if '--artifact' in sys.argv:
        artifact(sys.argv[sys.argv.index('--artifact') + 1])
    else:
        main()
