import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {emptyCardPosition,threadPath} from '../board-presentation.ts';
test('빈 폴라로이드는 실제 카드와 겹치지 않는 자리만 찾고 기존 좌표를 수정하지 않음',()=>{
 const positions=[{entryId:'a',x:24,y:24},{entryId:'b',x:224,y:24},{entryId:'moved',x:430,y:20}];const before=JSON.stringify(positions);const slot=emptyCardPosition(positions)!;assert.deepEqual(slot,{x:624,y:24});assert.equal(JSON.stringify(positions),before);assert.deepEqual(emptyCardPosition([]),{x:24,y:24});
});
test('실 곡선은 압정 좌표에서 시작·끝나고 카드 이동에 따라 변경됨',()=>{
 const a={entryId:'a',x:24,y:24},b={entryId:'b',x:224,y:24};const path=threadPath(a,b);assert.ok(path.startsWith('M 104 36 Q '));assert.ok(path.endsWith(' 304 36'));assert.notEqual(threadPath({...a,x:44},b),path);assert.ok(!threadPath(a,{...b,x:a.x}).includes('NaN'));assert.deepEqual(a,{entryId:'a',x:24,y:24});
});
