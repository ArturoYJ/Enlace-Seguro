import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readE2EServerConfig } from './server.js';

describe('E2E server configuration guards', () => {
  it('requires a fresh local E2E database and uses safe loopback defaults', () => {
    const config = readE2EServerConfig({
      MONGO_TEST_URI: 'mongodb://127.0.0.1:27017/enlaceseguro_test_e2e_run-123?replicaSet=rs0'
    });

    assert.equal(config.databaseName, 'enlaceseguro_test_e2e_run-123');
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
  });

  it('allows the isolated emulator bridge bind only when explicitly configured', () => {
    const config = readE2EServerConfig({
      MONGO_TEST_URI: 'mongodb://localhost:27017/enlaceseguro_test_e2e_job_a',
      E2E_API_HOST: '0.0.0.0',
      E2E_API_PORT: '3100'
    });

    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 3100);
  });

  it('rejects absent Mongo configuration, non-test databases, remote hosts, and invalid ports', () => {
    assert.throws(() => readE2EServerConfig({}), /MONGO_TEST_URI is required/);
    assert.throws(() => readE2EServerConfig({ MONGO_TEST_URI: 'mongodb://127.0.0.1:27017/enlaceseguro_dev' }), /Refusing E2E database name/);
    assert.throws(() => readE2EServerConfig({ MONGO_TEST_URI: 'mongodb://mongo.example/ enlaceseguro_test_e2e_run' }), /point to localhost/);
    assert.throws(() => readE2EServerConfig({
      MONGO_TEST_URI: 'mongodb://127.0.0.1:27017/enlaceseguro_test_e2e_run',
      E2E_API_PORT: '0'
    }), /E2E_API_PORT/);
    assert.throws(() => readE2EServerConfig({
      MONGO_TEST_URI: 'mongodb://127.0.0.1:27017/enlaceseguro_test_e2e_run',
      E2E_API_PORT: 'not-a-port'
    }), /E2E_API_PORT/);
    assert.throws(() => readE2EServerConfig({
      MONGO_TEST_URI: 'mongodb://127.0.0.1:27017/enlaceseguro_test_e2e_run',
      E2E_API_HOST: '192.168.1.5'
    }), /E2E_API_HOST/);
  });
});
