"""Collect public faculty names and affiliations, never personal contact details."""
import concurrent.futures, hashlib, html, json, re, urllib.request
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
CHECKED_ON=datetime.now(timezone(timedelta(hours=9))).date().isoformat()
def clean_name(name):
    name=re.sub(r'\([^)]*\)','',name).strip()
    name=re.sub(r'\s*(?:명예교수|초빙교수|겸임교수|조교수|부교수|교수)$','',name).strip()
    if '/' in name and re.search('[가-힣]',name): name=next((part.strip() for part in name.split('/') if re.search('[가-힣]',part)),name)
    match=re.match(r'^([가-힣]{2,6})(?:\s+[A-Za-z])',name)
    if match:name=match.group(1)
    if re.fullmatch(r'[가-힣]\s+[가-힣]{1,3}',name):name=name.replace(' ','')
    return name
class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []
    def text(self):
        return re.sub(r'\s+', ' ', ''.join(c if isinstance(c,str) else c.text()+' ' for c in self.children)).strip()
    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c, Node): yield from c.walk()
class Tree(HTMLParser):
    def __init__(self, body):
        super().__init__(); self.root=Node(); self.at=self.root; self.feed(body)
    def handle_starttag(self, tag, attrs):
        n=Node(tag,attrs,self.at); self.at.children.append(n)
        if tag not in ('img','input','br','hr','meta','link','source','area','wbr','embed','param'): self.at=n
    def handle_endtag(self, tag):
        n=self.at
        while n.parent:
            if n.tag==tag: self.at=n.parent; return
            n=n.parent
    def handle_data(self, data): self.at.children.append(data)
def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=18) as r:
        raw=r.read(); charset=r.headers.get_content_charset() or 'utf-8'
        return Tree(raw.decode(charset,errors='replace')).root
def links(tree,url):
    return [(urljoin(url,n.attrs['href']), n.text()) for n in tree.walk() if n.tag=='a' and n.attrs.get('href') and not n.attrs['href'].startswith(('#','javascript:','mailto:','tel:'))]
def official(url): return urlparse(url).hostname and urlparse(url).hostname.endswith('.hanyang.ac.kr')
def faculty_link(label): return bool(re.search(r'교수(?:진|소개|소개|안내)|전임교[원수]|비전임|겸임교|명예교|Faculty|Professors',label,re.I)) and len(label)<70
def extract(tree,url,college,department):
    out=[]
    for n in tree.walk():
        cls=n.attrs.get('class','')
        aic_name=n.tag=='h6' and n.parent and n.parent.tag=='dd' and 'aic.hanyang.ac.kr' in url
        profile_name=aic_name or 'hyu-profile-info-title-name' in cls or (cls=='name' and n.parent and n.parent.attrs.get('class')=='info') or (n.tag=='h5' and n.parent and n.parent.attrs.get('class')=='name_wrap')
        lions_name=n.tag=='h3' and n.parent and n.parent.parent and n.parent.parent.attrs.get('class')=='profile-card'
        if not profile_name and not lions_name and not (n.tag in ('h3','h4','dt') and re.fullmatch(r'[가-힣A-Za-z .·-]{2,45}\s*(?:교수|부교수|조교수)',n.text())): continue
        name=n.text()
        if lions_name: name=next((c.text() for c in n.children if isinstance(c,Node) and c.tag=='b'),name)
        if n.tag=='h5': name=''.join(c for c in n.children if isinstance(c,str)).strip()
        if aic_name: name=''.join(c for c in n.children if isinstance(c,str)).strip()
        if cls=='name': name=next((c.text() for c in n.children if isinstance(c,Node)),name)
        name=clean_name(name)
        if not name or len(name)>60 or '\ufffd' in name: continue
        if re.search(r'소개|대학|교수진|전임|강사',name): continue
        # Use the original source affiliation; do not infer that a professor teaches a particular course.
        c,d=college,department
        if aic_name:
            affiliation=next((p.text() for p in n.parent.walk() if p.tag=='p'),'')
            affiliation=re.sub(r'\s*(?:명예교수|초빙교수|겸임교수|조교수|부교수|교수)$','',affiliation).strip()
            parts=affiliation.split(' ',1)
            if len(parts)!=2 or parts[0] not in ['공학대학','소프트웨어융합대학','첨단융합대학','약학대학','경상대학','글로벌문화통상대학','커뮤니케이션&컬처대학','디자인대학','예체능대학']:continue
            c,d=parts
        if lions_name:
            card=n.parent.parent
            for dl in card.walk():
                if dl.tag=='dl':
                    items=[x for x in dl.children if isinstance(x,Node)]
                    if len(items)>1 and items[0].text()=='소속':
                        parts=items[1].text().split(' ',1)
                        if len(parts)==2:c,d=parts
        key=c+'|'+d+'|'+name
        ancestor=n
        for _ in range(7):
            mails=set(re.findall(r'[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9.-]+\.)?hanyang\.ac\.kr',ancestor.text(),re.I))
            if len(mails)==1:
                key='official-profile:'+next(iter(mails)).lower();break
            if not ancestor.parent:break
            ancestor=ancestor.parent
        out.append({'id':'hyu-'+hashlib.sha256(key.encode()).hexdigest()[:20], 'name':name,'college':c,'department':d,'sourceUrl':url,'verifiedOn':CHECKED_ON})
    return out
