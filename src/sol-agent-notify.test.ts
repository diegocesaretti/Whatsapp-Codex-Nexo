import test from "node:test";
import assert from "node:assert/strict";
import { checkSolAgentNotification } from "./sol-agent-notify.js";
import type { AppSettings } from "./settings.js";

const owner="5491112345678";
const settings={
  outputConversation:{enabled:true,authorizedNumbers:[owner],maxContextMessages:20,
    identities:[{id:"owner",displayName:"Owner",nickname:"",role:"owner" as const,
      phoneNumbers:[owner],linkedInputAccountIds:[],codexConversationEnabled:true,source:"manual" as const}]}
} as Pick<AppSettings,"outputConversation">;
const env={
 NEXO_SOL_AGENT_NOTIFY_ENABLED:"true",
 NEXO_SOL_AGENT_NOTIFY_TOKEN:"test-notify-token-with-minimum-32-bytes",
 NEXO_SOL_AGENT_OWNER_PHONE:owner
};
const body={missionId:"fleet-watch",proposalId:"123e4567-e89b-12d3-a456-426614174000",
 priority:"high",text:"La impresora necesita una verificación manual por una falla persistente."};
const date=new Date("2026-10-29T15:10:00.000Z");

test("a fixed owner-only recipient and one daily reason are derived at Nexo",()=>{
 const x=checkSolAgentNotification({env,settings,body,token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date});
 assert.equal(x.to,owner);
 assert.equal(x.reason,"automation:sol-agent:2026-10-29");
 assert.match(x.text,/fleet-watch/);
 assert.equal("to" in body,false);
});
test("opt-in and dedicated secret are required; Morning Brief key is never accepted",()=>{
 assert.throws(()=>checkSolAgentNotification({env:{...env,NEXO_SOL_AGENT_NOTIFY_ENABLED:"false"},settings,body,token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/disabled/);
 assert.throws(()=>checkSolAgentNotification({env,settings,body,token:"morning-brief-token",now:date}),/unauthorized/);
 assert.throws(()=>checkSolAgentNotification({env,settings,body,token:"",now:date}),/unauthorized/);
});
test("recipient must remain the explicitly authorized owner; no arbitrary to parameter",()=>{
 assert.throws(()=>checkSolAgentNotification({env,settings,body:{...body,to:"5491199887766"},token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/unexpected_field/);
 const other={outputConversation:{...settings.outputConversation,authorizedNumbers:[]}};
 assert.throws(()=>checkSolAgentNotification({env,settings:other,body,token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/recipient_not_authorized/);
 const wrong={outputConversation:{...settings.outputConversation,identities:[{...settings.outputConversation.identities[0]!,role:"member" as const}]}};
 assert.throws(()=>checkSolAgentNotification({env,settings:wrong,body,token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/recipient_not_authorized/);
});
test("fixed local quiet hours and high-priority-only guard",()=>{
 for(const time of ["2026-10-29T04:00:00Z","2026-10-30T01:00:00Z"]){
   assert.throws(()=>checkSolAgentNotification({env,settings,body,token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:new Date(time)}),/quiet_hours/);
 }
 assert.throws(()=>checkSolAgentNotification({env,settings,body:{...body,priority:"medium"},token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/priority_not_high/);
});
test("hard content limits, mission IDs and proposals reject invalid notifications",()=>{
 assert.throws(()=>checkSolAgentNotification({env,settings,body:{...body,text:"a".repeat(901)},token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/text_invalid/);
 assert.throws(()=>checkSolAgentNotification({env,settings,body:{...body,proposalId:"bad"},token:env.NEXO_SOL_AGENT_NOTIFY_TOKEN,now:date}),/ids_invalid/);
});
