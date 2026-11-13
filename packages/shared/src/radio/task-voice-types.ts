/** The audio packs of the engineer tasks (spec 20): what the generated manifest says about them. */

export interface TaskVoiceFile {
  /** `tasks-<voice>-<hash>.wav`, the name in the GitHub Release and on the disk. */
  file: string;
  /** Exact size (bytes): checked before and after the download. */
  bytes: number;
  /** SHA-256 of the file (hex): the app plays nothing that does not match. */
  sha256: string;
  /** Clip offsets: key → [start, length] in samples. */
  clips: Record<string, [number, number]>;
}

export interface TaskVoiceManifest {
  /** The dictionary version the packs were generated from. */
  dictionaryVersion: number;
  sampleRate: number;
  /** By voice pack (`alex`, `en-nick`...). */
  voices: Record<string, TaskVoiceFile>;
}
