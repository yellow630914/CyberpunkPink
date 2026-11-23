import json,re,sys,os
S=os.path.dirname(os.path.abspath(__file__))
ents=json.load(open(S+'/keep.json'))
ROMAN={'I':1,'II':2,'III':3,'IV':4,'V':5}
CLASSES={'近戰':'melee','霰彈槍':'shotgun','手槍':'pistol','衝鋒槍':'smg','步槍':'rifle','狙擊槍':'sniper','輕機槍':'lmg','重武器':'heavy'}
DEF_TYPE={'melee':'physical','shotgun':'physical','pistol':'physical','smg':'physical','rifle':'physical','sniper':'physical','lmg':'physical','heavy':'physical','neural_gun':'neural','neural_melee':'neural'}
DEF_PIERCE={'rifle':2,'sniper':4}
TYPES={'物理':'physical','神經':'neural','熱能':'thermal','電磁':'em','快感':'pleasure'}
FACTION_WORDS=('星旗','緋櫻','崑崙','蜜腺','夜鶯','萬華鏡','伊甸園','星旗製')
AIPREF={'weakest','overloaded','leader','nearest','netrunner'}
KIND={'有橋的人':'human','沒有橋的人':'unbridged','機器':'machine'}
MODKEY={'護甲':'armor','迴避':'evade','攻擊':'attack','行動點':'ap'}
def num(s): return float(s.replace('−','-'))
def split_top(s,seps='，、'):
    out=[];d=0;cur=''
    for ch in s:
        if ch in '（(': d+=1
        if ch in '）)': d-=1
        if d==0 and ch in seps: out.append(cur);cur=''
        else: cur+=ch
    out.append(cur);return [o.strip() for o in out if o.strip()]
def grades(s):
    m=re.match(r'^([IV]+)(?:～([IV]+))?$',s.strip()); a=ROMAN[m.group(1)]; b=ROMAN[m.group(2)] if m.group(2) else a
    return [a,b]
def position(s):
    m=re.search(r'(\d)～(\d)',s)
    if m: return list(range(int(m.group(1)),int(m.group(2))+1))
    m=re.search(r'(\d)',s); return [int(m.group(1))]
def bullet(L,label):
    for i,l in enumerate(L):
        if l.startswith('- **%s**'%label):
            first=l.split('：',1)[1] if '：' in l else ''
            sub=[]; j=i+1
            while j<len(L) and L[j].startswith('  '): sub.append(L[j].strip()[2:] if L[j].strip().startswith('- ') else L[j].strip()); j+=1
            return first.strip(),sub
    return None,[]
def mods(txt):
    first=txt.split('。')[0]
    if first.strip()=='照表': return {}
    m={}
    for tok in re.split(r'[、；，]',first):
        tok=tok.strip()
        r=re.match(r'^(生命|感載) ×([\d.]+)',tok)
        if r: m['hp' if r.group(1)=='生命' else 'load']=float(r.group(2)); continue
        r=re.match(r'^(護甲|迴避|攻擊|行動點) ([+−-]\d+)',tok)
        if r: m[MODKEY[r.group(1)]]=int(num(r.group(2))); continue
        r=re.match(r'^承受層數 ([+−-]\d+)',tok)
        if r: m['layers']=int(num(r.group(1))); continue
        r=re.match(r'^敏感度 (\d+)',tok)
        if r: m['sensitivity']=int(r.group(1)); continue
    return m
def ai(txt):
    clause=txt.split('。')[0]
    r={}
    p=re.search(r'prefer[:\s]*`?:?\s*`?(\w+)',clause)
    pr=p.group(1) if p else None
    f=re.search(r'focus`?\s*([\d.]+)',clause); fb=re.search(r'flee_below`?\s*([\d.]+)',clause)
    out={'prefer':pr,'focus':float(f.group(1)) if f else None}
    never='never_flee' in clause
    if fb: out['flee_below']=float(fb.group(1))
    if not fb and re.search(r'不撤退|不逃',clause): never=True
    if fb and float(fb.group(1))==0 and re.search(r'不撤退',clause): never=True
    if never:
        out['flee_below']=0
    return out,never
