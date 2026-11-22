// Ajustes de seguridad para la app Android, a partir de los hallazgos de MobSF.
//
// 1. Tráfico HTTP sin cifrar: la demo local habla con la API por HTTP en la red de la casa o escuela.
//    En vez de permitir HTTP para toda la app (usesCleartextTraffic=true), solo se permite hacia el
//    host de EXPO_PUBLIC_API_URL y solo si es una dirección de red local. Todo lo demás exige HTTPS.
// 2. StrandHogg: la actividad principal usa launchMode singleTask (lo necesita Expo Router para los
//    enlaces profundos). Con taskAffinity vacío, otra app no puede colocarse en su misma tarea.
// 3. El respaldo y los permisos sobrantes se ajustan en app.json (allowBackup y blockedPermissions).
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const PRIVATE_HOST = /^(localhost|10\.0\.2\.2|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** Host de la API al que se permite HTTP, o null si no hace falta ninguna excepción. */
function cleartextApiHost(apiUrl) {
  if (!apiUrl) return null;
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  return PRIVATE_HOST.test(url.hostname) ? url.hostname : null;
}

function networkSecurityConfigXml(host) {
  const exception = host
    ? `\n  <!-- API local de la demo (EXPO_PUBLIC_API_URL). Solo este host puede usar HTTP. -->\n  <domain-config cleartextTrafficPermitted="true">\n    <domain includeSubdomains="false">${host}</domain>\n  </domain-config>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <base-config cleartextTrafficPermitted="false" />${exception}\n</network-security-config>\n`;
}

function withAndroidHardening(config) {
  const host = cleartextApiHost(process.env.EXPO_PUBLIC_API_URL);

  config = withDangerousMod(config, ['android', async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'network_security_config.xml'), networkSecurityConfigXml(host));
    return cfg;
  }]);

  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    application.$['android:usesCleartextTraffic'] = 'false';
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    mainActivity.$['android:taskAffinity'] = '';
    return cfg;
  });
}

module.exports = withAndroidHardening;
module.exports.cleartextApiHost = cleartextApiHost;
module.exports.networkSecurityConfigXml = networkSecurityConfigXml;
