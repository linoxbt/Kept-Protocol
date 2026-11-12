/** Runs once when a server instance starts: refuse to boot a misconfigured production deployment. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
  }
}
