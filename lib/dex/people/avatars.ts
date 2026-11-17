export const CHARACTER_AVATARS=[
 {id:'reader',label:'안경 독서가'},{id:'gamer',label:'헤드셋 게이머'},
 {id:'explorer',label:'모자 탐험가'},{id:'sleepy',label:'잠꾸러기'},
 {id:'hoodie',label:'후드 캐릭터'},{id:'coffee',label:'커피 친구'},
 {id:'athlete',label:'운동복 활동가'},{id:'backpacker',label:'큰 가방 여행자'},
 {id:'playful',label:'동그란 장난꾸러기'},{id:'formal',label:'차분한 정장'}
] as const;
export type CharacterAvatarId=typeof CHARACTER_AVATARS[number]['id'];
export const LEGACY_AVATARS=['classic','sprout','night','sun'] as const;
export type PersonAvatarId=CharacterAvatarId|typeof LEGACY_AVATARS[number];
export const AVATAR_IDS:readonly string[]=[...LEGACY_AVATARS,...CHARACTER_AVATARS.map(a=>a.id)];
export function isCharacterAvatar(value:unknown):value is CharacterAvatarId{return CHARACTER_AVATARS.some(a=>a.id===value);}
