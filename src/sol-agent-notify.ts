import { timingSafeEqual } from "node:crypto";
import { normalizePhoneNumber } from "./output-conversation-auth.js";
import type { AppSettings } from "./settings.js";

const mission = /^[a-z][a-z0-9_-]{2,39}$/;
const proposal = /^[0-9a-f-]{20,80}$/i;
const timeZone = "America/Argentina/Buenos_Aires";

function sameSecret(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || !actual) return false;
  const a = Buffer.from(actual,"utf8"), b=Buffer.from(expected,"utf8");
  return a.length===b.length && timingSafeEqual(a,b);
}
function nowParts(date: Date) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{
    timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return { day:parts.year+"-"+parts.month+"-"+parts.day, hour:Number(parts.hour) };
}
export function checkSolAgentNotification(input:{
  token: string | undefined; body: unknown;
  settings: Pick<AppSettings,"outputConversation">;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): {reason:string;to:string;text:string} {
  const env=input.env||process.env;
  if(env.NEXO_SOL_AGENT_NOTIFY_ENABLED!=="true")throw new Error("sol_agent_notify_disabled");
  if(!sameSecret(input.token,env.NEXO_SOL_AGENT_NOTIFY_TOKEN))throw new Error("sol_agent_notify_unauthorized");
  const to=normalizePhoneNumber(env.NEXO_SOL_AGENT_OWNER_PHONE);
  if(!to || !input.settings.outputConversation.enabled ||
    !input.settings.outputConversation.authorizedNumbers.includes(to) ||
    !input.settings.outputConversation.identities.some(i=>
      i.role==="owner" && i.codexConversationEnabled && i.phoneNumbers.includes(to)))
      throw new Error("sol_agent_notify_recipient_not_authorized");
  const body=input.body;
  if(!body || typeof body!=="object" || Array.isArray(body))throw new Error("sol_agent_notify_body_invalid");
  const b=body as Record<string,unknown>;
  if(Object.keys(b).some(k=>!["missionId","proposalId","text","priority"].includes(k)))
    throw new Error("sol_agent_notify_unexpected_field");
  if(typeof b.missionId!=="string"||!mission.test(b.missionId) ||
     typeof b.proposalId!=="string"||!proposal.test(b.proposalId))throw new Error("sol_agent_notify_ids_invalid");
  if(b.priority!=="high")throw new Error("sol_agent_notify_priority_not_high");
  if(typeof b.text!=="string"||b.text.trim().length<30||b.text.length>900)
    throw new Error("sol_agent_notify_text_invalid");
  const t=nowParts(input.now||new Date());
  if(t.hour<8||t.hour>=21)throw new Error("sol_agent_notify_quiet_hours");
  return {
    reason:"automation:sol-agent:"+t.day, // one outbound proactive notice per local day
    to, text:"SOL Agent · hallazgo importante\n"+b.text.trim()+"\n\nMisión: "+b.missionId
  };
}
