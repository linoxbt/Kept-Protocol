/**
 * Runs once when a server instance starts: load (or generate, on first boot) the deployment's own
 * secrets from its database, then refuse to boot a misconfigured production deployment. While no
 * admin exists yet, print the one-time setup token to the server log (visible to the operator only).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapSecrets } = await import("./lib/secrets");
    await bootstrapSecrets();
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
    try {
      const { adminSetupOpen } = await import("./lib/auth");
      if (process.env.ADMIN_SETUP_TOKEN && (await adminSetupOpen())) {
        console.log(`[kept] admin setup is open: visit /admin/setup with setup token ${process.env.ADMIN_SETUP_TOKEN}`);
      }
    } catch {
      // The database may not be migrated yet; setup stays closed until it is.
    }
  }
}
