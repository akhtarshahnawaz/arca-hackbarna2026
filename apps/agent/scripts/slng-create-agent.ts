/**
 * Create the SLNG voice agent ARCA calls sites with. Run once.
 *
 *   pnpm --filter @arca/agent slng:create-agent
 *
 * Prints the agent id to put in SLNG_AGENT_ID. Safe to re-run: it creates a new
 * agent rather than mutating one, so an agent mid-incident is never altered
 * underneath a call that is already in progress.
 */

import { env } from "../src/env.js";

const SYSTEM_PROMPT = `Eres el asistente de voz del centro de coordinación de emergencias.

{{#if exercise_mode}}IMPORTANTE: esto es un SIMULACRO. Dilo en la primera frase y repítelo si la persona parece creer que es real.{{/if}}

Hay un incendio forestal que podría llegar a {{site_name}} ({{site_type}}) en unos {{fire_eta_minutes}} minutos. La recomendación actual del centro de coordinación es: {{recommended_action}}. En el registro oficial constan {{registered_people}} personas, pero eso es una capacidad registrada, no las personas presentes ahora.

Habla con calma, en frases cortas. No metas prisa a la persona ni dramatices.

Di la recomendación una vez, con claridad. Después haz exactamente estas cuatro preguntas, de una en una, esperando la respuesta:
1. ¿Cuántas personas hay ahí ahora mismo?
2. ¿Cuántas no pueden caminar sin ayuda?
3. ¿Qué vehículos tienen disponibles?
4. ¿Necesitan ayuda para evacuar?

Confirma cada cifra repitiéndola. Si la corrigen, quédate con la última que digan y confírmala.

No des consejos médicos. No improvises instrucciones que no estén en la recomendación. Si piden hablar con una persona, di que el coordinador les llamará y que el contacto es {{coordinator_callback}}.

Termina resumiendo la recomendación en una frase y despídete.`;

async function main(): Promise<void> {
  if (!env.slng.apiKey) {
    console.error("SLNG_API_KEY is not set.");
    process.exit(1);
  }

  const body = {
    schema_version: 2,
    name: "arca-site-check",
    language: "es",
    region: env.slng.region,
    system_prompt: SYSTEM_PROMPT,
    greeting:
      "Hola, le llamo de forma automática de parte del centro de coordinación de emergencias. ¿Hablo con {{site_name}}?",
    enable_interruptions: true,
    models: {
      stt: "soniox/speech-ai:rt-v5",
      llm: "groq/openai/gpt-oss-120b",
      tts: "slng/fish/tts:s2.1-pro",
      tts_voice: process.env.SLNG_TTS_VOICE ?? "",
    },
    runtime_variables: [
      { name: "site_name", description: "Nombre del centro" },
      { name: "site_type", description: "Tipo de centro" },
      { name: "fire_eta_minutes", description: "Minutos estimados hasta la llegada del fuego" },
      { name: "recommended_action", description: "Acción recomendada por el centro de coordinación" },
      { name: "registered_people", description: "Capacidad registrada, no ocupación real" },
      { name: "coordinator_callback", description: "Contacto del coordinador" },
      { name: "exercise_mode", description: "true si es un simulacro" },
    ],
  };

  const response = await fetch(`${env.slng.agentsUrl}/v1/agents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.slng.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;

  if (!response.ok) {
    console.error(`SLNG returned ${response.status}:`, JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log("Voice agent created.\n");
  console.log(`  SLNG_AGENT_ID=${payload?.id ?? "(no id returned)"}\n`);
  console.log("Add that to your environment. Then, before enabling CALL_ALLOWLIST,");
  console.log("test it in the browser with a web session — no phone number needed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
