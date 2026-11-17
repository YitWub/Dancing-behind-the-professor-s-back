import type {CharacterAvatarId} from './avatars.ts';
/** Presentation aliases only. Saved avatar IDs are never rewritten. */
export const AVATAR_ARTWORK:Record<CharacterAvatarId,{src:string;label:string}>={
 reader:{src:'/dex/people/avatars/avatar_01_reader.webp',label:'안경 독서가'},
 gamer:{src:'/dex/people/avatars/avatar_02_gamer.webp',label:'헤드셋 게이머'},
 explorer:{src:'/dex/people/avatars/avatar_03_explorer.webp',label:'모자 탐험가'},
 sleepy:{src:'/dex/people/avatars/avatar_04_sleepy.webp',label:'잠꾸러기'},
 athlete:{src:'/dex/people/avatars/avatar_05_athlete.webp',label:'운동복 활동가'},
 hoodie:{src:'/dex/people/avatars/avatar_06_developer.webp',label:'개발자'},
 coffee:{src:'/dex/people/avatars/avatar_07_coffee.webp',label:'커피 친구'},
 playful:{src:'/dex/people/avatars/avatar_08_artist.webp',label:'아티스트'},
 formal:{src:'/dex/people/avatars/avatar_09_musician.webp',label:'뮤지션'},
 backpacker:{src:'/dex/people/avatars/avatar_10_photographer.webp',label:'사진가'}
};
