import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const seedUsers = [
  { name: "Admin User", email: "admin@example.com", role: "admin" as const },
  { name: "Alice", email: "alice@example.com", role: "user" as const },
  { name: "Bob", email: "bob@example.com", role: "user" as const },
];

async function main() {
  console.log("Seeding database...");

  for (const user of seedUsers) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values(user);
      console.log(`  Created: ${user.email} (${user.role})`);
    } else {
      console.log(`  Skipped: ${user.email} (already exists)`);
    }
  }

  console.log("Seeding complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
