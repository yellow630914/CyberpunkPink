#!/usr/bin/env python3
"""把三個可以操作的 Demo 換上定案的風格（ART_STYLE 第 3～5 節）。
不改 Demo 的程式，只在 <!--demo:end--> 前面插一段覆蓋用的樣式（<!--skin:start--> … <!--skin:end-->），重跑會換掉舊的那段。
現實戰鬥與輿論戰用現實皮，內海戰鬥用內海皮。
用法：python3 tools/art/restyle_demos.py"""
import os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
M = os.path.join(ROOT, 'docs', 'mockups')
CUT = 'clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))'
REAL_TOKENS = ('--bg:#17111F;--bg1:#211829;--bg2:#2C2136;--line:#3A2D47;--ink:#F3E9FF;--ink2:#C9B8E8;--ink3:#8C7AA6;'
               '--pink:#F06AA0;--pinkhi:#F58DBA;--mint:#45D6C5;--strong:#FFFFFF;--tint:#F06AA014;--zebra:#ffffff06;'
               '--hp:#FF4A4A;--ld:#F06AA0;--ap:#F2C14E;--apc:#F2C14E;--cv:#5FB8E8')
HP = 'linear-gradient(90deg,#FF4A4A,#FF8A5C)'
LD = 'repeating-linear-gradient(120deg,#F06AA0 0 6px,#F58DBA 6px 9px)'


def real(p):
    return f'''
.{p}.{p}.{p}{{{REAL_TOKENS};--me:#F06AA0;--foe:#FF8A3D;border:0;background:#211829;background-image:linear-gradient(#ffffff05 1px,transparent 1px),linear-gradient(90deg,#ffffff05 1px,transparent 1px);background-size:16px 16px;box-shadow:inset 0 0 0 2px #45305C;{CUT};padding:16px}}
.{p}.{p}::before{{content:"";position:absolute;pointer-events:none}}
.{p} .{p}-top b{{color:var(--pink);font-weight:900}}
.{p} .{p}-slot,.{p} .{p}-u,.{p} .{p}-log,.{p} .{p}-skl,.{p} .{p}-c,.{p} .{p}-card,.{p} .{p}-topic{{border:0;box-shadow:inset 0 0 0 1px var(--line);{CUT}}}
.{p} .{p}-slot{{background:#1A1322}}
.{p} .{p}-u{{background:var(--bg2)}}
.{p} .{p}-u.act{{box-shadow:inset 0 0 0 2px var(--pink),0 0 14px #F06AA055}}
.{p} .{p}-btn{{border:0;background:var(--bg2);{CUT};font-weight:800}}
.{p} .{p}-btn:hover:not(:disabled){{background:#3A2B47;color:var(--ink)}}
.{p} .{p}-chip{{border-radius:999px;border:0;background:var(--bg2);font-weight:800;padding:2px 9px}}
.{p} .{p}-chip.on{{background:var(--pink);color:#fff}}
.{p} .{p}-bar{{height:8px;border-radius:4px;background:#2E2339;overflow:hidden}}
.{p} .{p}-bar i{{border-radius:4px 0 0 4px}}
.{p} .{p}-bar i[style*="--hp"]{{background:{HP}!important}}
.{p} .{p}-bar i[style*="--ld"]{{background:{LD}!important;box-shadow:0 0 6px #F06AA066}}
.{p} .{p}-log{{background:#120D19}}
.{p} .{p}-end{{border:0;box-shadow:inset 3px 0 0 var(--pink);background:#120D19}}
'''


def opinion_extra():
    return '''
.od .od-c{background:#1A1322;min-height:96px}
.od .od-c.me{background:color-mix(in srgb,#F06AA0 18%,#1A1322);box-shadow:inset 0 0 0 2px #F06AA0}
.od .od-c.foe{background:color-mix(in srgb,#FF8A3D 16%,#1A1322);box-shadow:inset 0 0 0 2px #FF8A3D}
.od .od-c.tg{outline:0;box-shadow:inset 0 0 0 2px var(--mint),0 0 12px #45D6C566}
.od .od-c .pt{color:var(--ap)}
.od .od-card{background:var(--bg2)}
.od .od-card.t1{box-shadow:inset 0 3px 0 #F2C14E,inset 0 0 0 1px var(--line)}
.od .od-card.t2{box-shadow:inset 0 3px 0 #B39DF0,inset 0 0 0 1px var(--line)}
.od .od-card.t3{box-shadow:inset 0 3px 0 #45D6C5,inset 0 0 0 1px var(--line)}
.od .od-wind{border:0;border-radius:5px;background:linear-gradient(90deg,#FF8A3D,#2E2339 50%,#F06AA0)}
.od .od-pp i{border-radius:2px}
'''


