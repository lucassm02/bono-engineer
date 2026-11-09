type VoiceChannel = 'training' | 'engineer' | 'engineerTest';

let channel: VoiceChannel | null = null;
let current: SpeechSynthesisUtterance | null = null;

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function portugueseVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => /^pt(?:[-_]|$)/i.test(v.lang));
}

export function stopSpeech(owner: VoiceChannel): void {
  if (channel !== owner) return;
  current = null;
  channel = null;
  window.speechSynthesis.cancel();
}

export function speakPtBr(
  owner: VoiceChannel,
  text: string,
  onDone?: (elapsedMs: number | null) => void,
  options?: { voiceUri: string; rate: number },
): boolean {
  if (!speechSupported() || !text) return false;
  try {
    const synth = window.speechSynthesis;
    if (channel) stopSpeech(channel);
    const voices = portugueseVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    const ptBr = voices.filter((v) => /^pt[-_]br$/i.test(v.lang));
    const voice =
      voices.find((v) => v.voiceURI === options?.voiceUri) ??
      ptBr.find((v) => v.localService) ??
      ptBr[0] ??
      voices[0];
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = options?.rate ?? 1.1;
    const sentAt = performance.now();
    const done = (ok: boolean) => {
      if (current !== u) return;
      current = null;
      channel = null;
      onDone?.(ok ? performance.now() - sentAt : null);
    };
    u.onend = () => done(true);
    u.onerror = () => done(false);
    current = u;
    channel = owner;
    synth.speak(u);
    return true;
  } catch {
    current = null;
    channel = null;
    return false;
  }
}
