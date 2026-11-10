import type { DesktopDiscordBridge } from '@gt7/shared';
import { contextBridge, ipcRenderer } from 'electron';

const discord: DesktopDiscordBridge = {
  get: () => ipcRenderer.invoke('bono:discord:get'),
  save: (settings) => ipcRenderer.invoke('bono:discord:save', settings),
  setEnabled: (enabled) => ipcRenderer.invoke('bono:discord:set-enabled', enabled),
  test: () => ipcRenderer.invoke('bono:discord:test'),
  stopTest: () => ipcRenderer.invoke('bono:discord:stop-test'),
  remove: () => ipcRenderer.invoke('bono:discord:remove'),
  onStatus(callback) {
    const receive = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on('bono:discord:status', receive);
    return () => {
      ipcRenderer.removeListener('bono:discord:status', receive);
    };
  },
};
contextBridge.exposeInMainWorld('bonoDiscord', discord);
