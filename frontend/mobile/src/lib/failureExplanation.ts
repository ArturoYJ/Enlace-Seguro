import { colors } from '../theme/tokens';

// La API manda una categoría pública (failureReason) cuando un análisis no pudo dar veredicto.
// Aquí se traduce a lenguaje sencillo: qué pasó, qué significa y qué hacer.
export type FailureExplanation = {
  title: string;
  message: string;
  short: string;
  color: string;
  tips: string[];
  /** Si vale la pena volver a intentarlo (por ejemplo, si fue por demanda o lentitud). */
  retryUseful: boolean;
};

const explanations: Record<string, FailureExplanation> = {
  site_unreachable: {
    title: 'El sitio no respondió',
    message: 'Intentamos abrir la página varias veces y nadie contestó. La dirección puede estar mal escrita, el sitio pudo cerrarse o nunca existió.',
    short: 'No respondió', color: colors.warning, retryUseful: false,
    tips: ['Revisa que el enlace esté completo y bien escrito.', 'Si te llegó por mensaje y no sabes de quién es, no lo abras.', 'Los sitios falsos suelen desaparecer en pocas horas.'],
  },
  site_too_slow: {
    title: 'El sitio tardó demasiado',
    message: 'La página no terminó de cargar en el tiempo máximo que damos a cada revisión.',
    short: 'Muy lento', color: colors.warning, retryUseful: true,
    tips: ['Intenta de nuevo en unos minutos.', 'Un sitio que no carga también es motivo para desconfiar.'],
  },
  dns_unavailable: {
    title: 'Esa dirección no existe',
    message: 'No encontramos ningún sitio con ese nombre. Puede estar mal escrito o ya lo dieron de baja.',
    short: 'No existe', color: colors.warning, retryUseful: false,
    tips: ['Revisa letra por letra: los fraudes usan nombres parecidos a los reales.', 'No intentes abrirlo desde tu teléfono.'],
  },
  tls_invalid: {
    title: 'La conexión segura no es válida',
    message: 'El candado de seguridad de esta página no es válido. Así se ven muchos sitios falsos o mal configurados.',
    short: 'Sin candado válido', color: colors.danger, retryUseful: false,
    tips: ['No escribas contraseñas ni datos de tarjeta en esta página.', 'Si dice ser de una empresa conocida, entra desde su app oficial.'],
  },
  too_heavy: {
    title: 'La página es demasiado pesada',
    message: 'Intentó cargar más contenido del que permitimos en una revisión segura.',
    short: 'Muy pesada', color: colors.warning, retryUseful: true,
    tips: ['Desconfía si no esperabas este enlace.', 'Puedes intentarlo de nuevo más tarde.'],
  },
  page_unreadable: {
    title: 'No pudimos leer la página',
    message: 'La página abrió, pero su contenido no se pudo revisar.',
    short: 'No legible', color: colors.warning, retryUseful: true,
    tips: ['Intenta de nuevo en unos minutos.', 'Mientras tanto, no escribas datos personales en ella.'],
  },
  service_busy: {
    title: 'Hay mucha demanda',
    message: 'Nuestro servicio de revisión está ocupado en este momento.',
    short: 'Ocupado', color: colors.textSecondary, retryUseful: true,
    tips: ['Intenta de nuevo en un minuto.'],
  },
  service_error: {
    title: 'No pudimos terminar la revisión',
    message: 'Ocurrió un problema de nuestro lado al analizar el enlace. No es un veredicto sobre el sitio.',
    short: 'Error', color: colors.textSecondary, retryUseful: true,
    tips: ['Intenta de nuevo en unos minutos.', 'Mientras tanto, no abras el enlace si no confías en quien te lo mandó.'],
  },
};

export function failureExplanation(reason?: string): FailureExplanation {
  return explanations[reason ?? ''] ?? explanations.service_error;
}