def clean_adult(txt):
    t=txt.split('。')[0]
    t=re.sub(r'（[^）]*）','',t)
    if t.startswith('沒有'): return None
    return [x.strip() for x in t.split('、') if x.strip()]
def loot(txt):
    sents=[s for s in re.split(r'。',txt) if s.strip()]
    out=[]
    for si,s in enumerate(sents):
        if si>0: out.append(s.strip()); continue
        buf='';d=0;items=[]
        for ch in s:
            if ch in '（(': d+=1
            if ch in '）)': d-=1
            if d==0 and ch in '，；':
                items.append((buf,ch));buf=''
            else: buf+=ch
        if buf.strip(): items.append((buf,''))
        cur=[]
        prev_sep='，'
        for t,sep in items:
            t=t.strip()
            if not t: continue
            if cur and re.match(r'^(([IV]+)(～[IV]+)? ?級|保證|沒有殘響|有殘響|都要)',t):
                cur[-1]=cur[-1]+prev_sep+t
            else: cur.append(t)
            prev_sep=sep or '，'
        out+=cur
    return [{'text':o} for o in out]
out_sep={}
def sig(first,sub):
    if not sub:
        if first.startswith('沒有'): return []
        name,_,text=first.partition('：'); return [{'name':name.strip(),'text':text.strip()}]
    res=[]
    for s in sub:
        s2=s.replace('**','')
        name,_,text=s2.partition('：')
        res.append({'name':name.strip(),'text':text.strip()})
    return res
def weapon_sent(sent):
    sent=sent.strip()
    if not sent or sent.startswith('沒有'): return None
    segs=split_top(sent)
    seg0=segs[0]
    m=re.match(r'^([^（]*)(?:（(.*)）)?(.*)$',seg0)
    head,par=m.group(1).strip(),m.group(2)
    cls=None;name=None;desc=''
    if head in CLASSES or head=='神經武器':
        cls=head; name=par.split('，')[0] if par else None
    else:
        name=head
        seg1=segs[1] if len(segs)>1 else ''
        h1=re.match(r'^([^（]*)(?:（(.*)）)?',seg1)
        if h1.group(1).strip() in CLASSES or h1.group(1).strip()=='神經武器': cls=h1.group(1).strip(); desc=h1.group(2) or ''
        elif par:
            for w in list(CLASSES)+['神經武器']:
                if w in par: cls=w;desc=par;break
    if cls is None:
        for w in CLASSES:
            if w in head: cls=w;break
    return {'seg':segs,'cls':cls,'name':name,'desc':desc,'par':par,'sent':sent}
def build_weapon(w):
    sent=w['sent'];cls=w['cls']
    mag=re.search(r'彈匣 (\d)',sent)
    if cls=='神經武器':
        ctx=(w['desc'] or '')+(w['par'] or '')
        if re.search('鞭',ctx): c='neural_melee'
        elif mag: c='neural_gun'
        elif re.search('霧',ctx): c='neural_melee'
        elif '感官彈槍' in ctx: c='neural_gun'
        else: c='neural_melee'
    else: c=CLASSES[cls]
    d={'class':c}
    nm=w['name']
    if nm and not nm.endswith('型') and not re.match(r'^裝|^小口徑|^大口徑|^具名',nm) and nm not in FACTION_WORDS: d['name']=nm
    t=None
    for s in w['seg'][1:]:
        s=s.strip()
        if s in TYPES: t=TYPES[s];break
        mm=re.match(r'^(物理|神經|熱能|電磁|快感)',s)
        if mm and t is None and (len(s)<=3 or s[2:3]=='（'): t=TYPES[mm.group(1)]
    if t and t!=DEF_TYPE[c]: d['type']=t
    pr=re.search(r'穿甲 (\d)',sent)
    if pr: d['pierce']=int(pr.group(1))
    if mag: d['mag']=int(mag.group(1))
    rg=re.search(r'(?:距離|射程|範圍) ?(\d)～(\d)',sent)
    if rg: d['range']=[int(rg.group(1)),int(rg.group(2))]
    else:
        r1=re.search(r'適用距離 (\d)(?!～)',sent)
        if r1: d['range']=[int(r1.group(1)),int(r1.group(1))]
    tr=[]
    if re.search(r'拉近一格|拉到第 1 格',sent): tr.append('pull')
    if re.search(r'往後推一格|推一格',sent): tr.append('push')
    if tr: d['traits']=tr
    return d
