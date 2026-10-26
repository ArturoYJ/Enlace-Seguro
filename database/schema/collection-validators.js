// MongoDB 8.0.x JSON Schema contracts. Loaded by the migration through mongosh.
// Keep this file declarative: app-level invariants are documented separately.
globalThis.EnlaceSeguroValidators = {
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "schemaVersion", "emailNormalized", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt"],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "objectId" },
        schemaVersion: { bsonType: ["int", "long", "double"], enum: [1] },
        emailNormalized: { bsonType: "string", minLength: 1, maxLength: 254 },
        passwordHash: { bsonType: "string", minLength: 1, maxLength: 255 },
        role: { bsonType: "string", enum: ["admin", "usuario"] },
        accountStatus: { bsonType: "string", enum: ["active", "disabled"] },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" }
      }
    }
  },

  daily_analyses: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "schemaVersion", "userId", "localDate", "attempts", "purgeAt"],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "objectId" },
        schemaVersion: { bsonType: ["int", "long", "double"], enum: [1] },
        userId: { bsonType: "objectId" },
        localDate: { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", minLength: 10, maxLength: 10 },
        purgeAt: { bsonType: "date" },
        attempts: {
          bsonType: "array",
          minItems: 0,
          maxItems: 5,
          items: {
            bsonType: "object",
            required: ["attemptId", "receivedAt", "updatedAt", "processingStatus", "inputDigest", "inputSizeBytes"],
            additionalProperties: false,
            properties: {
              attemptId: {
                bsonType: "string",
                pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                minLength: 36,
                maxLength: 36
              },
              receivedAt: { bsonType: "date" },
              updatedAt: { bsonType: "date" },
              completedAt: { bsonType: "date" },
              processingStatus: {
                bsonType: "string",
                enum: ["received", "validation_failed", "processing", "completed", "inconclusive", "failed"]
              },
              submittedInput: { bsonType: "string", maxLength: 8192 },
              inputDigest: { bsonType: "string", pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 },
              inputSizeBytes: { bsonType: ["int", "long", "double"], minimum: 0 },
              analysis: {
                bsonType: "object",
                additionalProperties: false,
                properties: {
                  verdict: { bsonType: "string", enum: ["peligroso", "sospechoso", "sin_amenazas_detectadas"] },
                  reasons: {
                    bsonType: "array",
                    maxItems: 10,
                    items: { bsonType: "string", maxLength: 512 }
                  },
                  finalDestination: { bsonType: "string", maxLength: 8192 },
                  sourceResults: {
                    bsonType: "array",
                    maxItems: 4,
                    items: {
                      bsonType: "object",
                      required: ["sourceName", "status", "checkedAt", "expiresAt"],
                      additionalProperties: false,
                      properties: {
                        sourceName: { bsonType: "string", minLength: 1, maxLength: 64 },
                        status: { bsonType: "string", minLength: 1, maxLength: 32 },
                        checkedAt: { bsonType: "date" },
                        expiresAt: { bsonType: "date" },
                        resultCode: { bsonType: "string", maxLength: 128 },
                        summary: { bsonType: "string", maxLength: 2048 }
                      }
                    }
                  },
                  sourceFailures: {
                    bsonType: "array",
                    maxItems: 4,
                    items: {
                      bsonType: "object",
                      required: ["sourceName", "reasonCode"],
                      additionalProperties: false,
                      properties: {
                        sourceName: { bsonType: "string", minLength: 1, maxLength: 64 },
                        reasonCode: { bsonType: "string", minLength: 1, maxLength: 128 }
                      }
                    }
                  },
                  signals: {
                    bsonType: "array",
                    maxItems: 50,
                    items: { bsonType: "string", minLength: 1, maxLength: 256 }
                  },
                  redirects: {
                    bsonType: "array",
                    maxItems: 10,
                    items: { bsonType: "string", minLength: 1, maxLength: 8192 }
                  },
                  screenshotRef: { bsonType: "string", minLength: 1, maxLength: 2048 }
                }
              }
            }
          }
        }
      }
    }
  },

  reputation_cache: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "schemaVersion", "keyType", "normalizedKey", "sources", "updatedAt", "purgeAt"],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "objectId" },
        schemaVersion: { bsonType: ["int", "long", "double"], enum: [1] },
        keyType: { bsonType: "string", enum: ["url", "domain"] },
        normalizedKey: { bsonType: "string", minLength: 1, maxLength: 8192 },
        updatedAt: { bsonType: "date" },
        purgeAt: { bsonType: "date" },
        sources: {
          bsonType: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            bsonType: "object",
            required: ["sourceName", "status", "checkedAt", "expiresAt"],
            additionalProperties: false,
            properties: {
              sourceName: { bsonType: "string", minLength: 1, maxLength: 64 },
              status: { bsonType: "string", minLength: 1, maxLength: 32 },
              checkedAt: { bsonType: "date" },
              expiresAt: { bsonType: "date" },
              resultCode: { bsonType: "string", maxLength: 128 },
              summary: { bsonType: "string", maxLength: 2048 }
            }
          }
        }
      }
    }
  },

  security_audit_events: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "schemaVersion", "occurredAt", "purgeAt", "eventType"],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "objectId" },
        schemaVersion: { bsonType: ["int", "long", "double"], enum: [1] },
        occurredAt: { bsonType: "date" },
        purgeAt: { bsonType: "date" },
        eventType: {
          bsonType: "string",
          enum: [
            "auth.login.succeeded", "auth.login.failed", "authz.denied", "account.registered",
            "analysis.accepted", "analysis.validation_failed", "analysis.completed",
            "analysis.inconclusive", "analysis.failed", "admin.audit.read"
          ]
        },
        actorType: { bsonType: "string", minLength: 1, maxLength: 32 },
        actorId: { bsonType: "objectId" },
        action: { bsonType: "string", minLength: 1, maxLength: 64 },
        outcome: { bsonType: "string", enum: ["success", "failure", "denied", "partial"] },
        resourceType: { bsonType: "string", minLength: 1, maxLength: 64 },
        resourceId: { bsonType: "string", minLength: 1, maxLength: 128 },
        requestId: { bsonType: "string", minLength: 1, maxLength: 128 },
        metadata: {
          bsonType: "object",
          maxProperties: 5,
          additionalProperties: false,
          properties: {
            reasonCode: { bsonType: "string", minLength: 1, maxLength: 64 },
            sourceName: { bsonType: "string", minLength: 1, maxLength: 64 },
            providerCode: { bsonType: "string", minLength: 1, maxLength: 64 },
            analysisStatus: {
              bsonType: "string",
              enum: ["received", "validation_failed", "processing", "completed", "inconclusive", "failed"]
            },
            httpStatus: { bsonType: "int", minimum: 100, maximum: 599 }
          }
        }
      }
    }
  },

  refresh_tokens: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "_id",
        "schemaVersion",
        "userId",
        "tokenHash",
        "familyId",
        "isRevoked",
        "createdAt",
        "expiresAt"
      ],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "objectId" },
        schemaVersion: { bsonType: ["int", "long", "double"], enum: [1] },
        userId: { bsonType: "objectId" },
        tokenHash: {
          bsonType: "string",
          pattern: "^[0-9a-f]{64}$",
          minLength: 64,
          maxLength: 64
        },
        familyId: {
          bsonType: "string",
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          minLength: 36,
          maxLength: 36
        },
        isRevoked: { bsonType: "bool" },
        createdAt: { bsonType: "date" },
        expiresAt: { bsonType: "date" }
      }
    }
  }
};
