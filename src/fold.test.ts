import { describe, expect, it } from 'vitest';
import { fold, nameMatches } from './fold';

describe('a name as a search compares it', () => {
  it('folds as Potok does: Latin, lower case, no diacritics', () => {
    expect(fold('Čačak')).toBe('cacak');
    expect(fold('Београд')).toBe('beograd');
    expect(fold('Љубљана')).toBe('ljubljana');
    expect(fold('Ђурђево')).toBe('djurdjevo');
    expect(fold('Đurđevo')).toBe('djurdjevo');
    expect(fold('Џеп')).toBe('dzep');
    expect(fold('Džep')).toBe('dzep');
    expect(fold('Жабари')).toBe('zabari');
    expect(fold('Café')).toBe('cafe');
  });

  it('drops the marks of a letter written as two', () => {
    expect(fold('Čačak')).toBe('cacak');
  });

  it('finds a part of a name in any script', () => {
    expect(nameMatches('Čačak', 'cacak')).toBe(true);
    expect(nameMatches('Novi Sad', 'сад')).toBe(true);
    expect(nameMatches('Ниш', 'nis')).toBe(true);
    expect(nameMatches('Ниш', 'beograd')).toBe(false);
    expect(nameMatches('Ниш', '  ')).toBe(true);
  });
});
