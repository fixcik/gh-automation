import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gh_automation';

// Create postgres client
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance
export const db = drizzle(queryClient, { schema });

// Export transaction type for repositories
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Graceful shutdown
export const closeDatabase = async () => {
  await queryClient.end();
};
