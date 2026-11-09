import clips from './engineer-radio-clips.json';

interface RadioPack {
  file: string;
  clips: Record<string, readonly number[]>;
}

export const RADIO_VOICES = [
  { value: 'radio:dora', label: 'Dora · rádio neural' },
  { value: 'radio:alex', label: 'Alex · rádio neural' },
] as const;

export function radioPack(voiceUri: string): RadioPack | null {
  if (voiceUri === 'radio:dora') return { file: 'dora.wav', clips: clips.dora };
  if (voiceUri === 'radio:alex') return { file: 'alex.wav', clips: clips.alex };
  return null;
}

let context: AudioContext | undefined;
let output: GainNode | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const decoded = new Map<string, AudioBuffer>();
let playing: { source: AudioBufferSourceNode; preview: boolean } | null = null;

/** Start or resume audio from the user gesture, then decode the selected pack once. */
export async function prepareRadioPack(pack: RadioPack): Promise<void> {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  const ctx = context;
  const resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  let loading = buffers.get(pack.file);
  if (!loading) {
    loading = fetch(`/radio/${pack.file}`)
      .then((response) => {
        if (!response.ok) throw new Error('Pacote de rádio indisponível');
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        decoded.set(pack.file, buffer);
        return buffer;
      })
      .catch((error: unknown) => {
        buffers.delete(pack.file);
        throw error;
      });
    buffers.set(pack.file, loading);
  }
  await Promise.all([resume, loading]);
}

export function radioClipMs(pack: RadioPack, phrase: string): number | undefined {
  const seconds = pack.clips[phrase]?.[1];
  return seconds === undefined ? undefined : seconds * 1000 + 80;
}

export function stopRadioClip(preview: boolean): void {
  if (playing?.preview !== preview) return;
  const { source } = playing;
  playing = null;
  source.onended = null;
  source.stop();
  source.disconnect();
}

export function playRadioClip(
  pack: RadioPack,
  phrase: string,
  preview: boolean,
  done?: () => void,
  volume = 1,
): boolean {
  const buffer = decoded.get(pack.file);
  const clip = pack.clips[phrase];
  if (!buffer || !clip || context?.state !== 'running') return false;
  if (playing) stopRadioClip(playing.preview);
  const source = context.createBufferSource();
  source.buffer = buffer;
  if (!output) {
    output = context.createGain();
    output.connect(context.destination);
  }
  output.gain.value = volume;
  source.connect(output);
  playing = { source, preview };
  source.onended = () => {
    if (playing?.source !== source) return;
    playing = null;
    source.disconnect();
    done?.();
  };
  source.start(0, clip[0], clip[1]);
  return true;
}

export function setRadioClipVolume(volume: number): void {
  if (output) output.gain.value = volume;
}
