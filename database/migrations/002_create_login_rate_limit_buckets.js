// Incremental MongoDB migration for shared login throttling.
// Apply only after bootstrap 001 and after setting the explicit expected DB.
(function createLoginRateLimitBuckets() {
  const collectionName = 'login_rate_limit_buckets';
  const ttlIndexName = 'ttl_login_rate_limit_expires_at';

  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== 'string') {
    throw new Error('Set globalThis.EnlaceSeguroExpectedDb to the intended database before loading migration 002.');
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (['admin', 'config', 'local'].includes(db.getName())) {
    throw new Error('Refusing to migrate a MongoDB system database.');
  }

  const validator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'schemaVersion', 'events', 'expiresAt'],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'string', pattern: '^v1:[a-f0-9]{64}$' },
        schemaVersion: { bsonType: ['int', 'long', 'double'], enum: [1] },
        events: {
          bsonType: 'array',
          minItems: 0,
          maxItems: 20,
          items: { bsonType: 'date' }
        },
        expiresAt: { bsonType: 'date' }
      }
    }
  };

  const existing = db.getCollectionInfos({ name: collectionName })[0];
  if (existing) {
    const properties = existing.options?.validator?.$jsonSchema?.properties ?? {};
    const jsonSchema = existing.options?.validator?.$jsonSchema;
    const compatibleValidator = jsonSchema?.additionalProperties === false &&
      ['_id', 'schemaVersion', 'events', 'expiresAt'].every((field) => Object.hasOwn(properties, field)) &&
      properties._id?.pattern === '^v1:[a-f0-9]{64}$' &&
      properties.events?.maxItems === 20 &&
      properties.events?.items?.bsonType === 'date';
    const strictValidation = existing.options?.validationLevel === 'strict' && existing.options?.validationAction === 'error';
    const ttlPresent = db.getCollection(collectionName).getIndexes().some(
      (index) => index.name === ttlIndexName && index.expireAfterSeconds === 0
    );
    if (!compatibleValidator || !strictValidation || !ttlPresent) {
      throw new Error(`Existing '${collectionName}' is partial or incompatible; inspect and recover it explicitly before retrying.`);
    }
    print(`Migration 002 already present in '${db.getName()}'; no changes made.`);
    return;
  }

  db.createCollection(collectionName, {
    validator,
    validationLevel: 'strict',
    validationAction: 'error'
  });
  db.getCollection(collectionName).createIndex(
    { expiresAt: 1 },
    { name: ttlIndexName, expireAfterSeconds: 0 }
  );

  print(`Migration 002 created '${collectionName}' and its strict validator/TTL index in '${db.getName()}'.`);
})();
