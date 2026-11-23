import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertMongoUriPolicy } from '../../../src/infrastructure/database/mongo/mongoUriPolicy.js';

describe('assertMongoUriPolicy', () => {
  it('fuera de producción acepta la base local sin TLS', () => {
    assert.doesNotThrow(() => assertMongoUriPolicy('mongodb://localhost:27017', 'development'));
  });

  it('en producción acepta Atlas (mongodb+srv) y mongodb:// con tls=true', () => {
    for (const uri of ['mongodb+srv://user:pass@cluster0.abcd.mongodb.net/?retryWrites=true&w=majority',
      'mongodb://user:pass@db.example.com:27017/?tls=true&replicaSet=rs0', 'mongodb://db.example.com/?ssl=TRUE']) {
      assert.doesNotThrow(() => assertMongoUriPolicy(uri, 'production'), uri);
    }
  });

  it('en producción rechaza conexiones sin TLS o que no validan el certificado', () => {
    for (const uri of ['mongodb://localhost:27017', 'mongodb+srv://c.mongodb.net/?tls=false',
      'mongodb://db.example.com/?tls=true&tlsAllowInvalidCertificates=true', 'mongodb+srv://c.mongodb.net/?tlsInsecure=true',
      'postgres://db.example.com/?tls=true', 'no es una uri']) {
      assert.throws(() => assertMongoUriPolicy(uri, 'production'), /TLS|valid/, uri);
    }
  });
});
