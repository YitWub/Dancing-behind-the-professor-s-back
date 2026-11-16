import type { ThreadStyle } from '@/lib/dex/people/board';
export const THREAD_PRESETS:Record<ThreadStyle,{label:string;outline:string;color:string;highlight:string;width:number;braid:string}>={
 red:{label:'붉은 실',outline:'#772e2a',color:'#b14a42',highlight:'#f2b3a0',width:2.7,braid:'1 3'},
 olive:{label:'초록 실',outline:'#424f32',color:'#778653',highlight:'#d3dbb4',width:2.7,braid:'1 3'},
 twine:{label:'마끈',outline:'#8d704a',color:'#c6aa78',highlight:'#f3e3bd',width:4,braid:'2 2'},
};
