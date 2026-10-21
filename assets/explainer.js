// Exported demos size their inner frame as controls and viewport dimensions change.
// Observe the same-origin wrapper so the article follows that height as well.
for (const frame of document.querySelectorAll('iframe[data-demo]')) {
  let observer;
  frame.addEventListener('load', () => {
    observer?.disconnect();
    const body = frame.contentDocument?.body;
    if (!body) return;
    const fit = () => {
      const height = Math.ceil(body.getBoundingClientRect().height);
      if (height > 0 && height < 10000 && Math.abs(frame.clientHeight - height) > 1) {
        frame.style.height = `${height}px`;
      }
    };
    observer = new ResizeObserver(fit);
    observer.observe(body);
    fit();
  });
}