def main():
    colleges=[('공학대학','https://ieng.hanyang.ac.kr'),('소프트웨어융합대학','https://computing.hanyang.ac.kr'),('약학대학','https://pharmacy.hanyang.ac.kr'),('첨단융합대학','https://atc.hanyang.ac.kr'),('글로벌문화통상대학','https://lan-cul.hanyang.ac.kr'),('커뮤니케이션&컬처대학','https://ccss.hanyang.ac.kr'),('경상대학','https://site.hanyang.ac.kr/web/cbe/-02-1-3'),('디자인대학','https://design.hanyang.ac.kr'),('예체능대학','https://sportsnarts.hanyang.ac.kr'),('LIONS칼리지','https://lions.hanyang.ac.kr')]
    jobs=[]; failures=[]; seen=set(); rows=[]; sources=[]
    try:
        root=fetch('https://www.hanyang.ac.kr/e_college_department-info')
        college=''
        for n in root.walk():
            if n.tag=='h2' and any(c==n.text() for c,_ in colleges): college=n.text()
            if college and n.tag=='a' and n.attrs.get('href') and official(n.attrs['href']) and len(n.text())<80 and re.search(r'학부|학과|전공',n.text()): jobs.append((n.attrs['href'],college,n.text()))
    except Exception as e: print('University index:',type(e).__name__)
    jobs += [(url,c,'경제학부' if c=='경상대학' else c) for c,url in colleges]
    departments=[('공학대학',slug,label) for slug,label in [('arch','건축학부'),('ericacivil','건설환경공학과'),('traffic','교통·물류공학과'),('eece','전자공학부'),('mscheme','재료화학공학과'),('ericacheme','배터리소재화학공학과'),('mech','기계공학과'),('ime','산업경영공학과'),('robot','로봇공학과'),('energybio','에너지바이오학과'),('ocean','해양융합공학과'),('cie','융합시스템공학과')]]
    departments += [('소프트웨어융합대학',slug,label) for slug,label in [('sw','컴퓨터학부'),('ict','ICT융합학부'),('aix','인공지능학과'),('mds','수리데이터사이언스학과'),('datasec','융합보안학과')]]
    departments += [('첨단융합대학',slug,label) for slug,label in [('semiconver','차세대반도체융합학부'),('biopham','바이오신약융합학부'),('defenseintelinfo','국방지능정보융합학부')]]
    jobs += [('https://'+slug+'.hanyang.ac.kr',c,d) for c,slug,d in departments]
    jobs += [('https://lions.hanyang.ac.kr/lions/sub/sub1-7.aspx','LIONS칼리지','LIONS칼리지'),('https://ccss.hanyang.ac.kr/bbs/board.php?tbl=bbs15_1','커뮤니케이션&컬처대학','커뮤니케이션&컬처대학'),('https://aic.hanyang.ac.kr/about/professor1.php','소프트웨어융합대학','소프트웨어융합대학')]
    jobs += [('https://site.hanyang.ac.kr/web/cbe/-02-'+str(i)+'-3','경상대학',d) for i,d in [(1,'경제학부'),(2,'경영학부'),(3,'보험계리학과'),(4,'회계세무학과')]]
    def load(job):
        u,c,d=job
        try: return job,fetch(u),None
        except Exception as e: return job,None,type(e).__name__
    for depth in range(3):
        batch=[]
        for j in jobs:
            if j[0] not in seen: seen.add(j[0]); batch.append(j)
        jobs=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for (url,c,d),tree,err in pool.map(load,batch):
                if err: failures.append({'url':url,'reason':err}); continue
                title=next((n.text() for n in tree.walk() if n.tag=='title'),d)
                found=extract(tree,url,c,d)
                if found: rows.extend(found); sources.append({'url':url,'college':c,'department':d,'count':len(found)})
                if depth<2:
                    for u,label in links(tree,url):
                        if official(u) and (faculty_link(label) or re.search(r'/(?:professors?|faculty|staff)(?:[/?.]|$)',u) or ('aic.hanyang.ac.kr' in u and 'professor1.php?' in u)): jobs.append((u,c,d))
                print(depth,c,d,len(found),flush=True)
    unique={}
    for r in rows:
        key=r['id']
        old=unique.get(key)
        if old is None or (old['department']==old['college'] and r['department']!=r['college']): unique[key]=r
    previous=ROOT/'data/professors.json'
    if previous.exists():
        old=json.loads(previous.read_text(encoding='utf-8'))
        failed={f['url'] for f in failures}
        for row in old.get('professors',[]):
            if row['sourceUrl'] in failed:unique.setdefault(row['id'],row)
    result={'checkedOn':CHECKED_ON,'coverage':'partial','description':'공식 페이지에서 확인된 교수진입니다. 강사·겸임교원 및 일부 학과는 누락될 수 있습니다.','professors':sorted(unique.values(),key=lambda r:(r['college'],r['department'],r['name'])),'sources':sources,'unavailableSources':failures}
    if not result['professors']: raise RuntimeError('No verified faculty; existing catalog preserved')
    dest=ROOT/'data/professors.json'; dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('SAVED',len(unique),'sources',len(sources),'unavailable',len(failures))
if __name__=='__main__': main()
