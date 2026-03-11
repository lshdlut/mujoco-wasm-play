(function (global) {
  const VIEWER_SHELL_HTML = String.raw`
<aside class="panel panel-left" data-testid="panel-left" data-play-panel="left">
  <div class="panel-mount" data-play-mount="leftPanel"></div>
  <div class="panel-mount" data-play-mount="leftPanelPlugin"></div>
</aside>
<main class="viewer">
  <canvas data-testid="viewer-canvas"></canvas>
  <div class="overlay-stack">
    <div class="overlay-mount" data-play-mount="overlayRoot"></div>
    <div class="overlay-card" data-testid="overlay-realtime">
      <div data-testid="overlay-realtime-desired">Speed : 100%</div>
      <div data-testid="overlay-realtime-actual">Physics: 100%</div>
    </div>
    <div class="overlay-card" data-testid="overlay-help">
      <div class="help-title">Help</div>
      <div class="help-subtitle">Keyboard & mouse shortcuts (Simulate parity)</div>
      <div class="help-grid">
        <div class="help-key">Space</div><div class="help-desc">Play / Pause</div>
        <div class="help-key">+  -</div><div class="help-desc">Real-time scale (discrete speed levels)</div>
        <div class="help-key">Left / Right arrow</div><div class="help-desc">Step Back / Forward (history aware)</div>
        <div class="help-key">Tab / Shift-Tab</div><div class="help-desc">Toggle Left / Right UI</div>
        <div class="help-key">[  ]</div><div class="help-desc">Cycle cameras</div>
        <div class="help-key">Page Up</div><div class="help-desc">Select parent body</div>
        <div class="help-key">Esc</div><div class="help-desc">Return to Free camera</div>
        <div class="help-key">Double-click</div><div class="help-desc">Select body / geom</div>
        <div class="help-key">Right double-click</div><div class="help-desc">Center camera on picked body</div>
        <div class="help-key">Ctrl Right double-click</div><div class="help-desc">Switch to tracking camera</div>
        <div class="help-key">Scroll / middle drag</div><div class="help-desc">Zoom</div>
        <div class="help-key">Left drag</div><div class="help-desc">View Orbit</div>
        <div class="help-key">[Shift] right drag</div><div class="help-desc">View Pan</div>
        <div class="help-key">Ctrl [Shift] drag</div><div class="help-desc">Object Rotate</div>
        <div class="help-key">Ctrl [Shift] right drag</div><div class="help-desc">Object Translate</div>
        <div class="help-key">F1</div><div class="help-desc">Help overlay</div>
        <div class="help-key">F2</div><div class="help-desc">Info overlay</div>
        <div class="help-key">UI title double-click</div><div class="help-desc">Expand / collapse all sections in that panel</div>
      </div>
      <div class="help-subtitle help-subtitle-unimplemented">Unimplemented / web differences</div>
      <div class="help-grid">
        <div class="help-key">F3</div><div class="help-desc">Profiler overlay (not implemented)</div>
        <div class="help-key">F4</div><div class="help-desc">Sensor overlay (not implemented)</div>
        <div class="help-key">F5</div><div class="help-desc">Fullscreen (use browser fullscreen instead)</div>
        <div class="help-key">UI right-button hold</div><div class="help-desc">Show UI shortcuts (not implemented)</div>
      </div>
    </div>
    <div class="overlay-card" data-testid="overlay-info">Info overlay • Displays simulation stats.</div>
    <div class="overlay-card" data-testid="overlay-profiler">Profiler overlay • Frame breakdown.</div>
    <div class="overlay-card" data-testid="overlay-sensor">Sensor overlay • Sensor readouts.</div>
  </div>
  <div class="toast" data-testid="toast"></div>
</main>
<aside class="panel panel-right" data-testid="panel-right" data-play-panel="right">
  <div class="panel-mount" data-play-mount="rightPanel"></div>
  <div class="panel-mount" data-play-mount="rightPanelPlugin"></div>
</aside>
`;

  function renderShell(doc = document) {
    if (!doc?.body) throw new Error('Missing document body');
    doc.body.innerHTML = VIEWER_SHELL_HTML;
    doc.body.classList.remove('layout-left', 'layout-right', 'layout-main');
    doc.body.classList.add('layout-3col');
  }

  function renderCoiFailure(doc = document, options = {}) {
    if (!doc?.body) throw new Error('Missing document body');
    const isEmbed = doc.documentElement?.getAttribute('data-play-embed') === '1';
    doc.body.innerHTML = '';
    doc.body.className = '';
    const root = doc.createElement('main');
    root.style.cssText = [
      isEmbed ? 'min-height: 100%' : 'min-height: 100vh',
      'display: grid',
      'place-items: center',
      'padding: 32px',
      'background: #050608',
      'color: #cfd0d0',
      'font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    ].join(';');
    const fallbackHref = options.fallbackHref || '/index.html';
    root.innerHTML = [
      '<div style="max-width: 860px; width: 100%; border: 1px solid rgba(129, 134, 141, 0.55); border-radius: 16px; padding: 24px; background: rgba(26, 28, 30, 0.96)">',
      '<h1 style="margin: 0 0 12px; font-size: 20px; color: #ffffff">Pthreads build requires cross-origin isolation</h1>',
      '<p style="margin: 0 0 12px">This variant uses SharedArrayBuffer and requires COOP/COEP headers.</p>',
      '<pre style="margin: 0 0 12px; padding: 12px; background: rgba(19, 20, 22, 0.96); border-radius: 12px; overflow: auto">Cross-Origin-Opener-Policy: same-origin\nCross-Origin-Embedder-Policy: require-corp</pre>',
      '<p style="margin: 0">If you cannot enable those headers, use the single-thread build at <code>' + fallbackHref + '</code>.</p>',
      '</div>',
    ].join('');
    doc.body.appendChild(root);
  }

  function boot(options = {}) {
    if (options.requireCrossOriginIsolated && !global.crossOriginIsolated) {
      renderCoiFailure(document, options);
      return;
    }
    renderShell(document);
    const script = document.createElement('script');
    script.type = 'module';
    script.src = options.moduleSrc || './app/main.mjs';
    document.body.appendChild(script);
  }

  const currentScript = document.currentScript;
  boot({
    moduleSrc: currentScript?.dataset?.playShellModule || './app/main.mjs',
    requireCrossOriginIsolated: currentScript?.dataset?.playShellRequireCoi === '1',
    fallbackHref: currentScript?.dataset?.playShellFallbackHref || '/index.html',
  });
})(globalThis);
