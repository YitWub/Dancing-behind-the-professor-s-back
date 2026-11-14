import type { DexRepository, Experience, Rating, Result } from '../core/types.ts';
import type { MealExperience } from './collection.ts';

/** Updates only the committed visit. Collection and request receipts are never rewritten here. */
export async function saveMealRating(repository:Pick<DexRepository,'updateExperience'>,experience:MealExperience,draft:{rating:Rating|null;note:string}):Promise<Result<Experience>> {
  try{return await repository.updateExperience(experience.ownerId,experience.id,experience.revision,{rating:draft.rating,note:draft.note});}
  catch{return {ok:false,error:{code:'STORAGE_UNAVAILABLE',message:'평가를 저장하지 못했어요. 입력을 유지했으니 다시 시도해 주세요.'}};}
}
