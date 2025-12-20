
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db");
  console.log("Running title migration...");
  try {
      // 1. Copy title to user_filename where user_filename is NULL
      await db.execute(sql`
        UPDATE images
        SET user_filename = title
        WHERE user_filename IS NULL AND title IS NOT NULL
      `);

      // 2. Clear title
      await db.execute(sql`
        UPDATE images
        SET title = NULL
      `);

      console.log("Title migration done.");
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
