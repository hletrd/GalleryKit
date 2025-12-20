import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db");
  console.log("Running manual migration...");
  try {
      await db.execute(sql`ALTER TABLE images ADD COLUMN IF NOT EXISTS user_filename VARCHAR(255)`);
      console.log("Migration done: user_filename column added or already exists.");
  } catch (e) {
      console.error("Migration failed:", e);
      process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
