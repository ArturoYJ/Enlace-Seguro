// Upgrade daily_analyses so new attempts can persist encrypted inputs up to 64 KiB.
// Existing plaintext submittedInput values (up to the legacy 8 KiB cap) remain readable.
load('database/schema/collection-validators.js');

(function encryptAnalysisInputs() {
  const collectionName = 'daily_analyses';

  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== 'string') {
    throw new Error('Set globalThis.EnlaceSeguroExpectedDb to the intended database before loading migration 003.');
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (['admin', 'config', 'local'].includes(db.getName())) {
    throw new Error('Refusing to migrate a MongoDB system database.');
  }

  const collectionInfo = db.getCollectionInfos({ name: collectionName })[0];
  if (!collectionInfo) {
    throw new Error(`Required '${collectionName}' collection is missing; apply bootstrap 001 first.`);
  }
  const schema = collectionInfo.options?.validator?.$jsonSchema;
  const attemptProperties = schema?.properties?.attempts?.items?.properties;
  if (!schema || schema.additionalProperties !== false || !attemptProperties?.processingStatus ||
      !attemptProperties?.submittedInput) {
    throw new Error(`Existing '${collectionName}' validator is not a recognized strict baseline; refusing to replace it.`);
  }

  if (attemptProperties.submittedInputEncrypted) {
    const strictValidation = collectionInfo.options?.validationLevel === 'strict' &&
      collectionInfo.options?.validationAction === 'error';
    if (!strictValidation || attemptProperties.submittedInputEncrypted.properties?.algorithm?.enum?.[0] !== 'aes-256-gcm') {
      throw new Error(`Existing '${collectionName}' encrypted-input validator is partial or incompatible; inspect it before retrying.`);
    }
    print(`Migration 003 already present in '${db.getName()}'; no changes made.`);
    return;
  }

  const encryptedInputSchema = globalThis.EnlaceSeguroValidators?.daily_analyses;
  if (!encryptedInputSchema?.$jsonSchema?.properties?.attempts?.items?.properties?.submittedInputEncrypted) {
    throw new Error('Load database/schema/collection-validators.js before applying migration 003.');
  }

  const result = db.runCommand({
    collMod: collectionName,
    validator: encryptedInputSchema,
    validationLevel: 'strict',
    validationAction: 'error'
  });
  if (result.ok !== 1) {
    throw new Error(`Migration 003 failed to update '${collectionName}' validator.`);
  }
  print(`Migration 003 enabled encrypted input envelope validation in '${collectionName}' for '${db.getName()}'.`);
})();
