/** B 인수: 전체 메뉴명에만 적용하는 검토된 별칭. 기존 identityKey는 재배정하지 않는다. */
export interface MenuAliasRule { rawName: string; canonicalName: string; identityKey: string }
export const MENU_ALIASES: readonly MenuAliasRule[] = [
  { rawName:'돈까스', canonicalName:'돈가스', identityKey:'돈가스' },
  { rawName:'치즈돈까스', canonicalName:'치즈돈가스', identityKey:'치즈돈가스' },
  { rawName:'등심돈까스', canonicalName:'등심돈가스', identityKey:'등심돈가스' },
  { rawName:'치즈돈가스 Cheese Pork Cutlet', canonicalName:'치즈돈가스', identityKey:'치즈돈가스' },
  { rawName:'슈프림양념돈가스 Supreme Pork Cutlet', canonicalName:'슈프림양념돈가스', identityKey:'슈프림양념돈가스' },
  { rawName:'소고기육개장 Spicy Beef Soup', canonicalName:'소고기육개장', identityKey:'소고기육개장' },
  { rawName:'콩불돈육불고기 Kongnamul Bulgogi', canonicalName:'콩불돈육불고기', identityKey:'콩불돈육불고기' },
  { rawName:'청양굴소스돈육볶음 Spicy Oyster Sauce Pork', canonicalName:'청양굴소스돈육볶음', identityKey:'청양굴소스돈육볶음' },
  { rawName:'돈육장조림*삶은달걀조림 Braised Pork and Egg', canonicalName:'돈육장조림*삶은달걀조림', identityKey:'돈육장조림*삶은달걀조림' },
];
