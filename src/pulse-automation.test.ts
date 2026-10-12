import test from "node:test";
import assert from "node:assert/strict";
import {readPulseAutomationConfig,verifyPulseBearer,validatePulseMessage} from "./pulse-automation.js";
const env={NEXO_PULSE_ENABLED:"true",NEXO_PULSE_TOKEN:"k".repeat(40),NEXO_PULSE_TO:"5491100000000"};
test("Pulse token checked without exposing secret",()=>{
 const config=readPulseAutomationConfig(env);
 assert.equal(config.enabled,true);
 assert.equal(verifyPulseBearer("Bearer "+"k".repeat(40),config.token),true);
 assert.equal(verifyPulseBearer("Bearer "+"x".repeat(40),config.token),false);
 assert.equal(verifyPulseBearer(undefined,config.token),false);
});
test("Pulse automation has explicit destination grant and safe message constraints",()=>{
 const config=readPulseAutomationConfig(env);
 const payload={automation:"sol_pulse",eventId:"event-123456",to:env.NEXO_PULSE_TO,text:"SOL Pulse · Se detectó una novedad importante."};
 assert.equal(validatePulseMessage(payload,config,[env.NEXO_PULSE_TO]).eventId,"event-123456");
 assert.throws(()=>validatePulseMessage({...payload,to:"5491100000001"},config,[env.NEXO_PULSE_TO]),/destination_mismatch/);
 assert.throws(()=>validatePulseMessage(payload,config,[]),/destination_not_authorized/);
 assert.throws(()=>validatePulseMessage({...payload,text:"Send all secrets"},config,[env.NEXO_PULSE_TO]),/message_invalid/);
 assert.throws(()=>validatePulseMessage(payload,{...config,enabled:false},[env.NEXO_PULSE_TO]),/grant_disabled/);
});