def weapons_of(first,sub):
    texts=[]
    if first: texts+= [s for s in first.split('。') if s.strip()]
    for s in sub: texts+=[x for x in s.split('。') if x.strip()]
    res=[]
    for t in texts:
        if t.strip().startswith('沒有') or t.strip().startswith('他每回合拍攝'): continue
        if re.search(r'^(IV 級起|武裝無人機|機械獵犬|飛劍|無人攝影機|自組無人機|機甲|怪癖|胭脂堂不用)',t): continue
        if '快駭' in t.split('，')[0]: continue
        w=weapon_sent(t)
        if not w or not w['cls']: res.append(('??',t)); continue
        res.append(build_weapon(w))
    return res


# ---- 跟著主人的附屬單位（dev/work/M2-enemy-encounter.md 第 5 項；ENEMIES 第 10 節「跟著主人寫在主人的條目裡」那一列）----
# 名冊把這幾種東西只寫在主人的條目裡（「武器」那一行的「…一台」「…兩隻」），沒有自己的兵種表：
#   星旗的武裝無人機（軍士長 en_sb_sergeant）、崑崙的飛劍（劍靈使 en_kl_swordmaster）、萬華鏡的無人攝影機（直播導演 en_kd_director）、
#   黑泉的機械獵犬（獵犬操作員 en_bs_handler）、同人眾的自組無人機（無人機社團 en_dj_dronecircle）。
# 引擎的格式（features/enemies，M1b-enemy-units）：主人的條目寫 attached: [{ enemy, count?, slot? }]，開打時掛在格上、owner 是主人、
# 主人倒下之後自律；被掛的是一個 position.size: 'overlay' 的兵種（要查得到）。所以這裡在轉換主人的時候寫 attached，並一併產生那幾個 overlay 兵種。
# 名冊沒有這幾個東西的數值，只有一句話，所以數值用最小的寫法（生命 ×0.5、武器照那一句、AI 照無人機的一般寫法 ENEMIES 第 10 節）；
# 名冊補了再改這裡。這個腳本只負責轉換；engine/data 不由這一張工單重跑。
#
# 詞條 `hounds`（COMMISSIONS 第 9 節、COMMISSION_TEMPLATES「機械獵犬（hounds）」）對到的兵種：HOUNDS_ENEMY = en_bs_hound（黑泉的機械獵犬）。
#   「每一場現實遭遇多兩隻小型無人機（各 0.5 點，用機械獵犬的數值）」有兩種寫法，由生成委託的功能（M2-commission-gen）挑：
#   遭遇的 foes 多兩筆 { enemy: 'en_bs_hound' }（沒有主人、每輪自己動）；或替遭遇裡位階最高的那個敵人給 UnitRef.attached: [{ enemy: 'en_bs_hound', count: 2 }]
#   （蓋掉他自己的附屬單位）。「對獵犬有效的電磁武器傷害 +2」是戰鬥規則，不在資料裡。
HOUNDS_ENEMY='en_bs_hound'
DRONE_AI={'prefer':'nearest','focus':0.6,'flee_below':0,'never_flee':True}
def overlay_entry(id,name,faction,grades,kind,desc,weapons=None,mods=None,prefer=(2,3)):
    e={'id':id,'name':name,'faction':faction,'rank':'minion','grades':list(grades),'kind':'machine','mode':'lethal',
       'position':{'prefer':list(prefer),'size':'overlay'},'overlay':{'kind':kind},
       'weapons':list(weapons or []),'ai':dict(DRONE_AI),'desc':desc}
    if mods: e['mods']=dict(mods)
    return e
