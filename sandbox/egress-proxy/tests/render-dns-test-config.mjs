import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, outputPath, resolverAddress] = process.argv.slice(2);
if (!sourcePath || !outputPath || !resolverAddress || !/^\d{1,3}(\.\d{1,3}){3}$/.test(resolverAddress)) {
  throw new Error('Usage: node render-dns-test-config.mjs <source> <output> <resolver-ipv4>');
}

const source = readFileSync(sourcePath, 'utf8');
let replacements = 0;
const rendered = source.replace(/^(\s*)dns_lookup_family: ALL$/gm, (_line, indent) => {
  replacements++;
  return [
    `${indent}dns_lookup_family: ALL`,
    `${indent}typed_dns_resolver_config:`,
    `${indent}  name: envoy.network.dns_resolver.cares`,
    `${indent}  typed_config:`,
    `${indent}    "@type": type.googleapis.com/envoy.extensions.network.dns_resolver.cares.v3.CaresDnsResolverConfig`,
    `${indent}    resolvers:`,
    `${indent}      - socket_address:`,
    `${indent}          address: ${resolverAddress}`,
    `${indent}          port_value: 53`,
    `${indent}    dns_resolver_options:`,
    `${indent}      no_default_search_domain: true`
  ].join('\n');
});

if (replacements !== 2) {
  throw new Error(`Expected exactly two DFP DNS cache configs, found ${replacements}.`);
}
writeFileSync(outputPath, rendered, { mode: 0o600 });
