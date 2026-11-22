// El sandbox explica sus hallazgos con lenguaje técnico ("conexión no cifrada (HTTP)", "iframes",
// "punycode"). Aquí se traducen a frases cortas para alguien sin conocimientos de seguridad.
// Si llega una razón que no reconocemos, se muestra tal cual para no perder información.
export type FriendlyReason = { title: string; detail: string };

const rules: { match: RegExp; title: string; detail: string }[] = [
  { match: /todav[ií]a no reportan este enlace/i, title: 'Los antivirus no lo detectan, nosotros sí', detail: 'Puede ser un sitio nuevo o bien disfrazado. Confía en lo que vimos al abrirlo: el riesgo es real.' },
  { match: /VirusTotal report[oó]/i, title: 'Los antivirus ya lo reportan', detail: 'Otros programas antivirus marcaron este enlace como dañino, aunque al abrirlo no vimos nada raro.' },
  { match: /recursos internos|anti-SSRF/i, title: 'Intenta entrar a redes privadas', detail: 'El enlace apunta a equipos internos que no deberían ser públicos.' },
  { match: /datos de tarjeta/i, title: 'Te pide los datos de tu tarjeta', detail: 'Después de iniciar sesión pide número de tarjeta y código de seguridad. Un banco real no lo hace así.' },
  { match: /c[oó]digo de seguridad o NIP/i, title: 'Te pide códigos o tu NIP', detail: 'Pide el código que te llega por SMS o tu NIP. Nadie confiable te lo pide por un enlace.' },
  { match: /distinto al suyo/i, title: 'Manda tu contraseña a otro sitio', detail: 'Lo que escribes no se queda en esta página: se envía a otro lugar.' },
  { match: /llev[oó] a otro sitio/i, title: 'Te cambia de página para disimular', detail: 'Después de pedir tus datos te manda a otro sitio para que no notes nada.' },
  { match: /suplantaci[oó]n|phishing/i, title: 'Se hace pasar por otro sitio', detail: 'Pide tu contraseña en una dirección que imita a una página conocida.' },
  { match: /no cifrada|\(HTTP\)/i, title: 'Pide contraseña sin conexión segura', detail: 'La página no tiene candado de seguridad. Lo que escribas podría verlo alguien más.' },
  { match: /descarga/i, title: 'Intenta descargar archivos solo', detail: 'Quiso bajar archivos a tu teléfono sin que lo pidieras.' },
  { match: /dominio externo no coincidente/i, title: 'El formulario envía datos a otro sitio', detail: 'Los datos que escribas se mandarían a una dirección diferente.' },
  { match: /iframes|marcos ocultos/i, title: 'Tiene partes escondidas', detail: 'Hay contenido invisible dentro de la página, un truco común para engañar.' },
  { match: /m[uú]ltiples redirecciones/i, title: 'Te pasa por varias páginas', detail: 'Antes de llegar, el enlace salta por varias direcciones.' },
  { match: /Redirecci[oó]n hacia un dominio diferente/i, title: 'Te lleva a otra dirección', detail: 'El enlace termina en un sitio distinto al que aparenta.' },
  { match: /direcci[oó]n IP en lugar/i, title: 'La dirección no tiene nombre', detail: 'Usa solo números en lugar de un nombre como banco.com. Los sitios serios casi nunca lo hacen.' },
  { match: /extensi[oó]n/i, title: 'Terminación poco confiable', detail: 'El final de la dirección es muy usado en estafas.' },
  { match: /punycode|caracteres internacionales/i, title: 'Letras que imitan a otras', detail: 'La dirección usa letras parecidas para hacerse pasar por otro sitio.' },
  { match: /aparece en el enlace, pero el dominio real/i, title: 'Usa el nombre de una marca que no es suya', detail: '' },
  { match: /sin señales de riesgo/i, title: 'No vimos nada raro', detail: 'Abrimos la página en un lugar seguro y no hizo nada sospechoso.' },
];

export function friendlyReason(reason: string): FriendlyReason {
  const rule = rules.find((item) => item.match.test(reason));
  if (!rule) return { title: 'Otra señal de riesgo', detail: reason };
  // Para la marca suplantada conservamos el texto original, que nombra la marca y el dominio real.
  return { title: rule.title, detail: rule.detail || reason };
}
