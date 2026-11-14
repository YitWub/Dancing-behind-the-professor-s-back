/** Display only. Raw names remain the source for identity and historical snapshots. */
const BARE_TRANSLATIONS=new Set([
  'Fried Dumplings Cutlet & Sauce','Spicy Beef Soup','Perilla Oil Mixed Buckwheat Noodles',
  'Chicken Teriyaki on the Rice','Spicy Fried Rice with Pork Belly','Stir-fried Pork with Oyster Sauce',
  'Beef and Glass Noodles Soup','Soybean Paste Stew with Seafood','Spicy Braised Pork and Quail Eggs in Soy Sauce',
  'Deep-fried Shrimp with Curry Rice','Noodle Soup with Clams','Dried Pollack Soup',
  'Mala Sauce Stir-fried Pork & Mushroon with Rice','Rice Topped with Chicken Sriracha Mayo',
  'Seaweed Soup with Beef','Junghwa bibimbap','Pork Cutlet with Sweet Potato','Fish Cake Skewers and Broth',
  'Stir-fried Chicken with Kimchi','Spicy Stir-fried Pork','Stir-fried Pork in Chinese Chilli Bean Sauce',
  'Braised Pork & Kimchi with Perilla Oil','Omelet Rice with Minced Pork Cutlet','Miryang-Stlye Pork Soup',
  'Korean Noodle Soup with Egg','Stir-fried Kimchi & Sausage On the Rice','Wild Vegetable Bibimbap',
  'Thick Ox Bone Soup','Beef Fried Rice','Yeolmu Water Kimchi Noodles','Char Siu with Rice',
  'Tuna and Kimchi Stew','Spicy Seafood Rice Porridge with Cheese','Chicken Barbecue','Chicken Cutlet',
  'Soft Tofu Stew with Ham & Cheese','Brunch Set',
]);
export function splitMenuLabel(original:string){
  const parenthesized=/^(.+?)\s+\(([A-Za-z][A-Za-z0-9 ,.&'’/()\-]*)\)\s*$/.exec(original);
  if(parenthesized&&/[가-힣]/.test(parenthesized[1]))return {title:parenthesized[1].trim(),translation:parenthesized[2],original};
  const bare=/^([^A-Za-z]+?)\s+([A-Za-z].*)$/.exec(original);
  return bare&&/[가-힣]/.test(bare[1])&&BARE_TRANSLATIONS.has(bare[2].trim())?{title:bare[1].trim(),translation:bare[2].trim(),original}:{title:original,translation:null,original};
}
