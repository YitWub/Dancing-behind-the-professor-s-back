import { ensure } from '../core/errors.ts';
export const MB=1024*1024,MAX_SOURCE_BYTES=10*MB,MAX_PHOTO_BYTES=1.5*MB,MAX_PHOTO_TOTAL=50*MB,MAX_PHOTO_ASSETS=100,MAX_IMAGE_EDGE=1800;
export const PHOTO_SIZES={small:{width:180,height:180},medium:{width:240,height:220},large:{width:320,height:280}} as const;
export type PhotoSize=keyof typeof PHOTO_SIZES;
export interface BoardPhoto {id:string;assetId:string;caption:string;size:PhotoSize;x:number;y:number}
export interface ImageInfo {id:string;ownerId:string;mime:string;bytes:number;width:number;height:number;sha256:string}
export interface PhotoAsset {info:ImageInfo;blob:Blob}
export interface PreparedImage {blob:Blob;mime:string;bytes:number;width:number;height:number;sha256:string}
function ascii(bytes:Uint8Array,from:number,length:number){return String.fromCharCode(...bytes.subarray(from,from+length));}
export function inspectImage(bytes:Uint8Array,clean=false){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let mime='',width=0,height=0,metadata=false;
 if(bytes.length>=24&&ascii(bytes,1,3)==='PNG'&&bytes[0]===137&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
  mime='image/png';ensure(ascii(bytes,12,4)==='IHDR','PNG 헤더가 올바르지 않습니다.');width=v.getUint32(16);height=v.getUint32(20);
  let end=false;for(let p=8;p+12<=bytes.length;){const n=v.getUint32(p),type=ascii(bytes,p+4,4);ensure(n<=bytes.length-p-12,'손상된 PNG입니다.');ensure(type!=='acTL','움직이는 이미지는 지원하지 않아요.');if(['eXIf','tEXt','iTXt','zTXt'].includes(type))metadata=true;p+=n+12;if(type==='IEND'){end=true;break;}}ensure(end,'완전한 PNG 파일이 필요합니다.');
 }else if(bytes.length>=12&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'){
  mime='image/webp';ensure(v.getUint32(4,true)+8===bytes.length,'손상된 WebP입니다.');
  for(let p=12;p+8<=bytes.length;){const type=ascii(bytes,p,4),n=v.getUint32(p+4,true),d=p+8;ensure(n<=bytes.length-d,'손상된 WebP입니다.');ensure(!['ANIM','ANMF'].includes(type),'움직이는 이미지는 지원하지 않아요.');
   if(type==='VP8X'){ensure(n>=10&&(bytes[d]&2)===0,'움직이는 이미지는 지원하지 않아요.');width=1+bytes[d+4]+(bytes[d+5]<<8)+(bytes[d+6]<<16);height=1+bytes[d+7]+(bytes[d+8]<<8)+(bytes[d+9]<<16);}
   if(type==='VP8 '&&!width){ensure(n>=10&&bytes[d+3]===157&&bytes[d+4]===1&&bytes[d+5]===42,'WebP 프레임을 확인해 주세요.');width=v.getUint16(d+6,true)&16383;height=v.getUint16(d+8,true)&16383;}
   if(type==='VP8L'&&!width){ensure(n>=5&&bytes[d]===47,'WebP 프레임을 확인해 주세요.');const bits=v.getUint32(d+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
   if(type==='EXIF'||type==='XMP ')metadata=true;p=d+n+(n%2);
  }
 }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  mime='image/jpeg';for(let p=2;p+3<bytes.length;){ensure(bytes[p]===255,'JPEG 마커를 확인해 주세요.');while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;ensure(p+2<=bytes.length,'손상된 JPEG입니다.');const n=v.getUint16(p);ensure(n>=2&&p+n<=bytes.length,'손상된 JPEG입니다.');if(marker===225||marker===237||marker===254)metadata=true;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){ensure(n>=8,'JPEG 크기를 확인해 주세요.');height=v.getUint16(p+3);width=v.getUint16(p+5);}p+=n;}
 }
 ensure(mime&&width>0&&height>0&&width*height<=40_000_000&&width<=20000&&height<=20000,'JPG·PNG·WebP 정적 이미지가 필요해요. 최대 4천만 화소까지 지원해요.');
 if(clean)ensure(!metadata,'최적화 이미지에 불필요한 메타데이터가 있습니다.');
 return {mime,width,height};
}
export async function imageHash(blob:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifyPrepared(image:PreparedImage){
 ensure(image.blob instanceof Blob&&image.blob.size>0&&image.blob.size<=MAX_PHOTO_BYTES&&image.bytes===image.blob.size,'사진은 최적화 후 1.5MB 이하여야 해요.');
 const actual=inspectImage(new Uint8Array(await image.blob.arrayBuffer()),true);
 ensure(image.blob.type===actual.mime&&actual.mime===image.mime&&actual.width===image.width&&actual.height===image.height&&Math.max(actual.width,actual.height)<=MAX_IMAGE_EDGE,'이미지 형식·크기 정보가 다릅니다.');
 if(typeof createImageBitmap==='function'){let decoded:ImageBitmap;try{decoded=await createImageBitmap(image.blob);}catch{throw Error('사진 픽셀 데이터를 읽을 수 없습니다.');}try{ensure(decoded.width===actual.width&&decoded.height===actual.height,'사진의 실제 크기가 다릅니다.');}finally{decoded.close();}}
 ensure(/^[a-f0-9]{64}$/.test(image.sha256)&&await imageHash(image.blob)===image.sha256,'사진 해시가 일치하지 않습니다.');
}
export async function optimizePhoto(file:Blob):Promise<PreparedImage>{
 ensure(file instanceof Blob&&file.size>0&&file.size<=MAX_SOURCE_BYTES,'원본 사진은 10MB 이하여야 해요.');const source=inspectImage(new Uint8Array(await file.arrayBuffer()));
 let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file.slice(0,file.size,source.mime),{imageOrientation:'from-image'});}catch{throw Error('이미지를 읽을 수 없어요. JPG·PNG·WebP 정적 이미지를 선택해 주세요.');}
 try{
  ensure(bitmap.width*bitmap.height<=40_000_000,'이미지가 너무 큽니다.');
  const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(bitmap.width,bitmap.height));
  let width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');ensure(context,'이 브라우저에서는 이미지 최적화를 지원하지 않아요.');
  for(let attempt=0;attempt<7;attempt++){
   canvas.width=width;canvas.height=height;context.clearRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',attempt<3?.84-attempt*.14:.65));ensure(blob,'이미지 변환에 실패했어요.');
   if(blob.size<=MAX_PHOTO_BYTES){const actual=inspectImage(new Uint8Array(await blob.arrayBuffer()),true);return {blob,bytes:blob.size,...actual,sha256:await imageHash(blob)};}
   if(attempt>=2){width=Math.max(1,Math.round(width*.8));height=Math.max(1,Math.round(height*.8));}
  }
  throw Error('사진을 1.5MB 이하로 줄이지 못했어요. 더 작은 사진을 선택해 주세요.');
 }finally{bitmap.close();}
}
