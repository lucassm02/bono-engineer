import type { DesktopDataBridge, DesktopDiscordBridge, Language } from '@gt7/shared';
import { contextBridge, ipcRenderer } from 'electron';

const discord: DesktopDiscordBridge = {
  get: () => ipcRenderer.invoke('bono:discord:get'),
  save: (settings) => ipcRenderer.invoke('bono:discord:save', settings),
  setEnabled: (enabled) => ipcRenderer.invoke('bono:discord:set-enabled', enabled),
  setVoice: (pack) => ipcRenderer.invoke('bono:discord:set-voice', pack),
  test: () => ipcRenderer.invoke('bono:discord:test'),
  stopTest: () => ipcRenderer.invoke('bono:discord:stop-test'),
  remove: () => ipcRenderer.invoke('bono:discord:remove'),
  inspectToken: (token) => ipcRenderer.invoke('bono:discord:inspect-token', token),
  listVoiceChannels: () => ipcRenderer.invoke('bono:discord:list-voice-channels'),
  openLink: (url) => ipcRenderer.invoke('bono:discord:open-link', url),
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
const data: DesktopDataBridge = {
  current: () => ipcRenderer.invoke('bono:data:current'),
  choose: () => ipcRenderer.invoke('bono:data:choose'),
  inspect: (dir) => ipcRenderer.invoke('bono:data:inspect', dir),
  apply: (input) => ipcRenderer.invoke('bono:data:apply', input),
  openFolder: () => ipcRenderer.invoke('bono:data:open-folder'),
};
contextBridge.exposeInMainWorld('bonoData', data);
contextBridge.exposeInMainWorld('bonoDesktop', {
  getLanguage: () => ipcRenderer.invoke('bono:language:get'),
  setLanguage: (language: Language) => ipcRenderer.invoke('bono:language', language),
});
