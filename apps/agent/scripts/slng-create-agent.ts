/**
 * Create the SLNG voice agent ARCA calls sites with. Run once.
 *
 * SLNG's prompt templating takes simple `{{name}}` placeholders only — no
 * conditionals. The exercise-mode warning is therefore written as an
 * instruction the model follows in both directions rather than a block that
 * appears or does not, and both directions are spelled out: announcing a drill
 * during a real fire and failing to announce one during a drill are each their
 * own kind of harm.
 *
 *   pnpm --filter @arca/agent slng:create-agent
 *
 * Prints the agent id to put in SLNG_AGENT_ID. Safe to re-run: it creates a new
 * agent rather than mutating one, so an agent mid-incident is never altered
 * underneath a call that is already in progress.
 */

import { env } from "../src/env.js";

const SYSTEM_PROMPT = `Eres el asistente de voz del centro de coordinación de emergencias.

SIMULACRO: {{exercise_mode}}

Si ese valor es "true", esto es un simulacro. Dilo con esa palabra en la primera frase, antes de cualquier otra cosa, y repítelo si la persona parece creer que es real. Si es "false", no menciones la palabra simulacro en ningún momento.

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
    /**
     * Required since SLNG's v2 agent config, and refused if left out.
     *
     * "legacy" rather than "shared" because this agent has no tools at all: it
     * reads a script, asks four questions, and hangs up. Everything it needs
     * arrives as a runtime variable, and everything it learns comes back in the
     * transcript for ARCA to extract. A voice agent that could call tools is a
     * voice agent that could take an action nobody approved.
     */
    tool_mode: "legacy",
    system_prompt: SYSTEM_PROMPT,
    greeting:
      "Hola, le llamo de forma automática de parte del centro de coordinación de emergencias. ¿Hablo con {{site_name}}?",
    enable_interruptions: true,
    /**
     * Listen, think, speak.
     *
     * The llm name is the one SLNG's own agent documentation uses; model ids
     * here are not the same namespace as their transcription API and a wrong
     * one is refused at create time with "not available for agents", which is
     * at least a loud failure. Override any of these from the environment if
     * the catalogue moves under you: docs.slng.ai/models/catalog/all-models.
     */
    models: {
      stt: process.env.SLNG_STT_MODEL ?? "soniox/speech-ai:rt-v5",
      llm: process.env.SLNG_LLM_MODEL ?? "bedrock-mantle/nvidia.nemotron-super-3-120b:latest",
      tts: process.env.SLNG_TTS_MODEL ?? "slng/fish/tts:s2.1-pro",
      // Carmen, a Spanish Fish Audio voice. The voice must match `language` or
      // creation is refused — the ids in SLNG's own API examples are English
      // ones, which is a confusing way to find that out. Spanish voices are
      // listed at docs.slng.ai/models/voices/fish-audio.
      tts_voice: process.env.SLNG_TTS_VOICE ?? "3f065d660212478a9c697fa965b4d098",
      /**
       * SLNG defaults this to 1. This agent reads a fixed script and asks four
       * fixed questions to someone who may be about to evacuate; variety is
       * not a feature here, and a model that improvises an instruction is the
       * specific failure this whole design exists to prevent.
       */
      llm_kwargs: { temperature: 0.3 },
    },
    /**
     * No `runtime_variables` block.
     *
     * SLNG v2 derives the variable list from the `{{placeholders}}` in the
     * prompt and the greeting, and refuses a config that also declares them —
     * "must not conflict with personalization variables". The seven ARCA passes
     * are all declared by being used.
     */
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

    // The two failures worth naming, because neither error text says where to
    // look and both cost an afternoon otherwise.
    const text = JSON.stringify(payload ?? "");
    if (/AGENT_VOICE_UNAVAILABLE|tts_voice/.test(text)) {
      console.error(
        "\nThe voice must belong to the TTS model *and* match the language.\n" +
          `Spanish voices for the current model: https://docs.slng.ai/models/voices/fish-audio\n` +
          "Then: SLNG_TTS_VOICE=<id> pnpm --filter @arca/agent slng:create-agent",
      );
    }
    if (/not available for agents|models\.llm/.test(text)) {
      console.error(
        "\nAgent model ids are a different namespace from the transcription API.\n" +
          "Catalogue: https://docs.slng.ai/models/catalog/all-models\n" +
          "Then: SLNG_LLM_MODEL=<id> pnpm --filter @arca/agent slng:create-agent",
      );
    }
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
