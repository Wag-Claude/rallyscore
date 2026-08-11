// ============================================================
// RallyScore — WebRTC live video signaling over Supabase Realtime
// ============================================================
// Architecture: 1 broadcaster → N viewers (one-to-many).
// Each viewer creates a separate peer connection with the broadcaster.
// Signaling messages (offer/answer/ICE) are exchanged via a Supabase
// Realtime broadcast channel keyed on the match ID.
//
// Cost: $0 (Supabase realtime free quota covers ~30 viewers per match).
// Latency: ~200-500ms (true peer-to-peer when STUN works).
// Limitation: ~30 concurrent viewers max before broadcaster CPU/bandwidth
//   becomes the bottleneck. For more, add a TURN server or upgrade to Mux.
// ============================================================

import { supabase } from './supabase-client.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// =========================================================================
// BROADCASTER side
// Captures the camera stream and offers it to any viewer that joins.
// =========================================================================
export class LiveBroadcaster {
  constructor(matchId) {
    this.matchId = matchId;
    this.localStream = null;
    this.peers = new Map(); // viewerId -> RTCPeerConnection
    this.channel = null;
    this.viewerCountListeners = [];
    this._announceTimer = null;
  }

  async start(videoElement, { facingMode = 'environment' } = {}) {
    // 1. Get the camera
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    if (videoElement) {
      videoElement.srcObject = this.localStream;
      videoElement.muted = true; // avoid feedback
      await videoElement.play().catch(() => {});
    }

    // 2. Open the signaling channel for this match
    this.channel = supabase.channel(`webrtc:${this.matchId}`, {
      config: { broadcast: { self: false, ack: false } }
    });

    this.channel.on('broadcast', { event: 'viewer-join' }, async ({ payload }) => {
      await this._handleViewerJoin(payload.viewerId);
    });

    this.channel.on('broadcast', { event: 'viewer-answer' }, async ({ payload }) => {
      const peer = this.peers.get(payload.viewerId);
      if (peer && peer.signalingState === 'have-local-offer') {
        await peer.setRemoteDescription(payload.answer);
      }
    });

    this.channel.on('broadcast', { event: 'viewer-ice' }, async ({ payload }) => {
      const peer = this.peers.get(payload.viewerId);
      if (peer && payload.candidate) {
        try { await peer.addIceCandidate(payload.candidate); }
        catch (e) { console.warn('addIceCandidate (broadcaster):', e); }
      }
    });

    this.channel.on('broadcast', { event: 'viewer-leave' }, ({ payload }) => {
      this._dropViewer(payload.viewerId);
    });

    await this.channel.subscribe();

    // 3. Announce that we're live so any future viewers can connect
    await this._announce();
    // Re-announce every 10s so late-joining viewers can trigger their broadcaster-online listener
    this._announceTimer = setInterval(() => this._announce(), 10000);

    return this.localStream;
  }

  async _announce() {
    await this.channel.send({
      type: 'broadcast',
      event: 'broadcaster-online',
      payload: { matchId: this.matchId, ts: Date.now() }
    });
  }

