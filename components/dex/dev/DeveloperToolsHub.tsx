import Link from 'next/link';
const TOOLS=[
  {href:'/dex/dev/design',name:'디자인 실험실',description:'컬렉션 앨범 방향으로 학식·인연·강의 화면을 비교합니다.'},
  {href:'/dex/dev/collection',name:'컬렉션 실험실',description:'가상 카드 1~100장의 묶음·정렬·밀도를 확인합니다.'},
  {href:'/dex/dev/editions',name:'카드 에디션 연출',description:'NORMAL부터 GOLDEN까지 카드 공개를 미리 봅니다.'},
  {href:'/dex/dev/rarity',name:'출현 희귀도 미리보기',description:'보류 중인 메뉴 출현 희귀도 연출을 별도로 확인합니다.'},
];
export function DeveloperToolsHub(){
  return <div className="dex-dev-hub"><Link href="/dex" className="dex-back">← 도감 홈</Link><h2>개발자 도구</h2><p className="dex-muted">개발 환경에서만 열리는 미리보기입니다. 아래 네 도구는 실제 개인 기록을 저장하지 않습니다.</p><div className="dex-dev-tools">{TOOLS.map(tool=><Link key={tool.href} href={tool.href} data-testid="devtool-card"><h3>{tool.name} ↗</h3><p>{tool.description}</p></Link>)}</div><details className="dex-tray"><summary>추가 검증 도구</summary><Link href="/dex/dev/storage" className="underline">저장 엔진 검증 · 별도 개발 DB</Link><p className="dex-small dex-muted">기존 검증 도구를 보존했습니다. 개인 DB와 분리된 개발 저장소만 사용합니다.</p></details></div>;
}
