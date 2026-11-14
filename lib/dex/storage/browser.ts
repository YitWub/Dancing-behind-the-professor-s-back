import { IndexedDbDexRepository } from './indexeddb.ts';

const EVENT = 'bokak-dex-changed';
let personal: IndexedDbDexRepository | undefined;
let channel: BroadcastChannel | undefined;

/** import 시에는 브라우저 API를 사용하지 않는다. Client effect/이벤트에서 호출한다. */
export function getBrowserRepository() {
  if (typeof window === 'undefined') throw new Error('Browser storage is client-only');
  if (!personal) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(EVENT);
        channel.onmessage = () => window.dispatchEvent(new Event(EVENT));
      } catch { /* 알림 채널이 제한돼도 IndexedDB 사용·수동 재조회는 가능하다. */ }
    }
    personal = new IndexedDbDexRepository({ onCommitted: () => {
      window.dispatchEvent(new Event(EVENT)); channel?.postMessage('changed');
    } });
  }
  return personal;
}
export function subscribeToLocalChanges(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('focus', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('focus', listener); };
}
