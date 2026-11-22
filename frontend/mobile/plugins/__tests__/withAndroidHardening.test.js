const { cleartextApiHost, networkSecurityConfigXml } = require('../withAndroidHardening');

describe('withAndroidHardening', () => {
  it('permite HTTP solo hacia una API en red local', () => {
    expect(cleartextApiHost('http://192.168.0.19:3000/api/v1')).toBe('192.168.0.19');
    expect(cleartextApiHost('http://10.0.2.2:3000/api/v1')).toBe('10.0.2.2');
    expect(cleartextApiHost('http://172.20.1.5:3000/api/v1')).toBe('172.20.1.5');
  });

  it('no abre excepciones para HTTPS, hosts públicos ni valores inválidos', () => {
    expect(cleartextApiHost('https://192.168.0.19:3000/api/v1')).toBeNull();
    expect(cleartextApiHost('http://api.ejemplo.com/api/v1')).toBeNull();
    expect(cleartextApiHost('http://8.8.8.8/api/v1')).toBeNull();
    expect(cleartextApiHost('http://172.32.0.1/api/v1')).toBeNull();
    expect(cleartextApiHost(undefined)).toBeNull();
    expect(cleartextApiHost('no es url')).toBeNull();
  });

  it('prohíbe HTTP en la configuración base y agrega solo el host permitido', () => {
    const local = networkSecurityConfigXml('192.168.0.19');
    expect(local).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(local).toContain('<domain includeSubdomains="false">192.168.0.19</domain>');
    expect(networkSecurityConfigXml(null)).not.toContain('domain-config');
  });
});
