import { describe, expect, it } from 'vitest';
import { detectCloudFolder } from './cloud-folder.ts';

describe('detectCloudFolder', () => {
  it('recognises the usual sync folders', () => {
    expect(detectCloudFolder('C:\\Users\\ana\\OneDrive\\Bono')?.provider).toBe('OneDrive');
    expect(detectCloudFolder('C:\\Users\\ana\\OneDrive - Empresa Ltda\\Dados')?.provider).toBe(
      'OneDrive',
    );
    expect(detectCloudFolder('D:\\Dropbox\\bono')?.provider).toBe('Dropbox');
    expect(detectCloudFolder('G:\\Meu Drive\\Bono')?.provider).toBe('Google Drive');
    expect(
      detectCloudFolder('/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/x')?.provider,
    ).toBe('iCloud Drive');
  });

  it('leaves ordinary folders alone', () => {
    expect(detectCloudFolder('C:\\Users\\ana\\AppData\\Roaming\\Bono Engineer')).toBeNull();
    expect(detectCloudFolder('D:\\Jogos\\Bono')).toBeNull();
    expect(detectCloudFolder('C:\\Users\\ana\\Documents\\onedrive-notes-app')).toBeNull();
  });
});
