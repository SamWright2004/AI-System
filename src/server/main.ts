import { createApp } from "./app.js";
import { config } from "../shared/config.js";

const app = await createApp(config);

async function shutDown(signal: string) {
  app.log.info({ signal }, "Stopping local service");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutDown("SIGINT"));
process.once("SIGTERM", () => void shutDown("SIGTERM"));

try {
  await app.listen({ host: config.apiHost, port: config.apiPort });
  app.log.info(
    { host: config.apiHost, port: config.apiPort, provider: config.aiProvider },
    "Personal AI service is ready",
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
