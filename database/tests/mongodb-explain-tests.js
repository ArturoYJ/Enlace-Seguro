// Generates synthetic fixtures and reports explain('executionStats') for the
// repository/catalog query shapes. Run only once per fresh disposable DB.
// This script intentionally does not alter indexes or delete data.
(function runMongoExplainTests() {
  const databaseName = db.getName();
  const version = db.version();
  if (!/^enlaceseguro_test_[a-z0-9_-]+$/.test(databaseName)) {
    throw new Error(`Refusing writes to non-test database '${databaseName}'.`);
  }
  if (!/^8\.0\./.test(version)) {
    throw new Error(`Expected MongoDB 8.0.x, got ${version}.`);
  }

  const expectedCollections = [
    'analysis_queue_capacity', 'daily_analyses', 'login_rate_limit_buckets', 'reputation_cache', 'refresh_tokens', 'security_audit_events', 'users'
  ].sort();
  const collectionNames = db.getCollectionNames().sort();
  if (JSON.stringify(collectionNames) !== JSON.stringify(expectedCollections)) {
    throw new Error(`Expected bootstrapped test collections; got ${JSON.stringify(collectionNames)}.`);
  }
  const collectionInfo = db.getCollectionInfos({ name: { $in: expectedCollections } });
  if (collectionInfo.length !== expectedCollections.length || collectionInfo.some((item) => !item.options.validator)) {
    throw new Error('Expected strict validators on all seven EnlaceSeguro test collections.');
  }

  const requiredIndexes = [
    ['daily_analyses', 'uq_daily_analyses_user_date'],
    ['daily_analyses', 'uq_daily_analyses_attempt_id'],
    ['security_audit_events', 'ix_audit_occurred_at_id_desc'],
    ['security_audit_events', 'ix_audit_type_occurred_at_id_desc']
  ];
  for (const [collectionName, indexName] of requiredIndexes) {
    const indexes = db.getCollection(collectionName).getIndexes();
    if (!indexes.some((index) => index.name === indexName)) {
      throw new Error(`Missing bootstrap index ${collectionName}.${indexName}.`);
    }
  }

  const daily = db.getCollection('daily_analyses');
  const audit = db.getCollection('security_audit_events');
  if (daily.countDocuments({}) >= 100 || audit.countDocuments({}) >= 100) {
    throw new Error('Refusing to accumulate large explain fixtures; run this once in a fresh disposable database.');
  }
  const runPrefix = new ObjectId().toHexString().slice(0, 8);
  const syntheticUserCount = 12;
  const days = 365;
  const baseDate = new Date('2025-11-03T00:00:00.000Z');
  const farFuture = new Date('2099-01-01T00:00:00.000Z');
  const userIds = Array.from({ length: syntheticUserCount }, (_, index) =>
    new ObjectId(`${runPrefix}${(index + 1).toString(16).padStart(16, '0')}`)
  );
  const attemptId = (counter) => `${runPrefix}-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;

  // Fixed distribution: 12 synthetic users x 365 daily documents, 1-5 attempts
  // per day, with no real URLs, accounts, or user data.
  const dailyRows = [];
  let attemptCounter = 1;
  for (let userIndex = 0; userIndex < syntheticUserCount; userIndex += 1) {
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const day = new Date(baseDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      const localDate = day.toISOString().slice(0, 10);
      const attemptCount = 1 + ((userIndex + dayIndex) % 5);
      const attempts = [];
      for (let attemptIndex = 0; attemptIndex < attemptCount; attemptIndex += 1) {
        const receivedAt = new Date(day.getTime() + attemptIndex * 60 * 60 * 1000 + userIndex * 1000);
        const id = attemptId(attemptCounter++);
        attempts.push({
          attemptId: id,
          receivedAt,
          updatedAt: receivedAt,
          processingStatus: 'completed',
          inputDigest: attemptCounter.toString(16).padStart(64, '0'),
          inputSizeBytes: 48,
          job: { state: 'completed', attemptCount: 1, availableAt: receivedAt },
          analysis: {
            verdict: ['peligroso', 'sospechoso', 'sin_amenazas_detectadas'][attemptCounter % 3],
            reasons: ['Synthetic explain fixture'],
            signals: ['synthetic_fixture']
          }
        });
      }
      dailyRows.push({
        _id: new ObjectId(),
        schemaVersion: 1,
        userId: userIds[userIndex],
        localDate,
        attempts,
        purgeAt: farFuture,
        historyPurgeAt: farFuture
      });
    }
  }
  if (daily.countDocuments({ 'attempts.attemptId': new RegExp(`^${runPrefix}-`) }) > 0) {
    throw new Error('Synthetic attempt ID prefix collision; refusing to seed duplicate fixtures.');
  }
  for (let offset = 0; offset < dailyRows.length; offset += 500) {
    daily.insertMany(dailyRows.slice(offset, offset + 500), { ordered: true });
  }

  const eventTypes = ['analysis.accepted', 'analysis.completed', 'auth.login.succeeded', 'admin.audit.read'];
  const auditRows = [];
  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const occurredAt = new Date(baseDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
    for (let eventIndex = 0; eventIndex < eventTypes.length; eventIndex += 1) {
      auditRows.push({
        _id: new ObjectId(),
        schemaVersion: 1,
        occurredAt: new Date(occurredAt.getTime() + eventIndex * 1000),
        purgeAt: farFuture,
        eventType: eventTypes[eventIndex],
        resourceType: 'synthetic-explain-fixture',
        resourceId: `${runPrefix}-${dayIndex}-${eventIndex}`
      });
    }
  }
  for (let offset = 0; offset < auditRows.length; offset += 500) {
    audit.insertMany(auditRows.slice(offset, offset + 500), { ordered: true });
  }

  function summarizeExplain(pattern, explain) {
    let cursorStage;
    const explainStages = explain.stages || [];
    for (let index = 0; index < explainStages.length; index += 1) {
      if (explainStages[index].$cursor) {
        cursorStage = explainStages[index].$cursor;
        break;
      }
    }
    const planner = explain.queryPlanner || (cursorStage && cursorStage.queryPlanner) || {};
    const execution = explain.executionStats || (cursorStage && cursorStage.executionStats) || {};

    function collectExecutionStages(node, output = []) {
      if (node === null || typeof node !== 'object') return output;
      if (typeof node.stage === 'string') {
        output.push({ stage: node.stage, indexName: node.indexName });
      }
      for (const child of Object.values(node)) collectExecutionStages(child, output);
      return output;
    }

    const pipelineStages = [];
    const rawPipelineStages = explain.stages || [];
    for (let index = 0; index < rawPipelineStages.length; index += 1) {
      const stage = rawPipelineStages[index];
      if (stage.$cursor) continue;
      const keys = Object.keys(stage);
      const name = keys.length > 0 ? keys[0] : 'unknown';
      const detail = stage[name];
      const stats = detail && typeof detail === 'object' ? detail : {};
      pipelineStages.push({
        stage: name,
        nReturned: stats.nReturned,
        executionTimeMillisEstimate: stats.executionTimeMillisEstimate,
        usedDisk: stats.usedDisk,
        spills: stats.spills,
        spilledDataStorageSize: stats.spilledDataStorageSize,
        totalDataSizeSorted: stats.totalDataSizeSorted
      });
    }

    const lastPipelineStage = pipelineStages.length > 0 ? pipelineStages[pipelineStages.length - 1] : undefined;
    const sortOrSpillStages = [];
    for (const stage of pipelineStages) {
      if (stage.stage.toLowerCase().includes('sort') || stage.usedDisk !== undefined || stage.spills !== undefined) {
        sortOrSpillStages.push(stage);
      }
    }

    return {
      pattern,
      winningPlan: planner.winningPlan,
      winningExecutionStages: collectExecutionStages(execution.executionStages || {}),
      pipelineStages,
      keysExamined: execution.totalKeysExamined,
      docsExamined: execution.totalDocsExamined,
      cursorRowsReturned: execution.nReturned,
      executionTimeMillis: execution.executionTimeMillis,
      pipelineRowsReturned: lastPipelineStage && lastPipelineStage.nReturned,
      sortOrSpillStages
    };
  }

  function explainFind(pattern, collectionName, filter, sort, limit) {
    const command = {
      find: collectionName,
      filter,
      limit
    };
    if (Object.keys(sort).length > 0) command.sort = sort;
    return summarizeExplain(pattern, db.runCommand({ explain: command, verbosity: 'executionStats' }));
  }

  function explainAggregate(pattern, collectionName, pipeline) {
    const command = { aggregate: collectionName, pipeline, cursor: {} };
    return summarizeExplain(pattern, db.runCommand({ explain: command, verbosity: 'executionStats' }));
  }

  const now = new Date();
  const start = new Date(baseDate.getTime() + 180 * 24 * 60 * 60 * 1000);
  const end = new Date(baseDate.getTime() + 364 * 24 * 60 * 60 * 1000 + 86399999);
  const targetUser = userIds[0];
  const targetDate = new Date(baseDate.getTime() + 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const targetAttempt = dailyRows[300].attempts[0].attemptId;
  const targetAttemptReceivedAt = dailyRows[300].attempts[0].receivedAt;
  const results = [];

  // P4: the current repository's first-page shape (match, unwind, project,
  // sort, limit); an index on parent documents does not guarantee post-unwind sort.
  const historyProjection = {
    localDate: 1,
    attemptId: '$attempts.attemptId',
    receivedAt: '$attempts.receivedAt',
    updatedAt: '$attempts.updatedAt',
    completedAt: '$attempts.completedAt',
    processingStatus: '$attempts.processingStatus',
    submittedInput: '$attempts.submittedInput',
    inputDigest: '$attempts.inputDigest',
    inputSizeBytes: '$attempts.inputSizeBytes',
    analysis: '$attempts.analysis'
  };
  results.push(explainAggregate('P4-history-first-page', 'daily_analyses', [
    { $match: { userId: targetUser, purgeAt: { $gt: now } } },
    { $unwind: '$attempts' },
    { $project: historyProjection },
    { $sort: { localDate: -1, receivedAt: -1, attemptId: -1 } },
    { $limit: 21 }
  ]));
  results.push(explainAggregate('P4-history-next-page', 'daily_analyses', [
    { $match: { userId: targetUser, purgeAt: { $gt: now } } },
    { $unwind: '$attempts' },
    { $project: historyProjection },
    { $sort: { localDate: -1, receivedAt: -1, attemptId: -1 } },
    { $match: { $or: [
      { localDate: { $lt: targetDate } },
      { localDate: targetDate, receivedAt: { $lt: targetAttemptReceivedAt } },
      { localDate: targetDate, receivedAt: targetAttemptReceivedAt, attemptId: { $lt: targetAttempt } }
    ] } },
    { $limit: 21 }
  ]));

  // P5a own detail and P5b global/admin lookup match repository predicates.
  results.push(explainFind('P5a-own-detail', 'daily_analyses', {
    userId: targetUser, localDate: targetDate, 'attempts.attemptId': targetAttempt
  }, {}, 1));
  results.push(explainFind('P5b-global-detail', 'daily_analyses', {
    'attempts.attemptId': targetAttempt
  }, {}, 1));

  // A1/A2 match the actual audit repository's range, effective-retention filter,
  // sort and page limit. The API converts dates to UTC day boundaries.
  results.push(explainFind('A1-audit-range', 'security_audit_events', {
    occurredAt: { $gte: start, $lte: end }, purgeAt: { $gt: now }
  }, { occurredAt: -1, _id: -1 }, 51));
  results.push(explainFind('A2-audit-range-and-type', 'security_audit_events', {
    occurredAt: { $gte: start, $lte: end }, purgeAt: { $gt: now }, eventType: 'analysis.completed'
  }, { occurredAt: -1, _id: -1 }, 51));

  // A3 uses the current MongoDailyAnalysisRepository.getMetrics pipeline.
  results.push(explainAggregate('A3-daily-analysis-metrics', 'daily_analyses', [
    { $match: { localDate: { $gte: start.toISOString().slice(0, 10), $lte: end.toISOString().slice(0, 10) } } },
    { $unwind: '$attempts' },
    { $group: {
      _id: null,
      totalAttempts: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'completed'] }, 1, 0] } },
      peligroso: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'peligroso'] }, 1, 0] } },
      sospechoso: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'sospechoso'] }, 1, 0] } },
      sin_amenazas_detectadas: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'sin_amenazas_detectadas'] }, 1, 0] } }
    } }
  ]));

  print(JSON.stringify({
    suite: 'mongodb-explain-tests',
    database: databaseName,
    version,
    synthetic: {
      runPrefix,
      dailyDocuments: dailyRows.length,
      attempts: attemptCounter - 1,
      auditEvents: auditRows.length,
      users: syntheticUserCount,
      days,
      note: 'Synthetic fixture; no production data, indexes unchanged. Results are evidence, not an index/performance approval.'
    },
    explains: results
  }, null, 2));
})();
