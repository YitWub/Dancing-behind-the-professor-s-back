import {AVATAR_ARTWORK} from '@/lib/dex/people/avatar-artwork';
import {CHARACTER_AVATARS,isCharacterAvatar,LEGACY_AVATARS} from '@/lib/dex/people/avatars';
import {CharacterAvatar} from './CharacterAvatar';
import type {PersonSubject} from './PeopleForms';
export function AvatarPicker({value,onChange}:{value:PersonSubject;onChange:(value:PersonSubject)=>void}){
 return <fieldset className="people-avatar-picker"><legend>아바타 선택</legend><p className="people-privacy">원하는 캐릭터를 직접 골라 주세요. 사진이 있으면 사진이 먼저 표시돼요.</p><div className="people-avatar-options">{CHARACTER_AVATARS.map(a=><button key={a.id} type="button" aria-label={AVATAR_ARTWORK[a.id].label+' 아바타'} aria-pressed={value.avatar===a.id} onClick={()=>onChange({...value,avatar:a.id})}><CharacterAvatar id={a.id}/><span>{AVATAR_ARTWORK[a.id].label}</span></button>)}</div>{!isCharacterAvatar(value.avatar)?<small>현재: {value.avatar?'이전에 선택한 아바타':'기본 아바타'} · 새 캐릭터를 선택하지 않아도 그대로 유지돼요.</small>:null}{value.avatar&&LEGACY_AVATARS.includes(value.avatar as typeof LEGACY_AVATARS[number])?<input type="hidden" value={value.avatar}/>:null}</fieldset>;
}
