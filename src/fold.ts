// A name as a search compares it, the same way Potok's database does
// (`potok_fold`): lower case, Latin, without diacritics, Serbian Cyrillic's
// own letters spelled out. "cacak" finds "Čačak", "beograd" finds "Београд".

const DIGRAPHS: [string, string][] = [
  ['Љ', 'lj'],
  ['љ', 'lj'],
  ['Њ', 'nj'],
  ['њ', 'nj'],
  ['Џ', 'dz'],
  ['џ', 'dz'],
  ['Ђ', 'dj'],
  ['ђ', 'dj'],
  ['Đ', 'dj'],
  ['đ', 'dj'],
];

const LETTERS: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's',
  č: 'c', ć: 'c', š: 's', ž: 'z',
  á: 'a', à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ï: 'i', ó: 'o', ô: 'o', ö: 'o',
  ú: 'u', ü: 'u',
};

// The marks a decomposed letter carries: caron, acute, grave, diaeresis, circumflex.
const MARKS = /[̌́̀̈̂]/g;

/** The name as a search compares it. */
export function fold(text: string): string {
  let folded = text;
  for (const [from, to] of DIGRAPHS) folded = folded.split(from).join(to);

  return Array.from(folded.toLowerCase().replace(MARKS, ''))
    .map((char) => LETTERS[char] ?? char)
    .join('');
}

/** Whether `name` holds `term`, as Potok's searches match: any case, diacritics or script. */
export function nameMatches(name: string, term: string): boolean {
  const wanted = fold(term.trim());
  return wanted === '' || fold(name).includes(wanted);
}
