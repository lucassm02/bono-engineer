export interface ReleaseNote {
  version: string;
  date: string;
  markdown: string;
}

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'saved'
  | 'installing'
  | 'error';

export interface DesktopUpdateStatus {
  mode: 'installed' | 'portable' | 'development';
  phase: DesktopUpdatePhase;
  version: string;
  target: string | null;
  checkedAt: number | null;
  progress: number | null;
  error: 'check' | 'download' | 'install' | 'busy' | null;
  notes: ReleaseNote[];
  notesAvailable: boolean;
  installedNotes: ReleaseNote[];
  showInstalledNotes: boolean;
  dismissed: boolean;
}

export interface DesktopUpdateBridge {
  get(): Promise<DesktopUpdateStatus>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  dismiss(): Promise<void>;
  markNotesRead(): Promise<void>;
  onStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
}
