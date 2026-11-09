import { createImageHandler } from '@/lib/grade/assessment-image-server';

export const runtime='nodejs';
const handle=createImageHandler({key:()=>process.env.GEMINI_API_KEY,model:()=>process.env.GRADE_VISION_MODEL});
export const GET=handle;
export const POST=handle;
