import { describe, it, expect } from 'vitest';
import { filterItems, SLASH_ITEMS } from './slashMenu.js';

describe('slash menu filtering', () => {
  it('returns every item for an empty query', () => {
    expect(filterItems('')).toHaveLength(SLASH_ITEMS.length);
    expect(filterItems('   ')).toHaveLength(SLASH_ITEMS.length);
  });

  it('matches on title (case-insensitive)', () => {
    const r = filterItems('HEAD');
    expect(r.length).toBe(3);
    expect(r.every((i) => i.title.startsWith('Heading'))).toBe(true);
  });

  it('matches on keywords, not just the title', () => {
    expect(filterItems('divider').map((i) => i.title)).toContain('Divider');
    expect(filterItems('hr').map((i) => i.title)).toContain('Divider');
    expect(filterItems('unordered').map((i) => i.title)).toContain('Bulleted list');
  });

  it('returns nothing for a non-matching query', () => {
    expect(filterItems('zzzz')).toHaveLength(0);
  });
});
