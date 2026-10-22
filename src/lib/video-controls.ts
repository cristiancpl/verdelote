/** Conecta los botones .pause con su video. Con movimiento reducido el video arranca en pausa */
export function initPauseButtons(root: ParentNode = document) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll<HTMLButtonElement>('[data-pause-for]').forEach((btn) => {
    const video = document.getElementById(btn.dataset.pauseFor!) as HTMLVideoElement | null;
    if (!video) return;
    const iconPause = btn.querySelector('[data-icon="pause"]');
    const iconPlay = btn.querySelector('[data-icon="play"]');
    const sync = () => {
      const paused = video.paused;
      btn.setAttribute('aria-label', paused ? 'Reproducir video' : 'Pausar video');
      iconPause?.toggleAttribute('hidden', paused);
      iconPlay?.toggleAttribute('hidden', !paused);
    };
    if (reduce) video.pause();
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    btn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
    sync();
  });
}

/** Reproduce el video solo mientras su contenedor se ve y nadie lo pausó a mano.
 *  Llamar después de initPauseButtons: así el botón de pausa ya cambió el estado cuando se lee video.paused */
export function playWhenVisible(video: HTMLVideoElement, target: Element = video, threshold = 0.35) {
  let manual = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (video.id) {
    document
      .querySelector(`[data-pause-for="${video.id}"]`)
      ?.addEventListener('click', () => (manual = video.paused));
  }
  new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) video.pause();
      else if (!manual) video.play().catch(() => undefined);
    },
    { threshold },
  ).observe(target);
}