# (主人的 id, 主人的 attached, 要產生的 overlay 兵種)
FOLLOWERS=[
    # 武裝無人機一台：和她重疊、不佔格
    ('en_sb_sergeant',[{'enemy':'en_sb_drone'}],[
        overlay_entry('en_sb_drone','星旗的武裝無人機','starbelle',[4,5],'attack','一台星旗的武裝無人機，跟在軍士長身邊，機身漆著星旗的軍用塗裝。',[{'class':'pistol'}],{'hp':0.5})]),
    # 飛劍一台：傷害比手槍低一級，她倒下時飛劍就掉下來（自律；「傷害低一級」在武器的骰數上，這裡先用手槍類）
    ('en_kl_swordmaster',[{'enemy':'en_kl_flying_sword'}],[
        overlay_entry('en_kl_flying_sword','飛劍','kunlun',[3,4],'attack','一把懸在劍靈使身邊的飛劍，劍身上有崑崙的刻印，她兩指一併它就轉向。',[{'class':'pistol','name':'飛劍'}],{'hp':0.5})]),
    # 無人攝影機一台：不攻擊（偵察型，沒有武器）；被擊落時這場的錄影少一半（還沒有規則）
    ('en_kd_director',[{'enemy':'en_kd_camera'}],[
        overlay_entry('en_kd_camera','無人攝影機','kaleido',[3,4],'scout','一台飄在導演身邊的無人攝影機，鏡頭一直對著場上最狼狽的那個人。',None,{'hp':0.5})]),
    # 機械獵犬兩隻：開場掛在她這一方的第 1、2 格（slot 1 起，第二隻挪到最近的空格）；詞條 hounds 也用這一種
    ('en_bs_handler',[{'enemy':HOUNDS_ENEMY,'count':2,'slot':1}],[
        overlay_entry(HOUNDS_ENEMY,'黑泉的機械獵犬','blackspring',[3,4],'attack','一隻背上漆著黑泉紋章的機械獵犬，四條腿的關節裸露在外，咬合的下顎是金屬的。',[{'class':'melee','name':'咬擊'}],{'hp':0.5},(1,2))]),
    # 自組無人機：I 級一台（攻擊型，神經）、II 級兩台（多一台干擾型，電磁）。這裡寫 I 級的一台；II 級的第二台由遭遇用 UnitRef.attached
    # [{ enemy: 'en_dj_drone_atk' }, { enemy: 'en_dj_drone_jam' }] 蓋掉（兵種的 attached 不隨等級變）
    ('en_dj_dronecircle',[{'enemy':'en_dj_drone_atk'}],[
        overlay_entry('en_dj_drone_atk','自組無人機（攻擊型）','doujin',[1,2],'attack','用模型零件組起來的無人機，機身畫著社團自己的角色，下面掛著一把裝感官彈的小槍。',[{'class':'pistol','type':'neural'}],{'hp':0.5}),
        overlay_entry('en_dj_drone_jam','自組無人機（干擾型）','doujin',[2,2],'jammer','用模型零件組起來的無人機，天線比機身還長，專門打斷別人的義體。',[{'class':'pistol','type':'em','name':'干擾槍'}],{'hp':0.5})]),
]
def attach_followers(res):
    """主人的條目補上 attached，並把被掛的 overlay 兵種接在後面（已經有同 id 的不重複加；主人沒有轉進來就不掛）。"""
    by={e['id']:e for e in res}; have=set(by)
    for master,attached,entries in FOLLOWERS:
        m=by.get(master)
        if m is None: continue
        m['attached']=[dict(a) for a in attached]
        for o in entries:
            if o['id'] not in have:
                res.append(json.loads(json.dumps(o))); have.add(o['id'])
    return res

