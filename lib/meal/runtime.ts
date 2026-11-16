import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, constants } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
/** CLI entry points call this explicitly; importing a read-only server module never loads or writes files. */
export function loadMealEnvironment(root:string){const file=join(root,'.env.local');if(existsSync(file))loadEnvFile(file);}
export interface FileDigest {path:string;bytes:number;sha256:string}
export function inventory(root:string):FileDigest[]{
  if(!existsSync(root))return [];
  const files:FileDigest[]=[];
  function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(lstatSync(file).isSymbolicLink())throw Error('심볼릭 링크는 자동 백업하지 않습니다.');if(entry.name==='sync.lock'||entry.name.endsWith('.tmp')||entry.name==='staging')continue;if(entry.isDirectory())walk(file);else{const bytes=readFileSync(file);files.push({path:relative(root,file).split(sep).join('/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
  walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
/** Copy, never move. Preflight all collisions before writing; existing different bytes are never replaced. */
export function copyVerified(source:string,destination:string){
  const src=resolve(source),dst=resolve(destination),rel=relative(src,dst),reverse=relative(dst,src);
  if(!rel||(!isAbsolute(rel)&&!rel.startsWith('..'+sep)&&rel!=='..')||(!isAbsolute(reverse)&&!reverse.startsWith('..'+sep)&&reverse!=='..'))throw Error('서로 겹치는 경로는 복사할 수 없습니다.');
  const files=inventory(src);
  for(const file of files){const target=join(dst,file.path);if(existsSync(target)&&createHash('sha256').update(readFileSync(target)).digest('hex')!==file.sha256)throw Error('기존 데이터 충돌: '+target);}
  for(const file of files){const target=join(dst,file.path);mkdirSync(resolve(target,'..'),{recursive:true});if(!existsSync(target))copyFileSync(join(src,file.path),target,constants.COPYFILE_EXCL);if(createHash('sha256').update(readFileSync(target)).digest('hex')!==file.sha256)throw Error('복사 검증 실패: '+target);}
  return files;
}
