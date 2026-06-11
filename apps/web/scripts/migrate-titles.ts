
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { sql, isNotNull } from "drizzle-orm";

// SEC-R4C19-06: this is a LEGACY one-shot migration (title →
// user_filename) whose purpose completed long ago. Its second statement
// clears EVERY images.title — including titles admins have authored
// since. Running it today is an unrecoverable mass data-loss event, so
// it refuses to act without the explicit acknowledgement flag below.
const ACK_FLAG = "--i-understand-this-clears-all-titles";

async function main() {
  const { db, images } = await import("../src/db");

  if (!process.argv.includes(ACK_FLAG)) {
      const titled = await db.select({ id: images.id })
          .from(images)
          .where(isNotNull(images.title));
      console.error("[migrate-titles] REFUSING to run: this legacy one-shot migration");
      console.error("[migrate-titles] sets title = NULL for EVERY image after copying titles");
      console.error(`[migrate-titles] into user_filename. It would clear ${titled.length} existing title(s).`);
      console.error(`[migrate-titles] If you really mean it, re-run with ${ACK_FLAG}`);
      process.exit(1);
  }

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
