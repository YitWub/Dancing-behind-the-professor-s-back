import type { GameNotice } from './types.ts';
type NoticeStorage=Pick<Storage,'getItem'|'setItem'>;
/** Acknowledgements only, not achievement state. No names, notes, progress or timestamps. */
export function claimGameNotices(ownerId:string,eventId:string,candidates:readonly GameNotice[],provided?:NoticeStorage):GameNotice[]{
  if(!candidates.length)return [];
  try{
    const storage=provided??globalThis.localStorage,key='bokak.dex.game-notices.v1:'+ownerId;
    const raw=storage.getItem(key);const ledger:unknown=raw?JSON.parse(raw):{events:[],awards:[]};
    if(!ledger||typeof ledger!=='object'||!('events'in ledger)||!('awards'in ledger)||!Array.isArray(ledger.events)||!Array.isArray(ledger.awards)||!ledger.events.every(v=>typeof v==='string')||!ledger.awards.every(v=>typeof v==='string'))return [];
    if(ledger.events.includes(eventId))return [];
    const awards=new Set<string>(ledger.awards);
    const unseen=candidates.filter(notice=>{if(awards.has(notice.id))return false;awards.add(notice.id);return true;});
    storage.setItem(key,JSON.stringify({events:[...ledger.events,eventId].slice(-128),awards:[...awards]}));
    return unseen;
  }catch{
    // Without durable acknowledgement, suppress repeatable popups. Derived achievement UI still works.
    return [];
  }
}
