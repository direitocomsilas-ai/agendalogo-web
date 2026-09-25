// Aplica a logo do negócio como ícone do PWA em tempo de execução.
// Android/Chrome: reescreve o manifest (blob) com a logo como ícone.
// iOS: troca o apple-touch-icon (usado no momento do "Adicionar à Tela de Início").

const BASE_MANIFEST = '/manifest.webmanifest';
const FALLBACK_ICON = '/icon-1024.png';

function toPng512(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 512);
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

function setLink(rel: string, href: string, extra?: Record<string, string>) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  for (const [k, v] of Object.entries(extra ?? {})) link.setAttribute(k, v);
  link.href = href;
}

export async function applyPwaIcon(logoUrl: string | null | undefined) {
  if (!logoUrl) {
    // Sem logo: restaura os ícones e o manifest padrão
    setLink('apple-touch-icon', FALLBACK_ICON);
    setLink('icon', FALLBACK_ICON, { type: 'image/png' });
    setLink('manifest', BASE_MANIFEST);
    return;
  }
  const png = await toPng512(logoUrl);
  const iconHref = png ?? logoUrl;

  setLink('apple-touch-icon', iconHref);
  setLink('icon', iconHref, { type: 'image/png' });

  try {
    const base = await fetch(BASE_MANIFEST).then((r) => r.json());
    const manifest = {
      ...base,
      icons: [{ src: iconHref, type: 'image/png', sizes: '192x192 512x512', purpose: 'any maskable' }],
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    setLink('manifest', URL.createObjectURL(blob));
  } catch {
    // mantém o manifest padrão
  }
}
