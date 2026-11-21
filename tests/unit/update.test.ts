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

describe('in-app update download', () => {
  it('tracks progress from the Android updater, then hands over to the installer', async () => {
    const { installUpdate, useUpdate } = await import('../../src/app/appUpdate');
    const calls: string[] = [];
    (window as unknown as { NotaviUpdater: unknown }).NotaviUpdater = { download: (u: string) => calls.push(u) };
    installUpdate('1.5.0');
    expect(calls).toEqual(['https://mersanessa.github.io/Notavi/android/notavi-1.5.0.apk']);
    const emit = (window as unknown as { __notaviUpdate: (k: string, d: string) => void }).__notaviUpdate;
    emit('progress', '42');
    expect(useUpdate.getState().s).toEqual({ phase: 'downloading', version: '1.5.0', pct: 42 });
    installUpdate('1.5.0'); // a second tap while downloading does nothing
    expect(calls.length).toBe(1);
    emit('installing', '');
    expect(useUpdate.getState().s.phase).toBe('installing');
    emit('error', 'Offline');
    expect(useUpdate.getState().s).toMatchObject({ phase: 'error', message: 'Offline' });
  });
});