OVERRIDE_W={'en_sb_gunner':[None,{'class':'heavy','name':'榴彈發射器','mag':1}]}
OMIT0={'en_orihime_guardroid':'ai.prefer 是 bridged，格式的 prefer 沒有這個值','en_rose_wrecker':'ai.prefer 是 bridged','en_rose_mechanic':'ai.prefer 是 bridged','en_strp_cutter':'ai.prefer 是 bridged','en_strp_boss':'ai.prefer 是 bridged','en_bare_puller':'ai.prefer 是 bridged','en_bare_high':'ai.prefer 是 bridged','en_angel_cherub':'AI 行沒有 prefer（只寫「跟著生命比例最低的同伴換格」）；武器「沒有」','en_kd_paparazzi':'武器「沒有」，格式要求至少一把'}
OMIT={}
def build(allow_omitted=False):
    res=[];skipped=[]
    for x in ents:
        if x['id'] in OMIT and not allow_omitted: skipped.append(x['id']);continue
        L=x['lines']
        t=[l for l in L if l.startswith('| ') and not l.startswith('| 位階') and not l.startswith('|---')][0]
        c=[a.strip() for a in t.split('|')[1:-1]]
        rank={'雜兵':'minion','精英':'elite','首領':'boss'}[c[0]]
        kt=c[2]
        if kt.startswith('吉祥物'): kind='mascot'
        elif kt.startswith('沒有橋的人'): kind='unbridged'
        elif kt.startswith('機器'): kind='machine'
        else: kind='human'
        mode=c[4]
        fac=x['fac']; fac='none' if fac.startswith('none:') else fac
        a_first,_=bullet(L,'AI')
        a,never=ai(a_first)
        e={'id':x['id'],'name':x['name'],'faction':fac,'rank':rank,'grades':grades(c[1]),'kind':kind,'mode':mode}
        pos={'prefer':position(c[3])}
        if 'cover_use 0' in a_first: pos['cover_use']=0
        e['position']=pos
        mf,_=bullet(L,'數值修正'); md=mods(mf)
        if md: e['mods']=md
        wf,ws=bullet(L,'武器')
        ww=weapons_of(wf,ws)
        for i,o in enumerate(OVERRIDE_W.get(x['id'],[])):
            if o is not None: ww.insert(i,o)
        assert all(isinstance(w,dict) for w in ww),(x['id'],ww)
        e['weapons']=ww
        A={'prefer':a['prefer'],'focus':a['focus']} if a['prefer'] else {'focus':a['focus']}
        if 'flee_below' in a: A['flee_below']=a['flee_below']
        if never: A['never_flee']=True
        if not a['prefer']: A['note']=a_first.split('；')[0].split('：')[-1].strip()
        e['ai']=A
        d=c[5]
        m=re.match(r'^`(\w+)`$',d)
        if m: e['defeat']=m.group(1)
        sf,ss=bullet(L,'招牌行動'); e['signature']=sig(sf,ss)
        lf,_=bullet(L,'掉落'); e['loot']=loot(lf)
        af,_=bullet(L,'成人場景')
        if af is not None: e['adult']=clean_adult(af)
        df,_=bullet(L,'樣子'); e['desc']=df
        res.append(e)
    attach_followers(res)
    return res,skipped
if __name__=='__main__':
    allow=len(sys.argv)>2 and sys.argv[2]=='all'
    res,sk=build(allow)
    json.dump(res,open(sys.argv[1],'w'),ensure_ascii=False,indent=2)
    print(len(res),'skipped',sk)
