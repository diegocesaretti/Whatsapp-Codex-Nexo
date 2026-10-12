import { timingSafeEqual } from "node:crypto";

export interface PulseAutomationConfig {
 enabled: boolean;
 token: string;
 destination: string;
}
export interface PulseAutomationMessage {
 automation: "sol_pulse";
 eventId: string;
 text: string;
 to: string;
}
export function readPulseAutomationConfig(env: NodeJS.ProcessEnv=process.env):PulseAutomationConfig {
 return {
  enabled:env.NEXO_PULSE_ENABLED==="true",
  token:String(env.NEXO_PULSE_TOKEN||"").trim(),
  destination:String(env.NEXO_PULSE_TO||"").trim(),
 };
}
export function verifyPulseBearer(header:string|undefined, expected:string):boolean {
 if(expected.length<32)return false;
 const raw=header?.match(/^Bearer\s+(\S+)$/i)?.[1]||"";
 const a=Buffer.from(raw,"utf8"),b=Buffer.from(expected,"utf8");
 return a.length===b.length && timingSafeEqual(a,b);
}
export function validatePulseMessage(body:unknown, config:PulseAutomationConfig,authorizedNumbers:string[]):PulseAutomationMessage {
 if(!config.enabled)throw new Error("pulse_grant_disabled");
 if(!/^[1-9]\d{9,14}$/.test(config.destination)||!authorizedNumbers.includes(config.destination))throw new Error("pulse_destination_not_authorized");
 if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("pulse_payload_invalid");
 const candidate=body as Record<string,unknown>;
 if(candidate.automation!=="sol_pulse")throw new Error("pulse_automation_invalid");
 const eventId=typeof candidate.eventId==="string"?candidate.eventId:"";
 const text=typeof candidate.text==="string"?candidate.text.trim():"";
 if(!/^[a-zA-Z0-9_.:-]{8,100}$/.test(eventId))throw new Error("pulse_event_id_invalid");
 if(!text.startsWith("SOL Pulse")||text.length>1200||text.length<18)throw new Error("pulse_message_invalid");
 if(candidate.to!==config.destination)throw new Error("pulse_destination_mismatch");
 return {automation:"sol_pulse",eventId,text,to:config.destination};
}
