import { getVoiceCall, updateVoiceCall } from "@/lib/db";
import { siteCallScript, synthesizeSpeech } from "@/lib/slng";
import { buildAnswerNcco, publicAudioUrl } from "@/lib/vonage";

export const dynamic = "force-dynamic";

async function nccoForCall(callId: string) {
  const call = await getVoiceCall(callId);
  let audioId = call?.audioId;
  let dtmfAudioId = call?.dtmfAudioId;
  if (!audioId) {
    const tts = await synthesizeSpeech(siteCallScript("Font-rubí"));
    audioId = tts.audioId;
    if (call) await updateVoiceCall(call.id, { audioId, status: "recording" });
  }
  return buildAnswerNcco({
    callId,
    streamUrl: publicAudioUrl(audioId),
    dtmfPromptUrl: dtmfAudioId ? publicAudioUrl(dtmfAudioId) : undefined,
  });
}

export async function GET(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "demo";
  return Response.json(await nccoForCall(callId));
}

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "demo";
  return Response.json(await nccoForCall(callId));
}
