/** Acciones de la ficha: compartir, copiar texto e imprimir. Todo degrada sin romper si el navegador no soporta la API */

let timer: number | undefined;

/** Aviso discreto y accesible (región aria-live en Base.astro) */
export function showToast(mensaje: string) {
  const el = document.querySelector<HTMLElement>('[data-toast]');
  if (!el) return;
  el.textContent = mensaje;
  el.classList.add('show');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

/** Copia al portapapeles; si la API moderna no está disponible (http, webviews) usa execCommand */
export async function copyText(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // sigue al plan B
  }
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function initShare(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { url = location.href, title, text } = btn.dataset;
      if (navigator.share) {
        try {
          await navigator.share({ url, title, text });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      showToast((await copyText(url)) ? 'Enlace copiado' : 'No se pudo copiar el enlace');
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy ?? '');
      showToast(ok ? (btn.dataset.copied ?? 'Copiado') : 'No se pudo copiar');
    });
  });
}

/** Las imágenes diferidas no existen para la impresión: se fuerzan antes de abrir el diálogo */
export function initPrint(root: ParentNode = document) {
  const cargar = () => root.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach((img) => (img.loading = 'eager'));
  window.addEventListener('beforeprint', cargar);
  root.querySelectorAll<HTMLButtonElement>('[data-print]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      cargar();
      const portada = [...root.querySelectorAll<HTMLImageElement>('.print-cover img')];
      // Espera la portada, pero nunca más de 1,5 s
      await Promise.race([
        Promise.all(portada.map((img) => img.decode().catch(() => undefined))),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      window.print();
    }),
  );
}
