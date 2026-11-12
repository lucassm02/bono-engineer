/** Data-folder controls exposed by the Windows app (`window.bonoData`). Not available in a browser. */

export interface DesktopDataFolderInfo {
  /** Absolute path. */
  dir: string;
  /** Can be written to. */
  writable: boolean;
  /** Already holds a Bono database. */
  hasData: boolean;
  /** Sessions in that database. */
  sessions: number;
  /** Cloud service that syncs the folder (OneDrive, Dropbox...), if any. */
  cloudProvider: string | null;
  /** Holds files that are not Bono data. */
  hasOtherFiles: boolean;
}

export interface DesktopDataCurrent {
  dir: string;
  /** True when this is the per-user default folder. */
  isDefault: boolean;
  defaultDir: string;
}

/**
 * How to switch folders:
 *  - `copy`:  copy the current data into the new folder, then use it (the old folder stays).
 *  - `use`:   use what is already in the new folder (it must hold Bono data).
 *  - `empty`: start with an empty history in the new folder.
 */
export type DesktopDataMode = 'copy' | 'use' | 'empty';

export interface DesktopDataBridge {
  current(): Promise<DesktopDataCurrent>;
  /** Opens the system folder picker. `null` when cancelled. */
  choose(): Promise<DesktopDataFolderInfo | null>;
  /** Inspects a folder without changing anything (for the default folder). */
  inspect(dir: string): Promise<DesktopDataFolderInfo>;
  /** Switches the data folder (`dir: null` = back to the default) and restarts the server. */
  apply(input: { dir: string | null; mode: DesktopDataMode }): Promise<void>;
  /** Shows the current folder in the file explorer. */
  openFolder(): Promise<void>;
}
