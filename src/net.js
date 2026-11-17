// Minimal WebSocket client for the voxel-world multiplayer server.
// Connects automatically; if the server is absent the game just runs solo.
export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.handlers = { state: [], block: [], player: [], leave: [] };
    this.retryT = 0;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this._scheduleRetry();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this._emit('state', true);
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'init') {
        this.id = msg.id;
        this.color = msg.color;
      } else if (msg.t === 'block') {
        this._emit('block', msg);
      } else if (msg.t === 'player') {
        this._emit('player', msg);
      } else if (msg.t === 'leave') {
        this._emit('leave', msg.id);
      }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this._emit('state', false);
      this._scheduleRetry();
    };
    this.ws.onerror = () => { try { this.ws.close(); } catch (e) {} };
  }

  _scheduleRetry() {
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => this._connect(), 4000);
  }

  send(obj) {
    if (!this.connected || !this.ws) return;
    try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  onState(fn) { this.handlers.state.push(fn); }
  onBlock(fn) { this.handlers.block.push(fn); }
  onPlayer(fn) { this.handlers.player.push(fn); }
  onLeave(fn) { this.handlers.leave.push(fn); }

  _emit(kind, data) {
    for (const fn of this.handlers[kind]) {
      try { fn(data); } catch (e) {}
    }
  }
}
