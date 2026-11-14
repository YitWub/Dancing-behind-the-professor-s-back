/** Display only; the complete original continues to identify and describe the stored offering. */
export function splitMenuLabel(original:string){
  const match=/^(.+?)\s+\(([A-Za-z][A-Za-z0-9 ,.&'’/\-]*)\)\s*$/.exec(original);
  return match&&/[가-힣]/.test(match[1])?{title:match[1].trim(),translation:match[2],original}:{title:original,translation:null,original};
}
