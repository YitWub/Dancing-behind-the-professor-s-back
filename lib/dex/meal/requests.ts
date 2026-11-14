import type { CollectMealCommand, CollectResult, Result } from '../core/types.ts';

/** 화면의 한 동작을 하나의 command로 고정한다. 실패 재시도는 내용을 바꾸지 않고 같은 ID를 쓴다. */
export class MealCollectionRequests {
  private pending=new Map<string,CollectMealCommand>();
  private active=new Map<string,Promise<Result<CollectResult>>>();
  private recent=new Map<string,{until:number;value:CollectResult}>();
  private clock:()=>number;
  constructor(clock:()=>number=Date.now){this.clock=clock;}
  hasPending(key:string){return this.pending.has(key);}
  /** 실제 재방문 확인 뒤에만 새 의도를 시작한다. 불확실한 실패 요청은 그대로 재시도한다. */
  beginVisit(key:string){if(!this.pending.has(key)&&!this.active.has(key))this.recent.delete(key);}
  run(key:string,make:()=>CollectMealCommand,commit:(command:CollectMealCommand)=>Promise<Result<CollectResult>>):Promise<Result<CollectResult>> {
    const active=this.active.get(key);if(active)return active;
    const recent=this.recent.get(key);
    if(recent&&this.clock()<recent.until)return Promise.resolve({ok:true,value:{...recent.value,replayed:true,discovery:null}});
    const command=this.pending.get(key)??structuredClone(make());this.pending.set(key,command);
    const operation=Promise.resolve().then(()=>commit(structuredClone(command))).catch(():Result<CollectResult>=>({ok:false,error:{code:'STORAGE_UNAVAILABLE',message:'저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.'}})).then(result=>{
      if(result.ok){this.pending.delete(key);this.recent.set(key,{until:this.clock()+1000,value:result.value});}
      return result;
    }).finally(()=>this.active.delete(key));
    this.active.set(key,operation);return operation;
  }
}