  async _handleViewerJoin(viewerId) {
    if (this.peers.has(viewerId)) {
      const existing = this.peers.get(viewerId);
      if (!['failed', 'closed', 'disconnected'].includes(existing.connectionState)) return;
      this._dropViewer(viewerId); // stale peer — viewer is re-joining after failure
    }

    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(viewerId, peer);

    // Add all tracks
    this.localStream.getTracks().forEach(t => peer.addTrack(t, this.localStream));

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        this.channel.send({
          type: 'broadcast',
          event: 'broadcaster-ice',
          payload: { viewerId, candidate: e.candidate.toJSON() }
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        this._dropViewer(viewerId);
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    await this.channel.send({
      type: 'broadcast',
      event: 'broadcaster-offer',
      payload: { viewerId, offer }
    });

    this._notifyViewerCount();
  }

  _dropViewer(viewerId) {
    const peer = this.peers.get(viewerId);
    if (peer) {
      peer.close();
      this.peers.delete(viewerId);
      this._notifyViewerCount();
    }
  }

  onViewerCountChange(fn) {
    this.viewerCountListeners.push(fn);
    return () => {
      this.viewerCountListeners = this.viewerCountListeners.filter(f => f !== fn);
    };
  }
  _notifyViewerCount() {
    const n = this.peers.size;
    this.viewerCountListeners.forEach(fn => { try { fn(n); } catch(_){} });
  }

  async stop() {
    clearInterval(this._announceTimer);
    this.peers.forEach(p => p.close());
    this.peers.clear();
    if (this.channel) await supabase.removeChannel(this.channel);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this._notifyViewerCount();
  }
}

// =========================================================================
// VIEWER side
// Joins a match and asks the broadcaster for a stream.
// =========================================================================
export class LiveViewer {
  constructor(matchId) {
    this.matchId = matchId;
    this.viewerId = `v_${Math.random().toString(36).slice(2, 10)}`;
    this.peer = null;
    this.channel = null;
    this.connectionListeners = [];
  }

  async start(videoElement) {
    this.peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this._iceBuffer = [];
    this._remoteReady = false;
    this._offerReceived = false;
    this._joinRetryTimer = null;

    this.peer.ontrack = (event) => {
      console.log('[viewer] ontrack fired, streams:', event.streams.length);
      if (videoElement && videoElement.srcObject !== event.streams[0]) {
        videoElement.srcObject = event.streams[0];
        videoElement.play().catch((e) => console.warn('[viewer] video.play failed:', e));
      }
    };

    this.peer.onicecandidate = (e) => {
      if (e.candidate && this.channel) {
        this.channel.send({
          type: 'broadcast',
          event: 'viewer-ice',
          payload: { viewerId: this.viewerId, candidate: e.candidate.toJSON() }
        });
      }
    };

    this.peer.onconnectionstatechange = () => {
      console.log('[viewer] connectionState:', this.peer.connectionState);
      this._notifyConnection(this.peer.connectionState);
    };

    this.channel = supabase.channel(`webrtc:${this.matchId}`, {
      config: { broadcast: { self: false, ack: false } }
    });

    this.channel.on('broadcast', { event: 'broadcaster-offer' }, async ({ payload }) => {
      if (payload.viewerId !== this.viewerId) return;
      console.log('[viewer] offer received');
      this._offerReceived = true;
      clearInterval(this._joinRetryTimer); // stop retrying — offer received

      await this.peer.setRemoteDescription(payload.offer);
      this._remoteReady = true;

      // Drain any ICE candidates that arrived before the offer
      for (const c of this._iceBuffer) {
        try { await this.peer.addIceCandidate(c); }
        catch (e) { console.warn('addIceCandidate (buffered):', e); }
      }
      this._iceBuffer = [];

      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      console.log('[viewer] answer sent');
      await this.channel.send({
        type: 'broadcast',
        event: 'viewer-answer',
        payload: { viewerId: this.viewerId, answer }
      });
    });

    // If broadcaster is already live and re-announces, request a fresh offer
    this.channel.on('broadcast', { event: 'broadcaster-online' }, async () => {
      console.log('[viewer] broadcaster-online received, offerReceived=', this._offerReceived);
      if (!this._offerReceived) {
        await this._sendJoin();
      }
    });

    this.channel.on('broadcast', { event: 'broadcaster-ice' }, async ({ payload }) => {
      if (payload.viewerId !== this.viewerId) return;
      if (!payload.candidate) return;
      if (!this._remoteReady) {
        // Buffer until remoteDescription is set
        this._iceBuffer.push(payload.candidate);
        return;
      }
      try { await this.peer.addIceCandidate(payload.candidate); }
      catch (e) { console.warn('addIceCandidate (viewer):', e); }
    });

    await this.channel.subscribe();

    // Send first join and retry every 5s until we receive an offer
    console.log('[viewer] subscribed, sending join, viewerId=', this.viewerId);
    await this._sendJoin();
    this._joinRetryTimer = setInterval(async () => {
      if (!this._offerReceived) {
        console.log('[viewer] retry join');
        await this._sendJoin();
      }
    }, 5000);
  }

  async _sendJoin() {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'viewer-join',
      payload: { viewerId: this.viewerId, ts: Date.now() }
    });
  }

  onConnectionChange(fn) {
    this.connectionListeners.push(fn);
    return () => {
      this.connectionListeners = this.connectionListeners.filter(f => f !== fn);
    };
  }
  _notifyConnection(state) {
    this.connectionListeners.forEach(fn => { try { fn(state); } catch(_){} });
  }

  async stop() {
    clearInterval(this._joinRetryTimer);
    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'viewer-leave',
        payload: { viewerId: this.viewerId }
      });
      await supabase.removeChannel(this.channel);
    }
    if (this.peer) this.peer.close();
    this.peer = null;
    this.channel = null;
  }
}
