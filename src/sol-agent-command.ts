import { normalizePhoneNumber } from "./output-conversation-auth.js";
import type { AppSettings } from "./settings.js";

export type SolAgentCommand = {
  name: "sol_agent_missions" | "sol_agent_proposals" | "sol_agent_goal_create" |
        "sol_agent_goal_pause" | "sol_agent_goal_wake" | "sol_agent_feedback";
  args: Record<string, unknown>;
};
const missionId = /^[a-z][a-z0-9_-]{2,39}$/;
const proposalId = /^[0-9a-f-]{20,80}$/i;

export function parseSolAgentCommand(value: string): SolAgentCommand | null {
  const text = value.trim();
  if (!/^\/agente(?:\s|$)/i.test(text)) return null;
  const parts = text.match(/^\/agente(?:\s+(.+))?$/is);
  const command = (parts?.[1] || "").trim();
  if (/^(estado|misiones|ayuda)?$/i.test(command)) return { name: "sol_agent_missions", args: {} };
  if (/^propuestas$/i.test(command)) return { name:"sol_agent_proposals", args:{limit:10} };
  const create = command.match(/^crear\s+(hogar|negocio|general)\s+([\s\S]+)$/i);
  if (create) {
    const objective = create[2]!.trim();
    if (objective.length < 12 || objective.length > 800 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(objective)) throw new Error("agent_objective_invalid");
    return { name:"sol_agent_goal_create",
      args:{objective,profile:({hogar:"home",negocio:"business",general:"general"} as Record<string,string>)[create[1]!.toLowerCase()]}
    };
  }
  const state = command.match(/^(pausar|reanudar|despertar)\s+([a-z][a-z0-9_-]{2,39})$/i);
  if(state){
    const id=state[2]!.toLowerCase();
    if(!missionId.test(id))throw new Error("agent_mission_id_invalid");
    if(state[1]!.toLowerCase()==="despertar")return {name:"sol_agent_goal_wake",args:{id,reason:"Explicit WhatsApp owner command"}};
    return {name:"sol_agent_goal_pause",args:{id,paused:state[1]!.toLowerCase()==="pausar"}};
  }
  const feedback=command.match(/^evaluar\s+(\S+)\s+(\S+)\s+(util|útil|irrelevante|incorrecto)$/i);
  if(feedback){
    if(!missionId.test(feedback[1]!) || !proposalId.test(feedback[2]!))throw new Error("agent_feedback_id_invalid");
    const raw=feedback[3]!.toLowerCase();
    return {name:"sol_agent_feedback",args:{
      missionId:feedback[1],proposalId:feedback[2],
      rating:raw==="útil"||raw==="util"?"useful":raw==="irrelevante"?"irrelevant":"incorrect"
    }};
  }
  throw new Error("agent_command_not_recognized");
}

export function permittedSolAgentOwner(
  phone: string,
  settings: Pick<AppSettings,"outputConversation">,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if(env.NEXO_SOL_AGENT_COMMANDS_ENABLED !== "true") return false;
  const bound=normalizePhoneNumber(env.NEXO_SOL_AGENT_OWNER_PHONE);
  const peer=normalizePhoneNumber(phone);
  if(!peer||!bound||peer!==bound) return false;
  if(!settings.outputConversation.enabled || !settings.outputConversation.authorizedNumbers.includes(peer))return false;
  return settings.outputConversation.identities.some(identity=>
    identity.role==="owner" && identity.codexConversationEnabled && identity.phoneNumbers.includes(peer));
}

const help = "Comandos: /agente misiones, /agente propuestas, /agente crear hogar|negocio|general [objetivo], /agente pausar|reanudar|despertar [id] y /agente evaluar [misión] [propuesta] útil|irrelevante|incorrecto.";

export function formatSolAgentResult(command: SolAgentCommand, value: unknown): string {
  const x=value && typeof value==="object" ? value as Record<string,any>:{};
  if(command.name==="sol_agent_missions"){
    const missions=Array.isArray(x.missions)?x.missions.slice(0,8):[];
    if(!missions.length)return "No hay misiones registradas. "+help;
    return "Misiones SOL Agent:\n"+missions.map(m=>
      "• "+String(m.id||"").slice(0,45)+" — "+String(m.objective||"").slice(0,120)+
      (m.paused?" (pausada)":"")+", próxima revisión: "+String(m.dueAt||"pendiente").slice(0,25)
    ).join("\n");
  }
  if(command.name==="sol_agent_proposals"){
    const items=Array.isArray(x.proposals)?x.proposals.slice(0,6):[];
    return !items.length?"No hay propuestas pendientes.":("Propuestas para revisar:\n"+items.map(p=>
      "• "+String(p.title||"").slice(0,125)+" ["+String(p.priority||"normal").slice(0,10)+"]"
    ).join("\n"));
  }
  if(x.ok!==true)throw new Error("agent_command_invalid_response");
  if(command.name==="sol_agent_goal_create")return "Misión creada: "+String(x.id||"").slice(0,45)+". Se investigará de forma programada, sin realizar acciones externas.";
  if(command.name==="sol_agent_goal_pause")return x.paused?"Misión pausada.":"Misión reanudada.";
  if(command.name==="sol_agent_goal_wake")return x.queued?"Misión preparada para su próxima revisión.":"No se adelantó la misión ("+String(x.reason||"sin cambios").slice(0,60)+").";
  return "Tu evaluación se guardó para próximas revisiones.";
}

export async function handleSolAgentWhatsAppCommand(options:{
  text: string; peerPhone:string; settings: Pick<AppSettings,"outputConversation">;
  env?: NodeJS.ProcessEnv;
  invoke:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
}):Promise<string|null> {
  let command: SolAgentCommand|null;
  try{command=parseSolAgentCommand(options.text);}
  catch{return "No entendí el comando. "+help;}
  if(!command)return null;
  if(!permittedSolAgentOwner(options.peerPhone,options.settings,options.env))return "La gestión de SOL Agent por WhatsApp no está habilitada para este número.";
  try{
    const result=await options.invoke(command.name,command.args);
    return formatSolAgentResult(command,result);
  }catch{
    // Avoid echoing backend error bodies containing private data or tokens.
    return "No pude consultar SOL Agent. Comprobá que esté activo y que Nexo tenga el permiso de gestión de misiones.";
  }
}
