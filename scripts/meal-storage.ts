import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadMealEnvironment, copyVerified, inventory } from '../lib/meal/runtime.ts';
import { mealStorageRoot, atomicJson, acquireMealLock } from '../lib/meal/sync-store.ts';
import { observationRoot } from '../lib/meal/history-store.ts';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');loadMealEnvironment(project);
const args=process.argv.slice(2),mode=args[0]??'status',arg=(name:string,fallback='')=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
function outside(path:string){const value=resolve(path),rel=relative(project,value);if(!rel||(!isAbsolute(rel)&&!rel.startsWith('..')))throw Error('저장/백업 경로는 프로젝트 외부여야 합니다.');return value;}
function locked<T>(roots:string[],fn:()=>T):T{const releases:(()=>void)[]=[];try{for(const root of [...new Set(roots)].sort()){const release=acquireMealLock(root);if(!release)throw Error('수집 중이므로 복사를 중단합니다: '+root);releases.push(release);}return fn();}finally{releases.reverse().forEach(release=>release());}}
function verifyBackup(root:string){const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')) as {schemaVersion:number;files:{path:string;bytes:number;sha256:string}[]};if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw Error('백업 manifest 확인 필요');const actual=new Map(inventory(root).filter(file=>file.path!=='manifest.json').map(file=>[file.path,file]));if(actual.size!==manifest.files.length)throw Error('백업 파일 수 불일치');for(const file of manifest.files){if(file.path.split(/[\\/]/).some(part=>part==='..')||isAbsolute(file.path))throw Error('잘못된 백업 경로');const found=actual.get(file.path);if(!found||found.sha256!==file.sha256||found.bytes!==file.bytes)throw Error('백업 무결성 불일치: '+file.path);}return manifest.files;}
function main(){
  if(mode==='setup'){
    const base=outside(arg('directory',join(homedir(),'BOKAK-data'))),sync=join(base,'meal-sync'),history=join(base,'meal-observations');
    for(const [name,target]of [['MEALS_STORAGE_DIR',sync],['MEALS_OBSERVATIONS_DIR',history]])if(process.env[name]&&resolve(process.env[name]!)!==target)throw Error(name+'의 기존 설정과 다릅니다. 자동으로 덮어쓰지 않습니다.');
    const results=locked([sync,history],()=>[['meal-sync',sync],['meal-observations',history]].map(([folder,target])=>{if(existsSync(join(target,'current.json'))||existsSync(join(target,'catalog-index.json')))return {store:folder,files:0,reusedExisting:true};const source=join(project,'data',folder);const sourceRelease=existsSync(source)?acquireMealLock(source):null;if(existsSync(source)&&!sourceRelease)throw Error('기존 저장소 수집 진행 중');try{return {store:folder,files:copyVerified(source,target).length};}finally{sourceRelease?.();}}));
    const env=join(project,'.env.local');let text=existsSync(env)?readFileSync(env,'utf8'):'';
    for(const [name,target]of [['MEALS_STORAGE_DIR',sync],['MEALS_OBSERVATIONS_DIR',history]])if(!new RegExp('^'+name+'=', 'm').test(text))text+='\n'+name+'='+JSON.stringify(target.replaceAll('\\','/'))+'\n';
    writeFileSync(env,text,{mode:0o600});console.log(JSON.stringify({base,verifiedCopies:results,sourceFilesKept:true,restartNextRequired:true}));return;
  }
  if(mode==='backup'){
    const destination=outside(arg('to'));if(!arg('to')||existsSync(destination))throw Error('새 --to 백업 폴더를 지정하세요. 기존 폴더는 덮어쓰지 않습니다.');
    locked([mealStorageRoot(project),observationRoot()],()=>{mkdirSync(destination,{recursive:true});copyVerified(mealStorageRoot(project),join(destination,'meal-sync'));copyVerified(observationRoot(),join(destination,'meal-observations'));const files=inventory(destination);atomicJson(join(destination,'manifest.json'),{schemaVersion:1,createdAt:new Date().toISOString(),files});console.log(JSON.stringify({backup:destination,verifiedFiles:verifyBackup(destination).length}));});return;
  }
  if(mode==='verify'){const source=resolve(arg('from'));console.log(JSON.stringify({backup:source,verifiedFiles:verifyBackup(source).length}));return;}
  if(mode==='restore'){
    if(!arg('from')||!arg('directory'))throw Error('--from과 새 --directory가 필요합니다.');const source=resolve(arg('from')),destination=outside(arg('directory'));if(existsSync(destination))throw Error('복원은 존재하지 않는 새 폴더에만 가능합니다.');verifyBackup(source);copyVerified(join(source,'meal-sync'),join(destination,'meal-sync'));copyVerified(join(source,'meal-observations'),join(destination,'meal-observations'));console.log(JSON.stringify({restoredTo:destination,files:inventory(destination).length,note:'새 Clone에서 meals:storage setup --directory로 연결하세요.'}));return;
  }
  if(mode!=='status')throw Error('setup/backup/verify/restore/status 중 선택하세요.');
  console.log(JSON.stringify({storage:mealStorageRoot(project),observations:observationRoot(),files:inventory(mealStorageRoot(project)).length+inventory(observationRoot()).length}));
}
try{main();}catch(error){console.error(error instanceof Error?error.message:'저장소 작업 실패');process.exitCode=1;}
