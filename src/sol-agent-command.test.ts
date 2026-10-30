import test from "node:test";
import assert from "node:assert/strict";
import { parseSolAgentCommand, permittedSolAgentOwner, handleSolAgentWhatsAppCommand, formatSolAgentResult } from "./sol-agent-command.js";
import type { AppSettings } from "./settings.js";

const phone="5491112345678";
const settings={
 outputConversation:{
  enabled:true, authorizedNumbers:[phone],maxContextMessages:50,
  identities:[{
   id:"owner-test",displayName:"Owner",nickname:"",role:"owner" as const,
   phoneNumbers:[phone],linkedInputAccountIds:[],codexConversationEnabled:true,source:"manual" as const
  }]
 }
} as Pick<AppSettings,"outputConversation">;
const env={ NEXO_SOL_AGENT_COMMANDS_ENABLED:"true", NEXO_SOL_AGENT_OWNER_PHONE:phone };

test("only exact /agente commands are recognized; no free-form prompt injection",()=>{
 assert.equal(parseSolAgentCommand("quiero crear una misión"),null);
 assert.equal(parseSolAgentCommand("/agente misiones")?.name,"sol_agent_missions");
 assert.equal(parseSolAgentCommand("/agente propuestas")?.name,"sol_agent_proposals");
 assert.deepEqual(parseSolAgentCommand("/agente crear negocio Revisar las impresoras con problemas"),{
  name:"sol_agent_goal_create",args:{objective:"Revisar las impresoras con problemas",profile:"business"}
 });
 assert.deepEqual(parseSolAgentCommand("/agente pausar printers-one"),{name:"sol_agent_goal_pause",args:{id:"printers-one",paused:true}});
 assert.deepEqual(parseSolAgentCommand("/agente reanudar printers-one"),{name:"sol_agent_goal_pause",args:{id:"printers-one",paused:false}});
 assert.throws(()=>parseSolAgentCommand("/agente borrar todo"),/not_recognized/);
 assert.throws(()=>parseSolAgentCommand("/agente crear negocio x"),/objective_invalid/);
});

test("requires admin enabled, explicit fixed owner phone, identity and active conversation",()=>{
 assert.equal(permittedSolAgentOwner(phone,settings,env),true);
 assert.equal(permittedSolAgentOwner("5491177778888",settings,env),false);
 assert.equal(permittedSolAgentOwner(phone,settings,{...env,NEXO_SOL_AGENT_COMMANDS_ENABLED:"false"}),false);
 assert.equal(permittedSolAgentOwner(phone,settings,{...env,NEXO_SOL_AGENT_OWNER_PHONE:""}),false);
 const wrong={outputConversation:{...settings.outputConversation,identities:[{...settings.outputConversation.identities[0]!,role:"member" as const}]}};
 assert.equal(permittedSolAgentOwner(phone,wrong,env),false);
 const disabled={outputConversation:{...settings.outputConversation,enabled:false}};
 assert.equal(permittedSolAgentOwner(phone,disabled,env),false);
});

test("authorized command dispatches to its exact tool, never arbitrary model tool",async()=>{
 const invocations:any[]=[];
 const reply=await handleSolAgentWhatsAppCommand({
  text:"/agente crear hogar Revisar si el aire de cocina sigue sin responder",
  peerPhone:phone,settings,env,invoke:async(name,args)=>{
   invocations.push({name,args});
   return {ok:true,id:"mission-test",status:"ready"};
  }
 });
 assert.match(reply||"",/Misión creada/);
 assert.equal(invocations.length,1);
 assert.equal(invocations[0].name,"sol_agent_goal_create");
 assert.equal(invocations[0].args.profile,"home");
});

test("unauthorized command never reaches RPC and opaque Core errors never leak tokens",async()=>{
 let sent=0;
 const forbidden=await handleSolAgentWhatsAppCommand({text:"/agente pausar test-one",
  peerPhone:"5491111000000",settings,env,invoke:async()=>{sent++;return {ok:true};}});
 assert.match(forbidden||"",/no está habilitada/);
 assert.equal(sent,0);
 const failed=await handleSolAgentWhatsAppCommand({text:"/agente misiones",
  peerPhone:phone,settings,env,invoke:async()=>{throw Error("Bearer supersecret-token");}});
 assert.match(failed||"",/No pude consultar/);
 assert.doesNotMatch(failed||"",/supersecret/);
});

test("read-only status and proposals produce compact WhatsApp output",()=>{
 assert.match(formatSolAgentResult({name:"sol_agent_missions",args:{}},{
  missions:[{id:"mission-one",objective:"Investigate printer backlog",dueAt:"2026-10-31T14:00:00Z",paused:true}]
 }),/pausada/);
 assert.match(formatSolAgentResult({name:"sol_agent_proposals",args:{}},{
  proposals:[{title:"Revisar inventario",priority:"high"}]
 }),/Revisar inventario/);
});
