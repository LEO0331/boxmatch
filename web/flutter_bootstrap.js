{{flutter_js}}
{{flutter_build_config}}

const hideBootShell = () => {
  const shell = document.getElementById('boot-shell');
  if (!shell) return;
  shell.classList.add('hide');
  setTimeout(() => shell.remove(), 260);
};

_flutter.loader.load({
  onEntrypointLoaded: async (engineInitializer) => {
    const appRunner = await engineInitializer.initializeEngine();
    await appRunner.runApp();
    hideBootShell();
  },
});

// Safety net: do not keep overlay forever if initialization fails silently.
setTimeout(hideBootShell, 15000);
