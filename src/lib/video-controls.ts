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
