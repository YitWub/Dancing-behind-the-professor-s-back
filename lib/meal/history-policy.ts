export const OBSERVATION_AGENT='BOKAK-Meal-Research';
export const OBSERVATION_USER_AGENT=OBSERVATION_AGENT+'/0.1 (ERICA student project; bounded public menu observation)';
/** Longest matching allow/disallow rule of the most specific user-agent group. */
export function robotsAllows(text:string,path:string,agent=OBSERVATION_AGENT){
  const groups:{agents:string[];rules:{allow:boolean;pattern:string}[]}[]=[];let group:{agents:string[];rules:{allow:boolean;pattern:string}[]}|null=null;
  for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim();const match=/^([^:]+):\s*(.*)$/.exec(line);if(!match)continue;const field=match[1].trim().toLowerCase(),value=match[2].trim();
    if(field==='user-agent'){if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(value.toLowerCase());}
    else if(group&&(field==='allow'||field==='disallow')&&value)group.rules.push({allow:field==='allow',pattern:value});
  }
  const matches=groups.map(g=>({...g,score:Math.max(-1,...g.agents.map(a=>a==='*'?0:agent.toLowerCase().startsWith(a)?a.length:-1))})).filter(g=>g.score>=0);const score=Math.max(-1,...matches.map(g=>g.score));
  const rules=matches.filter(g=>g.score===score).flatMap(g=>g.rules).flatMap(rule=>{
    const end=rule.pattern.endsWith('$'),base=end?rule.pattern.slice(0,-1):rule.pattern;const escaped=base.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp('^'+escaped+(end?'$':'')).test(path)?[{...rule,length:base.replace(/\*/g,'').length}]:[];
  }).sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));
  return rules[0]?.allow??true;
}
