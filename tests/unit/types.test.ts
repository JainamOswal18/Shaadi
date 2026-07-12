import { describe, it, expectTypeOf } from 'vitest';
import type { SearchResponse, MatchResult } from '@/lib/types';

describe('Shared Types', () => {
  it('SearchResponse.matches[0] extends MatchResult', () => {
    expectTypeOf<SearchResponse['matches'][number]>().toMatchTypeOf<MatchResult & { thumbUrl: string; previewUrl: string }>();
  });
});
