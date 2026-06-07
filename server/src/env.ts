import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env regardless of where the process is launched from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnv });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  tz: process.env.APP_TZ ?? "Asia/Kolkata",
  // Directory of face photos synced by HikCentral, named "<name>+_<emp_id>.jpg".
  // Served by /faces/:id. Empty = no on-disk photos (falls back to inline bytea).
  facesDir: process.env.FACES_DIR ?? "",
  // Signing key for session tokens. Falls back to a dev key — set a strong
  // value in .env for any non-local deployment.
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-canteen-secret-change-me",
  // Bootstrap credentials for the one-and-only super admin (healed on boot).
  superAdminUser: process.env.SUPER_ADMIN_USER ?? "ambuj.kumar@ddecor.com",
  superAdminName: process.env.SUPER_ADMIN_NAME ?? "Ambuj Kumar",
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? "Admin@123$",
};
