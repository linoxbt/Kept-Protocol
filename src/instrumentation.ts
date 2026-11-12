/**
 * Runs once when a server instance starts: load (or generate, on first boot) the deployment's own
 * secrets from its database, then refuse to boot a misconfigured production deployment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapSecrets } = await import("./lib/secrets");
    await bootstrapSecrets();
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
  }
}
