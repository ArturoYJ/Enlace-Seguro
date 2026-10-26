// One-time bootstrap for a new, empty EnlaceSeguro BDaaS database.
// Execute only against an explicitly selected test/development DB after review.
// This script intentionally refuses existing collections and never drops data.
load("database/schema/collection-validators.js");

(function bootstrapEnlaceSeguroSchema() {
  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== "string") {
    throw new Error("Set globalThis.EnlaceSeguroExpectedDb to the intended database name before loading this bootstrap.");
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (["admin", "config", "local"].includes(db.getName())) {
    throw new Error("Refusing to bootstrap MongoDB system databases.");
  }

  const collectionNames = [
    "users",
    "daily_analyses",
    "reputation_cache",
    "security_audit_events",
    "refresh_tokens"
  ];
  const existing = db.getCollectionInfos({ name: { $in: collectionNames } }).map((item) => item.name);

  if (existing.length > 0) {
    throw new Error(
      `Refusing to modify existing collections: ${existing.join(", ")}. ` +
      "Review and write an explicit migration after inspecting their documents."
    );
  }

  for (const name of collectionNames) {
    db.createCollection(name, {
      validator: EnlaceSeguroValidators[name],
      validationLevel: "strict",
      validationAction: "error"
    });
  }

  db.users.createIndex(
    { emailNormalized: 1 },
    { name: "uq_users_email_normalized", unique: true }
  );
  db.users.createIndex(
    { role: 1 },
    {
      name: "uq_users_single_admin",
      unique: true,
      partialFilterExpression: { role: "admin" }
    }
  );

  db.daily_analyses.createIndex(
    { userId: 1, localDate: 1 },
    { name: "uq_daily_analyses_user_date", unique: true }
  );
  db.daily_analyses.createIndex(
    { "attempts.attemptId": 1 },
    { name: "uq_daily_analyses_attempt_id", unique: true }
  );
  db.daily_analyses.createIndex(
    { localDate: 1 },
    { name: "ix_daily_analyses_local_date" }
  );
  db.daily_analyses.createIndex(
    { purgeAt: 1 },
    { name: "ttl_daily_analyses_purge_at", expireAfterSeconds: 0 }
  );

  db.reputation_cache.createIndex(
    { keyType: 1, normalizedKey: 1 },
    { name: "uq_reputation_cache_type_key", unique: true }
  );
  db.reputation_cache.createIndex(
    { purgeAt: 1 },
    { name: "ttl_reputation_cache_purge_at", expireAfterSeconds: 0 }
  );

  db.security_audit_events.createIndex(
    { occurredAt: -1, _id: -1 },
    { name: "ix_audit_occurred_at_id_desc" }
  );
  db.security_audit_events.createIndex(
    { eventType: 1, occurredAt: -1, _id: -1 },
    { name: "ix_audit_type_occurred_at_id_desc" }
  );
  db.security_audit_events.createIndex(
    { purgeAt: 1 },
    { name: "ttl_audit_purge_at", expireAfterSeconds: 0 }
  );

  db.refresh_tokens.createIndex(
    { tokenHash: 1 },
    { name: "uq_refresh_tokens_hash", unique: true }
  );
  db.refresh_tokens.createIndex(
    { userId: 1 },
    { name: "ix_refresh_tokens_user_id" }
  );
  db.refresh_tokens.createIndex(
    { familyId: 1 },
    { name: "ix_refresh_tokens_family_id" }
  );
  db.refresh_tokens.createIndex(
    { expiresAt: 1 },
    { name: "ttl_refresh_tokens_expires_at", expireAfterSeconds: 0 }
  );

  print("EnlaceSeguro MongoDB collections, validators, and candidate indexes created.");
})();
