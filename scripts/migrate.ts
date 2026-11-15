/** Applies SQL migrations (see src/db/migrate.ts). Usage: npm run db:migrate */
import { migrate } from "../src/db/migrate";

export { migrate };

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
