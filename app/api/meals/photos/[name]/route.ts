import { readFile } from 'node:fs/promises';
import { mealAssetPath, mealStorageRoot, PHOTO_NAME } from '../../../../../lib/meal/sync-store.ts';
export const runtime='nodejs';
/** Public meal images only; no crawler imports, mutations, or personal records. */
export async function GET(_request:Request,{params}:{params:Promise<{name:string}>}){
  const {name}=await params;if(!PHOTO_NAME.test(name))return new Response(null,{status:404});
  try{const data=await readFile(mealAssetPath(mealStorageRoot(),name));const extension=name.split('.').at(-1);return new Response(data,{headers:{'Content-Type':extension==='jpg'?'image/jpeg':`image/${extension}`,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return new Response(null,{status:404});return new Response(null,{status:503});}
}
