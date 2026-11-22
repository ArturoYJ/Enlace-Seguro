import { readableSummary, reputationInfo } from '../reputationSummary';
import { friendlyReason } from '../friendlyReasons';

describe('reputationSummary', () => {
  it('cambia la fecha ISO del resumen por una fecha legible en hora de México', () => {
    const text = readableSummary('Informe del 2026-11-22T04:39:54.000Z; detecciones maliciosas: 0.');
    expect(text).not.toMatch(/T04:39/);
    expect(text).toMatch(/21 nov 2026/);
  });

  it('cuenta los antivirus que lo reportan y usa rojo', () => {
    const info = reputationInfo([{ sourceName: 'VirusTotal', status: 'match', summary: 'Informe del 2026-11-22T04:39:54.000Z; detecciones maliciosas: 7.' }]);
    expect(info).toEqual(expect.objectContaining({ headline: '7 antivirus lo reportan como peligroso', tone: 'danger' }));
    expect(info.checkedAt).toMatch(/21 nov 2026/);
  });

  it('sin reportes se ve neutral (no verde) y advierte que un sitio nuevo puede no estar reportado', () => {
    const info = reputationInfo([{ sourceName: 'VirusTotal', status: 'no_match', summary: 'detecciones maliciosas: 0.' }]);
    expect(info.tone).toBe('neutral');
    expect(info.text).toMatch(/recién creado/);
  });

  it('explica cada motivo de no tener resultado', () => {
    expect(reputationInfo([], [{ sourceName: 'VirusTotal', reasonCode: 'not_found' }]).short).toBe('Desconocido');
    expect(reputationInfo([], [{ sourceName: 'VirusTotal', reasonCode: 'not_queried' }]).short).toBe('No consultado');
    expect(reputationInfo().short).toBe('Sin datos');
  });
});

describe('friendlyReason', () => {
  it('traduce las razones técnicas del sandbox', () => {
    expect(friendlyReason('La página aceptó datos de acceso inventados y después pidió datos de tarjeta.').title).toBe('Te pide los datos de tu tarjeta');
    expect(friendlyReason('La página aceptó datos de acceso inventados y después pidió un código de seguridad o NIP.').title).toBe('Te pide códigos o tu NIP');
    expect(friendlyReason('Se detectó un formulario de ingreso de contraseñas sobre una conexión no cifrada (HTTP).').title).toBe('Pide contraseña sin conexión segura');
  });

  it('conserva el texto original cuando nombra la marca suplantada o no se reconoce', () => {
    const brand = 'El nombre "paypal" aparece en el enlace, pero el dominio real es "paypa1.com".';
    expect(friendlyReason(brand)).toEqual({ title: 'Usa el nombre de una marca que no es suya', detail: brand });
    expect(friendlyReason('Algo nuevo')).toEqual({ title: 'Otra señal de riesgo', detail: 'Algo nuevo' });
  });

  it('explica las razones que combinan sandbox y antivirus', () => {
    expect(friendlyReason('Los antivirus de VirusTotal todavía no reportan este enlace, pero el entorno aislado sí encontró riesgo: puede ser un sitio nuevo o bien disfrazado.').title)
      .toBe('Los antivirus no lo detectan, nosotros sí');
    expect(friendlyReason('VirusTotal reportó 3 detección(es) maliciosa(s); el resultado requiere revisión.').title).toBe('Los antivirus ya lo reportan');
  });

  it('menciona el dominio cuando el informe es del dominio', () => {
    const info = reputationInfo([{ sourceName: 'VirusTotal', status: 'no_match', summary: 'Informe del dominio chafael.github.io del 2026-11-22T04:39:54.000Z; detecciones maliciosas: 0.' }]);
    expect(info.headline).toBe('Ningún antivirus ha reportado el sitio chafael.github.io');
  });
});
