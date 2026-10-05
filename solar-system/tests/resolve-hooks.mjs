const MAP = {
  three: new URL('../vendor/three.module.min.js', import.meta.url).href,
  'astronomy-engine': new URL('../vendor/astronomy.min.js', import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true, format: 'module' };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('file:') && url.includes('/solar-system/')) {
    const r = await next(url, { ...context, format: 'module' });
    return { ...r, format: 'module' };
  }
  return next(url, context);
}
