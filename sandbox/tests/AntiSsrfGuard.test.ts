import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';

describe('AntiSsrfGuard', () => {
  describe('Protocol and Hostname Scheme Validation', () => {
    it('should accept valid public http and https URLs', () => {
      const httpRes = AntiSsrfGuard.isSafeUrl('http://example.com/login');
      const httpsRes = AntiSsrfGuard.isSafeUrl('https://example.com/checkout?id=123');

      assert.equal(httpRes.valid, true);
      assert.equal(httpsRes.valid, true);
    });

    it('should reject non-http schemes (file, javascript, data, ftp, gopher)', () => {
      const disallowed = [
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://anonymous@ftp.example.com',
        'gopher://127.0.0.1:70/'
      ];

      for (const url of disallowed) {
        const res = AntiSsrfGuard.isSafeUrl(url);
        assert.equal(res.valid, false, `Expected ${url} to be rejected`);
      }
    });

    it('should reject URLs with embedded user credentials', () => {
      const res = AntiSsrfGuard.isSafeUrl('https://admin:supersecret@example.com/dashboard');
      assert.equal(res.valid, false);
      assert.ok(res.reason?.includes('credentials'));
    });

    it('should reject localhost and local domain variations', () => {
      const blocked = [
        'http://localhost:8080',
        'https://sub.localhost/api',
        'http://internal.service.local'
      ];

      for (const url of blocked) {
        const res = AntiSsrfGuard.isSafeUrl(url);
        assert.equal(res.valid, false, `Expected ${url} to be rejected`);
      }
    });
  });

  describe('IPv4 Private & Reserved Range Detection', () => {
    it('should block loopback addresses (127.0.0.0/8)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('127.0.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('127.1.2.3'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('127.255.255.255'), true);
    });

    it('should block RFC 1918 Class A (10.0.0.0/8)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('10.0.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('10.254.12.3'), true);
    });

    it('should block RFC 1918 Class B (172.16.0.0/12)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('172.16.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('172.24.10.5'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('172.31.255.255'), true);
      // 172.32.0.1 is public
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('172.32.0.1'), false);
    });

    it('should block RFC 1918 Class C (192.168.0.0/16)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('192.168.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('192.168.254.254'), true);
    });

    it('should block Link-Local & Cloud Metadata endpoint (169.254.169.254)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('169.254.169.254'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('169.254.1.1'), true);
    });

    it('should block Carrier-grade NAT (100.64.0.0/10)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('100.64.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('100.127.255.255'), true);
      // 100.128.0.1 is outside the /10 range
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('100.128.0.1'), false);
    });

    it('should allow legitimate public IPv4 addresses', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('8.8.8.8'), false);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('1.1.1.1'), false);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('93.184.216.34'), false);
    });
  });

  describe('IPv6 Private & Reserved Range Detection', () => {
    it('should block IPv6 loopback (::1) and unspecified (::)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::'), true);
    });

    it('should block IPv6 Unique Local Addresses (fc00::/7)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('fc00::1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('fd12:3456:789a::1'), true);
    });

    it('should block IPv6 Link-Local (fe80::/10)', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('fe80::1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('febf::ffff'), true);
    });

    it('should block IPv4-mapped IPv6 pointing to private addresses', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::ffff:192.168.1.1'), true);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::ffff:169.254.169.254'), true);
      // Public IPv4-mapped
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('::ffff:8.8.8.8'), false);
    });

    it('should allow legitimate public IPv6 addresses', () => {
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('2606:4700:4700::1111'), false);
      assert.equal(AntiSsrfGuard.isPrivateOrReservedIp('2001:4860:4860::8888'), false);
    });
  });
});
