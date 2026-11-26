// WebSocket transport. JSON messages are envelopes {t, d}; binary frames are chunks.
// Every server message is re-emitted on the bus as `net:<t>` with its payload d;
// binary chunk frames are emitted as `net:chunk` with the ArrayBuffer.
export function createNet(bus) {
  let ws = null;
  let open = false;
  const queue = [];
  const net = {
    connected: false,
    /** Connect to the game server. Resolves once the socket is open. */
    connect(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          open = true; net.connected = true;
          for (const m of queue.splice(0)) ws.send(m);
          bus.emit('net:open');
          resolve();
        };
        ws.onerror = (e) => { if (!open) reject(new Error('Could not reach the Wildcall server')); };
        ws.onclose = () => { open = false; net.connected = false; bus.emit('net:close'); };
        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') { bus.emit('net:chunk', ev.data); return; }
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          bus.emit('net:' + msg.t, msg.d ?? {});
        };
      });
    },
    /** Send a message, e.g. net.send('pose', {...}). Queued until the socket opens. */
    send(t, d = {}) {
      const m = JSON.stringify({ t, d });
      if (open) ws.send(m); else queue.push(m);
    },
    /** Convenience: subscribe to a server message type. */
    on(t, fn) { return bus.on('net:' + t, fn); },
  };
  return net;
}
