import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exportRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const bundleRoot = join(exportRoot, '_expo/static/js/');
const platforms = ['android', 'ios', 'web'];
const forbiddenMarkers = [
  'SOLO DESARROLLO',
  'Abrir showcase del sistema de diseño',
];

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return entry.isFile() && /\.(?:js|hbc)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectHtmlFiles(path);
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  }));
  return files.flat();
}

for (const platform of platforms) {
  const directory = join(bundleRoot, platform);
  const files = await collectJavaScriptFiles(directory);
  if (files.length === 0) {
    throw new Error(`No se encontraron bundles JavaScript para ${platform}.`);
  }

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    const marker = forbiddenMarkers.find((candidate) => contents.includes(candidate));
    if (marker) {
      throw new Error(`El bundle ${platform} incluye el marcador de desarrollo "${marker}".`);
    }
  }

  console.log(`${platform}: ${files.length} bundles verificados.`);
}

const htmlFiles = await collectHtmlFiles(exportRoot);
if (htmlFiles.length === 0) throw new Error('La exportación web no contiene páginas HTML.');
for (const file of htmlFiles) {
  const contents = await readFile(file, 'utf8');
  const localized = contents.replace(/<html\b([^>]*)\blang="[^"]*"/i, '<html$1lang="es-MX"');
  if (localized === contents && !/<html\b[^>]*\blang="es-MX"/i.test(contents)) {
    throw new Error(`No se pudo establecer el idioma español en ${file}.`);
  }
  await writeFile(file, localized);
  if (!/<html\b[^>]*\blang="es-MX"/i.test(localized)) {
    throw new Error(`El HTML móvil exportado debe declarar lang="es-MX": ${file}.`);
  }
}

const entryHtml = await readFile(join(exportRoot, 'index.html'), 'utf8');
if (!/<title\b[^>]*>EnlaceSeguro<\/title>/i.test(entryHtml)) {
  throw new Error('El HTML móvil exportado debe tener el título "EnlaceSeguro".');
}
console.log(`web: idioma es-MX verificado en ${htmlFiles.length} páginas; título accesible verificado.`);
