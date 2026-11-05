import { MongoClient, Db } from 'mongodb';

export class MongoDbConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connected = false;

  constructor(
    private readonly uri: string,
    private readonly dbName: string
  ) {}

  public async connect(): Promise<Db> {
    if (this.connected && this.db) {
      return this.db;
    }

    if (!this.client) {
      this.client = new MongoClient(this.uri, {
        maxPoolSize: 20,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000
      });
      this.db = this.client.db(this.dbName);
    }

    const client = this.client;
    if (!client) throw new Error('MongoDB client was not initialized.');
    await client.connect();
    this.connected = true;
    return this.db ?? client.db(this.dbName);
  }

  public getDatabase(): Db {
    if (this.db) return this.db;
    if (this.client) return this.client.db(this.dbName);
    throw new Error('Database connection has not been initialized. Call connect() first.');
  }

  public getClient(): MongoClient {
    if (!this.client) throw new Error('MongoDB client has not been initialized. Call connect() first.');
    return this.client;
  }

  public async assertReplicaSetReady(): Promise<void> {
    if (!this.db) throw new Error('MongoDB database has not been initialized.');
    const hello = await this.db.admin().command({ hello: 1 });
    if (typeof hello['setName'] !== 'string' || hello['isWritablePrimary'] !== true) {
      throw new Error('MongoDB must be a writable replica-set primary to support transactional analysis capacity.');
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connected = false;
    }
  }

  public async ping(): Promise<boolean> {
    try {
      if (!this.db) {
        return false;
      }
      const adminDb = this.db.admin();
      const result = await adminDb.ping();
      return result.ok === 1;
    } catch {
      return false;
    }
  }
}
