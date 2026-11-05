#!/usr/bin/env node
import dgram from 'node:dgram';

const configuredHost = process.env['REBIND_HOST'];
if (!configuredHost) {
  console.error('REBIND_HOST is required.');
  process.exit(2);
}

const rebindHost = configuredHost.toLowerCase().replace(/\.$/, '');
const labels = rebindHost.split('.');
if (
  rebindHost.length > 253 ||
  labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
) {
  console.error('REBIND_HOST must be a valid ASCII DNS hostname.');
  process.exit(2);
}

const mode = process.env['DNS_FIXTURE_MODE'] ?? 'rebind';
if (!['rebind', 'drop'].includes(mode)) {
  console.error('DNS_FIXTURE_MODE must be rebind or drop.');
  process.exit(2);
}

const dropAfterRaw = process.env['DNS_DROP_AFTER_A_QUERIES'];
let dropAfterAQueries;
if (dropAfterRaw !== undefined) {
  if (!/^(0|[1-9][0-9]*)$/.test(dropAfterRaw) || !Number.isSafeInteger(Number(dropAfterRaw))) {
    console.error('DNS_DROP_AFTER_A_QUERIES must be a non-negative safe integer.');
    process.exit(2);
  }
  dropAfterAQueries = Number(dropAfterRaw);
}

const PORT = 53;
const BIND_ADDRESS = '0.0.0.0';
const ALLOWED_SYNTHETIC_ADDRESS = '192.0.2.10';
const PRIVATE_CANARY_ADDRESS = '198.18.0.10';
let aQueryCount = 0;

function parseQuestion(packet) {
  if (packet.length < 17) return null;
  const flags = packet.readUInt16BE(2);
  const questionCount = packet.readUInt16BE(4);
  if ((flags & 0x8000) !== 0 || questionCount !== 1) return null;

  const labelsInQuestion = [];
  let offset = 12;
  let totalNameLength = 0;
  while (offset < packet.length) {
    const labelLength = packet[offset++];
    if (labelLength === 0) break;
    if ((labelLength & 0xc0) !== 0 || labelLength > 63 || offset + labelLength > packet.length) return null;
    totalNameLength += labelLength + 1;
    if (totalNameLength > 255) return null;
    const labelBytes = packet.subarray(offset, offset + labelLength);
    if ([...labelBytes].some((byte) => byte < 0x21 || byte > 0x7e)) return null;
    labelsInQuestion.push(labelBytes.toString('ascii').toLowerCase());
    offset += labelLength;
  }

  if (offset > packet.length || packet[offset - 1] !== 0 || offset + 4 > packet.length) return null;
  const name = labelsInQuestion.join('.');
  const type = packet.readUInt16BE(offset);
  const klass = packet.readUInt16BE(offset + 2);
  const questionEnd = offset + 4;
  return { flags, name, type, klass, questionEnd };
}

function buildResponse(packet, question, { rcode = 0, answerAddress } = {}) {
  const questionBytes = packet.subarray(12, question.questionEnd);
  const answerBytes = answerAddress ? 16 : 0;
  const response = Buffer.alloc(12 + questionBytes.length + answerBytes);
  packet.copy(response, 0, 0, 2);

  // QR + authoritative answer; preserve the request's recursion-desired bit.
  const flags = 0x8400 | (question.flags & 0x0100) | (rcode & 0x000f);
  response.writeUInt16BE(flags, 2);
  response.writeUInt16BE(1, 4);
  response.writeUInt16BE(answerAddress ? 1 : 0, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);
  questionBytes.copy(response, 12);

  if (answerAddress) {
    let offset = 12 + questionBytes.length;
    response[offset++] = 0xc0;
    response[offset++] = 0x0c;
    response.writeUInt16BE(1, offset); // A
    offset += 2;
    response.writeUInt16BE(1, offset); // IN
    offset += 2;
    response.writeUInt32BE(1, offset); // TTL: one second for repeatable fixture behavior
    offset += 4;
    response.writeUInt16BE(4, offset);
    offset += 2;
    for (const octet of answerAddress.split('.').map(Number)) response[offset++] = octet;
  }

  return response;
}

function buildFormError(packet) {
  const response = Buffer.alloc(12);
  if (packet.length >= 2) packet.copy(response, 0, 0, 2);
  const requestFlags = packet.length >= 4 ? packet.readUInt16BE(2) : 0;
  response.writeUInt16BE(0x8001 | (requestFlags & 0x0100), 2); // QR + FORMERR
  response.writeUInt16BE(0, 4);
  response.writeUInt16BE(0, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);
  return response;
}

const socket = dgram.createSocket('udp4');
socket.on('error', (error) => {
  console.error(`DNS_FIXTURE_ERROR ${error.message}`);
  socket.close();
  process.exitCode = 1;
});

socket.on('message', (packet, remote) => {
  if (mode === 'drop') {
    const parsed = parseQuestion(packet);
    const name = parsed?.name ?? '<malformed>';
    console.log(`DNS_DROP_QUERY name=${name}`);
    return;
  }

  const question = parseQuestion(packet);
  if (!question) {
    socket.send(buildFormError(packet), remote.port, remote.address);
    return;
  }

  if (question.name !== rebindHost) {
    socket.send(buildResponse(packet, question, { rcode: 3 }), remote.port, remote.address); // NXDOMAIN
    return;
  }

  if (question.klass !== 1 || question.type !== 1) {
    // The matching AAAA and other non-A queries return NOERROR/NODATA.
    socket.send(buildResponse(packet, question), remote.port, remote.address);
    return;
  }

  aQueryCount += 1;
  if (dropAfterAQueries !== undefined && aQueryCount > dropAfterAQueries) {
    console.log(`DNS_A_QUERY_DROPPED number=${aQueryCount} name=${question.name}`);
    return;
  }
  const address = aQueryCount <= 2 ? ALLOWED_SYNTHETIC_ADDRESS : PRIVATE_CANARY_ADDRESS;
  console.log(`DNS_A_QUERY number=${aQueryCount} name=${question.name} address=${address}`);
  socket.send(buildResponse(packet, question, { answerAddress: address }), remote.port, remote.address);
});

socket.bind(PORT, BIND_ADDRESS, () => {
  console.log(`DNS_FIXTURE_READY address=${BIND_ADDRESS} port=${PORT} mode=${mode} host=${rebindHost}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => socket.close(() => process.exit(0)));
}
