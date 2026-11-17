import type {CharacterAvatarId} from '@/lib/dex/people/avatars';
const clothes={reader:'#899b78',gamer:'#8797a8',explorer:'#b09a71',sleepy:'#b1a4ba',hoodie:'#8d9f88',coffee:'#b4947d',athlete:'#739e91',backpacker:'#a48f6e',playful:'#d4ac72',formal:'#6e7c7b'};
/** Finished vector presets, not a character editor. Replace here to use future illustration assets. */
export function CharacterAvatar({id}:{id:CharacterAvatarId}){
 const round=id==='playful',sleepy=id==='sleepy',hair=id==='reader'?'M37 52V30Q36 7 60 9Q84 7 83 31V57L75 64H43Z':id==='formal'?'M40 34Q37 7 61 10Q84 9 81 36L66 22L43 35Z':id==='gamer'?'M38 35L41 14L52 17L58 8L66 16L78 12L83 37Z':id==='backpacker'?'M38 35Q36 17 46 14L50 7L57 13L65 7L69 14Q85 17 82 36Z':id==='coffee'?'M38 37Q29 28 39 22Q34 10 47 12Q52 3 61 12Q76 5 79 18Q90 22 81 40Z':id==='sleepy'?'M38 35Q37 16 55 15L63 6L63 16Q83 15 82 36Z':'M38 36Q36 12 61 13Q83 12 82 38L70 24L58 31L44 27Z';
 return <svg className="character-avatar" viewBox="0 0 120 104" fill="none" aria-hidden="true" data-avatar-id={id}>
 <ellipse cx="60" cy="99" rx="46" ry="5" fill="#7d8765" opacity=".13"/>
 {id==='backpacker'?<g><rect x="13" y="48" width="94" height="52" rx="18" fill="#9b805d"/><path d="M20 63h14v28H19M87 62h13v27H87" stroke="#d1ba8b" strokeWidth="5"/></g>:null}
 {id==='hoodie'?<path d="M24 98L29 34Q29 7 60 6Q90 8 92 34L98 98Z" fill="#7e927a"/>:null}
 <path d={id==='athlete'?'M20 102L31 71L43 65H77L90 74L102 102Z':id==='formal'?'M24 104L29 78L47 66H73L92 78L97 104Z':id==='sleepy'?'M18 104Q23 78 43 74L72 68Q95 75 100 104Z':'M23 104Q24 75 45 68H75Q96 76 97 104Z'} fill={clothes[id]}/>
 <path d="M49 61v13l11 9 11-9V61" fill="#efd7b4"/>
 <path d={hair} fill={id==='reader'?'#725947':id==='sleepy'?'#9a8063':'#625b4c'}/>
 <ellipse cx="39" cy="43" rx="5" ry="8" fill="#edd4b0"/><ellipse cx="81" cy="43" rx="5" ry="8" fill="#edd4b0"/>
 {round?<circle cx="60" cy="44" r="25" fill="#f2dcbb"/>:<path d={id==='formal'?'M41 32Q60 17 79 33V48Q76 70 60 71Q43 66 41 48Z':'M40 33Q59 20 80 33V48Q79 69 60 70Q41 67 40 48Z'} fill="#f2dcbb"/>}
 <path d={hair} fill={id==='reader'?'#725947':id==='sleepy'?'#9a8063':'#625b4c'} opacity=".98" transform={id==='reader'?'translate(0 -2) scale(1 .65)':'translate(0 -1) scale(1 .8)'}/>
 {sleepy?<path d="M46 46l9 1m10 0l9-1M50 54h4m12 0h4" stroke="#6b6253" strokeWidth="2" strokeLinecap="round"/>:round?<g stroke="#6b6253" strokeWidth="2.5" strokeLinecap="round"><path d="M47 44h5m14-3 6 4-6 3"/><path d="M53 56q8 9 15-1" fill="#bc8e77"/></g>:<><path d="M50 45h.1M70 45h.1" stroke="#635e4e" strokeWidth="3.2" strokeLinecap="round"/><path d={id==='formal'?'M55 57h10':'M54 56q6 5 12 0'} stroke="#ad826d" strokeWidth="2" strokeLinecap="round"/></>}
 {id==='reader'?<g stroke="#6d7153" strokeWidth="2.5"><circle cx="49" cy="44" r="9"/><circle cx="70" cy="44" r="9"/><path d="M58 43h3M39 42h-4m44 0h5"/></g>:null}
 {id==='explorer'?<g><path d="M33 30Q34 6 59 5Q84 6 85 30Z" fill="#a4aa7b"/><path d="M24 30Q58 19 91 30L94 36Q58 30 25 36Z" fill="#c5bd90"/><path d="M46 12l7 13" stroke="#ddd4ab" strokeWidth="5"/></g>:null}
 {id==='gamer'?<g stroke="#616d78" strokeWidth="5"><path d="M31 43V30Q31 5 60 5Q89 6 89 31v13"/><rect x="29" y="33" width="10" height="23" rx="4" fill="#a9b9bb"/><rect x="81" y="33" width="10" height="23" rx="4" fill="#a9b9bb"/><path d="M85 54q-1 9-16 8" strokeWidth="3"/></g>:null}
 {id==='athlete'?<><path d="M38 31h44" stroke="#dfcc9e" strokeWidth="8"/><path d="M39 72l10 30m32-30-10 30" stroke="#f4efdb" strokeWidth="6"/><path d="M54 85h11l-8 12" stroke="#fff5db" strokeWidth="3"/></>:null}
 {id==='formal'?<><path d="M45 68l15 15 15-15-2 25-13-9-13 9Z" fill="#f6f0dd"/><path d="M60 82l-5 6 5 16 5-16Z" fill="#b59773"/><path d="M43 72l-7 14 13 17m28-31 7 14-13 17" stroke="#515e5c" strokeWidth="3"/></>:null}
 {id==='hoodie'?<><path d="M37 69l23 15 22-15" stroke="#d8dfc2" strokeWidth="5"/><path d="M51 81v15m18-15v15" stroke="#efe7cf" strokeWidth="2"/><path d="M42 99q18-10 36 0" stroke="#6e836d" strokeWidth="3"/></>:null}
 {id==='reader'?<g><path d="M34 80l26 5 26-5v22l-26-4-26 4Z" fill="#e9dbb8" stroke="#a39c78" strokeWidth="2"/><path d="M60 85v13M40 87l13 3m14 0 12-3" stroke="#b1a98a" strokeWidth="2"/></g>:null}
 {id==='coffee'?<g><path d="M37 94l15-8m32 9-13-8" stroke="#efd7b4" strokeWidth="9" strokeLinecap="round"/><path d="M48 80h25l-3 23H51Z" fill="#f4ead0" stroke="#aa9979" strokeWidth="2"/><path d="M73 84q14-2 9 9l-11 2" stroke="#d5c5a2" strokeWidth="4"/><path d="M55 73q-5-6 0-10m11 10q5-6 0-10" stroke="#d1c5ae" strokeWidth="2"/></g>:null}
 {id==='backpacker'?<><path d="M39 72l8 31m34-31-8 31" stroke="#d8c499" strokeWidth="7"/><rect x="50" y="88" width="21" height="13" rx="2" fill="#e6d9b8" transform="rotate(-8 60 94)"/></>:null}
 {id==='playful'?<><circle cx="43" cy="54" r="4" fill="#e4b19a"/><circle cx="78" cy="54" r="4" fill="#e4b19a"/><path d="M33 83l54 10M36 97l46-19" stroke="#f1dfb3" strokeWidth="5"/></>:null}
 {sleepy?<><path d="M37 73q24 14 49-3l-4 14-39 3Z" fill="#e0d3be"/><path d="M81 79l8 24H75l-3-19" fill="#d4c4ae"/></>:null}
 </svg>;
}
