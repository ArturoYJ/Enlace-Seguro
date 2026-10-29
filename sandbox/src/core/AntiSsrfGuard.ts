import dns from 'node:dns/promises';
import net from 'node:net';

export interface SsrfValidationResult {
  safe: boolean;
  resolvedIp?: string;
  reason?: string;
}

export class AntiSsrfGuard {
  private static readonly BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'broadcasthost',
    'local'
  ]);

  public static isSafeUrl(rawUrl: string): { valid: boolean; reason?: string; parsedUrl?: URL } {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { valid: false, reason: 'Malformed URL structure.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Disallowed protocol scheme '${parsed.protocol}'. Only http: and https: are allowed.`
      };
    }

    if (parsed.username || parsed.password) {
      return {
        valid: false,
        reason: 'Embedded user credentials in URL are prohibited.'
      };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname.length === 0) {
      return { valid: false, reason: 'Empty hostname.' };
    }

    if (this.BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      return {
        valid: false,
        reason: `Target hostname '${hostname}' belongs to loopback or local mDNS namespace.`
      };
    }

    return { valid: true, parsedUrl: parsed };
  }

  public static async validateDestination(parsedUrl: URL): Promise<SsrfValidationResult> {
    const hostname = parsedUrl.hostname.toLowerCase();

    // If hostname is directly an IP literal
    if (net.isIP(hostname)) {
      if (this.isPrivateOrReservedIp(hostname)) {
        return {
          safe: false,
          resolvedIp: hostname,
          reason: `Target IP '${hostname}' resides in a private, loopback, or reserved network range.`
        };
      }
      return { safe: true, resolvedIp: hostname };
    }

    // Resolve DNS
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return {
          safe: false,
          reason: `DNS resolution failed for hostname '${hostname}': No records found.`
        };
      }

      for (const record of records) {
        if (this.isPrivateOrReservedIp(record.address)) {
          return {
            safe: false,
            resolvedIp: record.address,
            reason: `DNS resolution for '${hostname}' yielded private/reserved IP '${record.address}'.`
          };
        }
      }

      return {
        safe: true,
        resolvedIp: records[0]?.address
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'DNS lookup error';
      return {
        safe: false,
        reason: `DNS resolution error for '${hostname}': ${message}`
      };
    }
  }

  public static isPrivateOrReservedIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) {
      return this.isPrivateOrReservedIpv4(ip);
    }
    if (family === 6) {
      return this.isPrivateOrReservedIpv6(ip);
    }
    return true; // Unknown family is treated as unsafe by default
  }

  private static isPrivateOrReservedIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [b0 = 0, b1 = 0] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 10.0.0.0/8 (Private - RFC 1918)
    if (b0 === 10) return true;

    // 100.64.0.0/10 (Shared Address Space - Carrier-grade NAT RFC 6598: 100.64.0.0 to 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 169.254.0.0/16 (Link-Local & Cloud Metadata, e.g., 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 172.16.0.0/12 (Private - RFC 1918: 172.16.0.0 to 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;

    // 192.168.0.0/16 (Private - RFC 1918)
    if (b0 === 192 && b1 === 168) return true;

    // 198.18.0.0/15 (Benchmarking: 198.18.0.0 to 198.19.255.255)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved / Future use)
    if (b0 >= 240) return true;

    return false;
  }

  private static isPrivateOrReservedIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    // Loopback ::1 and unspecified ::
    if (normalized === '::1' || normalized === '::') return true;

    // IPv4-mapped IPv6 (::ffff:w.x.y.z)
    if (normalized.startsWith('::ffff:')) {
      const ipv4Part = normalized.substring(7);
      if (net.isIPv4(ipv4Part)) {
        return this.isPrivateOrReservedIpv4(ipv4Part);
      }
    }

    // Unique Local Addresses (fc00::/7 -> fc00 to fdff)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    // Link-local unicast (fe80::/10 -> fe80 to febf)
    if (/^fe[89ab]/i.test(normalized)) return true;

    // Multicast (ff00::/8)
    if (normalized.startsWith('ff')) return true;

    // Discard-only (100::/64)
    if (normalized.startsWith('100:')) return true;

    // Documentation prefix (2001:db8::/32)
    if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0db8:')) return true;

    return false;
  }
}
