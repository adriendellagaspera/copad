import { describe, it, expect } from 'vitest';
import { schema } from '../schema.js';
import { isSoleEmptyBlock } from './placeholder.js';

describe('isSoleEmptyBlock', () => {
  it('is true for a doc that is a single empty paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    expect(isSoleEmptyBlock(doc)).toBe(true);
  });

  it('is false once the sole paragraph has content', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hi')),
    ]);
    expect(isSoleEmptyBlock(doc)).toBe(false);
  });

  it('is false for a doc with more than one block', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph'),
      schema.node('paragraph'),
    ]);
    expect(isSoleEmptyBlock(doc)).toBe(false);
  });

  it('is false for a sole EMPTY code block — the placeholder copy ("press / for commands") is wrong there, and it would mask the "Code" line-hint that is otherwise the only cue the block type changed', () => {
    const doc = schema.node('doc', null, [schema.node('code_block')]);
    expect(isSoleEmptyBlock(doc)).toBe(false);
  });

  it('is false for a sole code block with content, same as any other non-empty sole block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, schema.text('let x = 1')),
    ]);
    expect(isSoleEmptyBlock(doc)).toBe(false);
  });
});
