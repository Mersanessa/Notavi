import { describe, expect, it } from 'vitest';
import { compareVersions } from '../../src/app/appUpdate';

describe('app updates', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.4.10', '1.4.9')).toBe(1);
    expect(compareVersions('1.4.4', '1.4.4')).toBe(0);
    expect(compareVersions('1.4', '1.4.1')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });
});