def net():
    nav = '#1E2346'
    return f'''
.nd.nd.nd{{--bg:#FFE6F0;--bg1:#F8C3D8;--bg2:#FFF4E8;--line:{nav};--ink:{nav};--ink2:#3B4170;--ink3:#6D6F94;--pink:#F06AA0;--pinkhi:#D9307A;--mint:#2EC2B0;--strong:{nav};--tint:#45D6C522;--zebra:#1E234608;
  --hp:#FF4A4A;--ld:#F06AA0;--ap:#F2B33D;--apc:#B07A00;--cv:#2EC2B0;
  border:3px solid {nav};border-radius:16px;background-color:#F8C3D8;background-image:radial-gradient(#ffffff70 1.2px,transparent 1.6px);background-size:14px 14px;box-shadow:6px 6px 0 {nav};padding:16px}}
.nd .nd-top b{{color:{nav};font-weight:900;background:#45D6C5;padding:2px 10px;border-radius:999px;border:2px solid {nav}}}
.nd .nd-slot{{background:#FFF4E8cc;border:2px solid {nav};border-radius:12px}}
.nd .nd-u{{background:#FFF4E8;border:2px solid {nav};border-left:6px solid #45D6C5;border-radius:10px;box-shadow:3px 3px 0 {nav}}}
.nd .nd-u.act{{border-color:#F06AA0;box-shadow:3px 3px 0 #F06AA0}}
.nd .nd-btn{{border:2px solid {nav};border-radius:999px;background:#FFF4E8;font-weight:800;box-shadow:2px 2px 0 {nav}}}
.nd .nd-btn:hover:not(:disabled){{background:#45D6C5;color:{nav}}}
.nd .nd-chip{{border:2px solid {nav};border-radius:999px;background:#FFF4E8;color:{nav};font-weight:800}}
.nd .nd-chip.on{{background:#F06AA0;color:#fff}}
.nd .nd-bar{{height:9px;border-radius:5px;background:#FFFFFF;border:2px solid {nav};overflow:hidden}}
.nd .nd-bar i[style*="--hp"]{{background:{HP}!important}}
.nd .nd-bar i[style*="--ld"]{{background:{LD}!important}}
.nd .nd-log,.nd .nd-skl{{background:#FFF4E8;border:2px solid {nav};border-radius:12px;color:#3B4170}}
.nd .nd-tip{{background:#FFF4E8;border:2px solid {nav};border-radius:10px;color:#3B4170;box-shadow:3px 3px 0 {nav}}}
.nd .nd-end{{border:2px solid {nav};border-radius:12px;background:#FFF4E8;color:#D9307A}}
.nd .nd-w path:not(.ic),.nd .nd-w circle.bg{{stroke:{nav};stroke-width:2}}
.nd .nd-w path.ic{{fill:{nav}}}
.nd .nd-w text{{fill:{nav}}}
'''


def wheel(p):
    # 行動圓環：現實皮的格子用面板色，邊用縫
    return f'''
.{p} .{p}-w path:not(.ic),.{p} .{p}-w circle.bg{{stroke:#17111F;stroke-width:2.5}}
.{p} .{p}-w .r-atk path:not(.ic){{fill:color-mix(in srgb,#FF4A4A 22%,#2C2136)}}
.{p} .{p}-w .r-res path:not(.ic){{fill:color-mix(in srgb,#F2C14E 18%,#2C2136)}}
.{p} .{p}-w .r-tac path:not(.ic){{fill:color-mix(in srgb,#8E7CC3 30%,#2C2136)}}
.{p} .{p}-w .r-skl circle.bg{{fill:color-mix(in srgb,#F06AA0 26%,#2C2136)}}
'''


def apply(name, css):
    path = os.path.join(M, name)
    s = open(path, encoding='utf-8').read()
    s = re.sub(r'<!--skin:start-->.*?<!--skin:end-->\n?', '', s, flags=re.S)
    block = f'<!--skin:start--><style>/* 新風格（tools/art/restyle_demos.py 產生） */{css}</style><!--skin:end-->\n'
    s = s.replace('<!--demo:end-->', block + '<!--demo:end-->', 1)
    s = re.sub(r'body\{margin:0;padding:24px 16px;background:var\(--bg\)', 'body{margin:0;padding:24px 16px;background:#17111F', s, count=1)
    open(path, 'w', encoding='utf-8').write(s)
    print('→', name)


if __name__ == '__main__':
    apply('combat-demo.html', real('cd') + wheel('cd'))
    apply('opinion-demo.html', real('od') + opinion_extra())
    apply('net-demo.html', net())
