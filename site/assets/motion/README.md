# Vídeo curto do Bono (lugar reservado)

A landing page tem a seção **"Como o Bono funciona, em 15 segundos"**. Hoje ela mostra um filme animado
em SVG (`site/motion.mjs`). Para usar um **vídeo de verdade**, sem som e bem rápido, coloque aqui:

| Arquivo | Para quê |
|---|---|
| `bono-explainer.webm` | Vídeo principal (VP9 ou AV1). Leve e bem suportado |
| `bono-explainer.mp4` | Alternativa em H.264, para navegadores antigos e iOS |
| `bono-explainer-poster.webp` | Quadro mostrado antes de carregar (opcional) |

Se pelo menos um dos vídeos existir, o site usa o vídeo no lugar do filme animado (a mesma página em
português e em inglês). O vídeo toca sozinho, mudo, em loop e sem som, e tem controles para pausar.

Recomendações: 16:9 (1280 x 720), de 10 a 20 segundos, menos de 3 MB, sem áudio. Depois de colocar os
arquivos, rode `npm run site:build`.
