import { MongoClient, Db } from 'mongodb';

export class MongoDbConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(
    private readonly uri: string,
    private readonly dbName: string
  ) {}

  public async connect(): Promise<Db> {
    if (this.db) {
      return this.db;
    }

    this.client = new MongoClient(this.uri, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000
    });

    await this.client.connect();
    this.db = this.client.db(this.dbName);
    return this.db;
  }

  public getDatabase(): Db {
    if (!this.db) {
      throw new Error('Database connection has not been initialized. Call connect() first.');
    }
    return this.db;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
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
