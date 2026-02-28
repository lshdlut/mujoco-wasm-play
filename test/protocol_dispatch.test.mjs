import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeCommand,
  decodeEvent,
  dispatchCommand,
  dispatchEvent,
  encodeCommand,
  encodeEvent,
} from '../dev/dispatch.gen.mjs';
import { COMMAND_FIELDS, EVENT_FIELDS, WORKER_COMMANDS, WORKER_EVENTS } from '../dev/protocol.gen.mjs';

function payloadWithRequiredFields(required) {
  const payload = {};
  for (const key of required || []) {
    payload[key] = 1;
  }
  return payload;
}

test('protocol: encodeCommand enforces required fields', () => {
  for (const cmd of WORKER_COMMANDS) {
    const required = COMMAND_FIELDS?.[cmd]?.required || [];
    const good = payloadWithRequiredFields(required);
    assert.doesNotThrow(() => encodeCommand(cmd, good));
    if (required.length) {
      assert.throws(() => encodeCommand(cmd, {}));
    }
  }
});

test('protocol: encodeEvent enforces required fields', () => {
  for (const kind of WORKER_EVENTS) {
    const required = EVENT_FIELDS?.[kind]?.required || [];
    const good = payloadWithRequiredFields(required);
    assert.doesNotThrow(() => encodeEvent(kind, good));
    if (required.length) {
      assert.throws(() => encodeEvent(kind, {}));
    }
  }
});

test('protocol: decodeCommand/decodeEvent strip discriminators', () => {
  const cmdMsg = encodeCommand('setRate', { rate: 2 });
  const decodedCmd = decodeCommand(cmdMsg);
  assert.equal(decodedCmd.cmd, 'setRate');
  assert.deepEqual(decodedCmd.payload, { rate: 2 });

  const eventMsg = encodeEvent('run_state', { running: true });
  const decodedEvt = decodeEvent(eventMsg);
  assert.equal(decodedEvt.kind, 'run_state');
  assert.deepEqual(decodedEvt.payload, { running: true });
});

test('protocol: dispatchCommand/dispatchEvent route to handlers', () => {
  const cmdMsg = encodeCommand('setSnapshotHz', { hz: 60 });
  const cmdHandlers = {
    setSnapshotHz(payload) {
      return payload.hz;
    },
  };
  assert.equal(dispatchCommand(cmdHandlers, cmdMsg), 60);

  const evtMsg = encodeEvent('log', { message: 'hi' });
  const evtHandlers = {
    log(payload) {
      return payload.message.toUpperCase();
    },
  };
  assert.equal(dispatchEvent(evtHandlers, evtMsg), 'HI');
});

