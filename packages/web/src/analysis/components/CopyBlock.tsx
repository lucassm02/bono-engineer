/** Botão de copiar e bloco de código com cópia, em `ui-btn` (Configurações, integração com IA). */

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { copyText } from './ui.tsx';

export function CopyBtn({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className="ui-btn"
      data-variant="secondary"
      data-size="sm"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'fail');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
    >
      <Icon name={state === 'ok' ? 'check' : 'copy'} size={14} />
      {state === 'ok' ? 'Copiado' : state === 'fail' ? 'Selecione e copie' : label}
    </button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="cfg-code">
      <div className="cfg-code-head">
        <span>{label}</span>
        <CopyBtn text={code} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
