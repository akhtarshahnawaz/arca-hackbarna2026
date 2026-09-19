
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { TelegramProvider } from '@mastra/telegram';
import { weatherWorkflow } from './workflows/weather-workflow';
import { arcaAgent } from './agents/arca-agent';
import { weatherAgent } from './agents/weather-agent';
import { connectTelegramIfConfigured } from './telegram';

export const telegram = new TelegramProvider({
  mode: 'polling',
  toolDisplay: 'cards',
  commands: [
    { command: 'start', description: 'Who ARCA is and who you are talking to' },
    { command: 'briefing', description: 'Demo fire, simulation, ranked call list' },
    { command: 'help', description: 'Coordinator vs resident commands' },
  ],
});

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { arcaAgent, weatherAgent },
  channels: { telegram },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      // Uses a hosted database when deployed (mastra env db create --kind turso),
      // and a local file during development.
      url: process.env.TURSO_DATABASE_URL || "file:./mastra.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});

await connectTelegramIfConfigured(telegram);
