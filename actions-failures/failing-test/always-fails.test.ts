import { describe, expect, it } from 'vitest';

// INTENTIONAL ERROR (Category 1, failing-test): the assertion is wrong on purpose.
describe('error-generator failing test', () => {
  it('asserts that one equals two', () => {
    expect(1 + 1).toBe(3);
  });
});
