/* ==========================================================================
 *  components/home/voice.ts — 캐릭터가 할 수 있는 말의 전부
 * --------------------------------------------------------------------------
 *  말풍선은 분위기 담당이 아니라 이 화면에서 제일 눈에 먼저 닿는 문장이다.
 *  그래서 지어낼 수 있는 말을 아예 두지 않는다 — 여기서 나갈 수 있는 문장은
 *  (1) 출결 장부에서 바로 나온 수, (2) 사용자가 누른 기록,
 *  (3) 팀원1 엔진이 만든 비교 예측 문장, 셋뿐이다.
 *
 *  특히 "괜찮아요" 류의 위로는 hp.level === 'ok' 일 때만 나갈 수 있다.
 *  표정도 같은 함수에서 같이 정해서, 문장과 얼굴이 어긋날 길을 막는다.
 * ========================================================================== */

import type { Mood } from '@/components/home/avatar';
import type { CourseHp } from '@/components/home/hp';
import { heartCount } from '@/components/home/hp';

export interface VoiceInput {
  /** 제일 아슬아슬한 과목의 하트. 장부가 없으면 null */
  hp: CourseHp | null;
  /** 오늘 먹였다고 표시한 끼니 수 (0~3) */
  fedCount: number;
  /** 방금 먹인 메뉴 이름. 먹인 직후 한 박자만 들어온다 */
  justFed: string | null;
  /** 보는 사람 시계의 시(0~23) */
  hour: number;
  /** 홈의 기존 한 줄 답 (mock.skipVerdict 출력) */
  skip: { line: string; tone: 'ok' | 'careful' | 'unknown' };
}

export interface Voice {
  mood: Mood;
  line: string;
}

export function voiceOf({ hp, fedCount, justFed, hour, skip }: VoiceInput): Voice {
  // ① 방금 먹인 건 제일 확실한 사실이라 무엇보다 먼저 나간다
  if (justFed) return { mood: 'munch', line: `${justFed} 잘 먹었어요!` };

  // ② 하트를 못 세는 상태. 0 개와 섞지 않는다
  if (!hp) {
    return {
      mood: 'blank',
      line: '출결 장부가 없어 하트를 못 세고 있어요. 결석 한도만 알려주세요.',
    };
  }

  // ③ F 구간 — 등급 이야기를 꺼내면 안 되는 상태
  if (hp.level === 'fail') {
    return {
      mood: 'panic',
      line: `${hp.courseName} 결석 한도를 넘겼어요. 등급보다 F 처리 여부를 먼저 확인하세요.`,
    };
  }

  if (hp.level === 'risk') {
    return {
      mood: 'worried',
      line: `${hp.courseName}, 하트 ${heartCount(hp.left)}개 남았어요. 한 번 더 빠지면 F 선입니다.`,
    };
  }

  // ④ 점심시간이 지났는데 먹인 게 없다 — 이건 추측이 아니라 기록이 비어 있다는 사실
  if (fedCount === 0 && hour >= 13) {
    return { mood: 'hungry', line: '오늘 먹인 끼니가 아직 없어요. 식단에서 하나 골라주세요.' };
  }

  if (hp.level === 'watch') {
    return {
      mood: 'neutral',
      line: `${hp.courseName} 하트가 ${heartCount(hp.left)}개예요. 이제 아껴 쓸 때입니다.`,
    };
  }

  // ⑤ 출결에 여유가 있을 때만 "째도 되나" 쪽으로 넘긴다.
  //    문장은 엔진이 만든 걸 한 글자도 안 고치고 그대로 옮긴다.
  if (skip.tone === 'unknown') {
    return { mood: 'neutral', line: '점수 세 칸만 넣으면 째도 되는지 바로 답할 수 있어요.' };
  }
  if (skip.tone === 'careful') return { mood: 'worried', line: skip.line };
  return { mood: fedCount > 0 ? 'happy' : 'neutral', line: skip.line };
}
