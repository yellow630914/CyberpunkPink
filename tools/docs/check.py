#!/usr/bin/env python3
"""檢查文件：斷掉的連結，以及「[名字](路徑) 第 N 節／N.M 節」指向不存在的章節。
用法：python3 tools/docs/check.py"""
import glob, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
os.chdir(ROOT)
files = ['README.md'] + sorted(glob.glob('docs/**/*.md', recursive=True))
LINK = re.compile(r'\]\(([^)\s]+)\)')
REF = re.compile(r'\]\(([^)\s#]+\.md)\)\s*(?:第\s*)?(\d+(?:\.\d+)*)(?:\s*[、～]\s*(\d+(?:\.\d+)*))?\s*(?:節|\|)')

def sections(path):
    out = set()
    for line in open(path, encoding='utf-8'):
        m = re.match(r'^#{2,4}\s+(?:[①-⑩]\s*)?(\d+(?:\.\d+)*)[.、\s]', line)
        if m:
            out.add(m.group(1).rstrip('.'))
    return out

cache, bad = {}, 0
for f in files:
    text = open(f, encoding='utf-8').read()
    for t in LINK.findall(text):
        if re.match(r'^[a-z]+:', t) or t.startswith('#'):
            continue
        p = os.path.normpath(os.path.join(os.path.dirname(f), t.split('#')[0]))
        if not os.path.exists(p):
            bad += 1
            print(f'斷掉的連結  {f}: {t}')
    for m in REF.finditer(text):
        p = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        if not os.path.exists(p):
            continue
        secs = cache.setdefault(p, sections(p))
        for num in (m.group(2), m.group(3)):
            if num and num not in secs:
                bad += 1
                print(f'沒有這一節  {f}: {os.path.basename(p)} {num}')
print(f'{len(files)} 個檔案，{bad} 個問題')
sys.exit(1 if bad else 0)
