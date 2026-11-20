#!/usr/bin/env python3
"""把一個主體檔畫成檢查用的總覽：python3 tools/art/subjects/sheet.py weapons  → 寫到 scratchpad 指定的 png 路徑（第二個參數）"""
import importlib, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mod = importlib.import_module('subjects.' + sys.argv[1])
out = sys.argv[2]
style = '<style>.s{stroke:var(--o);stroke-width:9;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke}text{font:12px sans-serif}</style>'
items = list(mod.SUBJECTS.items())
cols, cw, ch = 8, 150, 170
rows = (len(items) + cols - 1) // cols
cells = []
for k, (name, body) in enumerate(items):
    x, y = (k % cols) * cw, (k // cols) * ch
    for j, (bg, v) in enumerate([('#17111F', '--o:#17111F;--a:#F06AA0;--b:#8E7CC3;--c:#F3E9FF'), ('#F8C3D8', '--o:#1E2346;--a:#F06AA0;--b:#45D6C5;--c:#FFF4E8')]):
        cells.append(f'<g transform="translate({x + j * 72} {y})" style="{v}"><rect width="70" height="70" fill="{bg}"/><rect x="0" y="0" width="70" height="70" fill="none" stroke="#555" stroke-dasharray="2 2"/><line x1="35" y1="0" x2="35" y2="70" stroke="#555" stroke-width=".5"/><line x1="0" y1="35" x2="70" y2="35" stroke="#555" stroke-width=".5"/><svg width="70" height="70" viewBox="0 0 200 200">{body}</svg></g>')
    cells.append(f'<g transform="translate({x} {y + 74})" style="--o:#17111F;--a:#F06AA0;--b:#8E7CC3;--c:#F3E9FF"><rect width="144" height="72" fill="#17111F"/><svg width="72" height="72" viewBox="0 0 200 200" x="36">{body}</svg></g>'
                 f'<text x="{x}" y="{y + 162}" fill="#222">{name[:24]}</text>')
W, H = cols * cw, rows * ch
svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{style}</defs><rect width="{W}" height="{H}" fill="#fff"/>{"".join(cells)}</svg>'
tmp = out + '.html'
open(tmp, 'w').write(f'<!doctype html><body style="margin:0">{svg}</body>')
js = f"const {{chromium}}=require('playwright');(async()=>{{const b=await chromium.launch();const p=await b.newPage({{viewport:{{width:{W},height:{H}}}}});await p.goto('file://{tmp}');await p.screenshot({{path:'{out}'}});await b.close();}})();"
subprocess.run(['node', '-e', js], check=True)
print('→', out, len(items), 'subjects')
