const MAX_QUEUE = 3;
const MAX_HISTORY = 60;

function stationName(station) {
  return station?.displayName ?? station?.name ?? '';
}

function joinNames(names) {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function transferText(transfers = []) {
  const actual = transfers.filter(transfer => transfer.implemented === true && transfer.lineId && transfer.platformNumber && ['passage', 'stairs'].includes(transfer.connection));
  if (!actual.length) return '';
  const upper = actual.filter(transfer => transfer.level === 'upper').map(transfer => transfer.lineId);
  const lower = actual.filter(transfer => transfer.level === 'lower').map(transfer => transfer.lineId);
  const directions = [];
  if (upper.length) directions.push(`${joinNames(upper)} on the upper level`);
  if (lower.length) directions.push(`${joinNames(lower)} on the lower level`);
  const other = actual.filter(transfer => !['upper', 'lower'].includes(transfer.level)).map(transfer => transfer.lineId);
  if (other.length) directions.push(joinNames(other));
  return ` Change for ${directions.join('; ')}.`;
}

/** One passenger-facing channel, listening to the authoritative service events. */
export class AnnouncementController {
  constructor(infos, player, options = {}) {
    this.infos = (infos instanceof Map ? [...infos.values()] : Array.isArray(infos) ? infos : Object.values(infos ?? {})).filter(Boolean);
    this.player = player;
    this.language = options.language ?? 'en-GB';
    this.speech = options.speechSynthesis ?? globalThis.speechSynthesis ?? null;
    this.Utterance = options.SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance ?? null;
    this.AudioContext = options.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    this.enabled = false;
    this.elapsed = 0;
    this.caption = '';
    this.captionLineId = null;
    this.captionKind = null;
    this.activeInfo = null;
    this.currentItem = null;
    this.queue = [];
    this.history = [];
    this.seen = new Set();
    this.seenOrder = [];
    this.listeners = new Set();
    this.announcementListeners = new Set();
    this.audio = null;
    this.chimeNodes = [];
    this.voice = null;
    this.speechFailed = false;
    this.audioFailed = false;
    this.utterance = null;
    this.speechStarted = false;
    this.speechDeadline = 0;
    this.rideSequence = 0;
    this.disposed = false;
    this.lastChimeTime = -1;
    this.onVoicesChanged = () => { this.speechFailed = false; this.refreshVoices(); this.notify(); };
    this.speech?.addEventListener?.('voiceschanged', this.onVoicesChanged);
    this.refreshVoices();
    this.unsubscribes = this.infos.map(info => info.subscribe(event => this.onEvent(info, event)));
  }

  refreshVoices() {
    let voices = [];
    try { voices = this.speech?.getVoices?.() ?? []; } catch { /* Captions remain available. */ }
    const language = this.language.toLowerCase();
    this.voice = voices.find(voice => voice.lang?.toLowerCase() === language)
      ?? voices.find(voice => voice.lang?.toLowerCase().startsWith(language.split('-')[0]))
      ?? voices.find(voice => voice.default) ?? voices[0] ?? null;
  }

  get voiceAvailable() { return Boolean(this.voice && this.speech && this.Utterance && !this.speechFailed); }
  get audioAvailable() { return Boolean(this.audio && this.audio.state === 'running' && !this.audioFailed); }

  setEnabled(enabled) {
    if (this.disposed) return false;
    const next = Boolean(enabled);
    if (next === this.enabled) return this.enabled;
    this.enabled = next;
    this.refreshVoices();
    if (next) {
      this.speechFailed = false;
      // Called only by the explicit sound control, preserving browser autoplay
      // policy. Native voice availability is checked separately from chimes.
      if (this.AudioContext && !this.audio) {
        try { this.audio = new this.AudioContext(); } catch { this.audioFailed = true; }
      }
      if (this.audio) {
        try {
          const resumed = this.audio.resume?.();
          resumed?.then?.(() => this.notify(), () => { this.audioFailed = true; this.notify(); });
        } catch { this.audioFailed = true; }
      }
      this.syncRide();
      if (this.currentItem && !this.utterance && this.voiceAvailable) this.speak(this.currentItem);
    } else {
      this.cancelSpeech();
      this.stopChime();
    }
    this.notify();
    return this.enabled;
  }

  toggle() { return this.setEnabled(!this.enabled); }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  /** Future recorded-audio adapters can consume the same selected message. */
  subscribeAnnouncements(listener) {
    this.announcementListeners.add(listener);
    return () => this.announcementListeners.delete(listener);
  }

  getStatus() {
    const speaking = Boolean(this.utterance && this.speechStarted && this.speech?.speaking);
    const status = !this.enabled ? 'Sound off · captions on board'
      : this.voiceAvailable ? speaking ? 'Speaking' : 'Native voice ready'
        : this.audioAvailable ? 'Chimes on · voice unavailable' : 'Audio unavailable · captions only';
    return {
      enabled: this.enabled, muted: !this.enabled,
      available: this.voiceAvailable || Boolean(this.AudioContext && !this.audioFailed),
      voiceAvailable: this.voiceAvailable, audioAvailable: this.audioAvailable,
      caption: this.caption, text: this.caption, captionLineId: this.captionLineId,
      captionKind: this.captionKind, speaking, status,
      activeLineId: this.activeInfo?.service?.lineId ?? null,
      queued: this.queue.length, event: this.currentItem?.event ?? null,
      history: this.history.map(item => ({ ...item })),
    };
  }

  notify() {
    if (!this.listeners.size) return;
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  syncRide() {
    const selected = this.player.ridingCar
      ? this.infos.find(info => info.service === this.player.service) ?? null : null;
    if (selected === this.activeInfo) return;
    this.clearChannel();
    this.activeInfo = selected;
    if (selected) {
      this.rideSequence += 1;
      const snapshot = selected.snapshot;
      const destination = stationName(snapshot.terminus);
      const next = stationName(snapshot.nextStation);
      const here = (snapshot.atStation ?? selected.service.atStation) ? ` At ${stationName(snapshot.currentStation)}.` : '';
      this.enqueue({
        id: `boarding:${snapshot.lineId}:${this.rideSequence}`, type: 'boarding-summary', lineId: snapshot.lineId,
        station: snapshot.currentStation, nextStation: snapshot.nextStation,
        snapshot,
      }, `Aurealis-Bahn. ${snapshot.lineId} to ${destination}.${here} Next station: ${next}.`);
    }
    this.notify();
  }

  textFor(event) {
    const station = stationName(event.station);
    const next = stationName(event.nextStation);
    const terminus = stationName(event.terminus);
    // Terminal services prepare the return direction before changing cabs.
    // The doors opened on arrival retain the side seen by arriving passengers.
    const openingSide = event.arrivalDoorSide ?? event.doorSide;
    switch (event.type) {
      case 'departure': return `Next station: ${next}. ${event.lineId} to ${terminus}.`;
      case 'approaching': return `We are approaching ${station}.${transferText(event.interchanges)}`;
      case 'arrival': return `${station}.${transferText(event.interchanges)}`;
      case 'terminus': return `${station} is the terminus. This train returns toward ${terminus}.`;
      case 'doors-opening': return ['left', 'right'].includes(openingSide)
        ? `Doors are opening on the ${openingSide}. Please mind the gap.` : 'Doors are opening. Please mind the gap.';
      case 'doors-closing': return 'Doors are closing. Please stand clear.';
      // Fully open/closed are shown on the passenger screen; repeating the same
      // announcement at both ends of the door animation would add noise.
      default: return '';
    }
  }

  onEvent(info, event) {
    if (this.disposed) return;
    this.syncRide();
    if (info !== this.activeInfo || !event?.id || event.lineId !== this.player.service?.lineId) return;
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id); this.seenOrder.push(event.id);
    if (this.seenOrder.length > 256) this.seen.delete(this.seenOrder.shift());
    const text = this.textFor(event);
    if (!text) return;
    // Safety and movement transitions replace obsolete motion/door messages.
    if (['doors-closing', 'departure'].includes(event.type)
      || (event.type === 'arrival' && ['departure', 'approaching', 'boarding-summary'].includes(this.currentItem?.event.type))) {
      this.clearChannel();
    }
    const item = this.enqueue(event, text);
    if (this.enabled && ['doors-opening', 'doors-closing'].includes(event.type)) item.record.chime = this.playChime(event.type);
  }

  enqueue(event, text) {
    const record = {
      id: event.id, type: event.type, lineId: event.lineId, text,
      stationId: event.station?.id ?? null, nextStationId: event.nextStation?.id ?? null,
      timeSeconds: event.timeSeconds ?? this.elapsed,
      captioned: false, spoken: false, chime: false, state: 'queued',
    };
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    const item = { event, text, record, expiresAt: this.elapsed + 12, finishAt: 0 };
    this.queue.push(item);
    while (this.queue.length > MAX_QUEUE) this.queue.shift().record.state = 'dropped';
    this.pump();
    return item;
  }

  fresh(item) {
    if (!this.activeInfo || item.expiresAt < this.elapsed) return false;
    const snapshot = this.activeInfo.snapshot;
    if (item.event.type === 'boarding-summary') return true;
    if (['departure', 'approaching'].includes(item.event.type)) return snapshot.nextStation?.id === item.event.nextStation?.id;
    return (snapshot.atStation ?? this.activeInfo.service.atStation) && snapshot.currentStation?.id === item.event.station?.id;
  }

  pump() {
    if (this.currentItem || !this.activeInfo) return;
    while (this.queue.length) {
      const item = this.queue.shift();
      if (!this.fresh(item)) { item.record.state = 'expired'; continue; }
      this.currentItem = item;
      item.record.captioned = true; item.record.state = 'captioned';
      item.finishAt = this.elapsed + Math.min(8, Math.max(3, item.text.length / 25));
      this.caption = item.text;
      this.captionLineId = item.event.lineId;
      this.captionKind = item.event.type;
      if (this.enabled && this.voiceAvailable) this.speak(item);
      for (const listener of this.announcementListeners) listener({ ...item.event, text: item.text });
      this.notify();
      return;
    }
  }

  speak(item) {
    this.cancelSpeech();
    try {
      const utterance = new this.Utterance(item.text);
      utterance.voice = this.voice; utterance.lang = this.language;
      utterance.rate = 1.02; utterance.pitch = 1; utterance.volume = 0.72;
      utterance.onstart = () => {
        if (this.utterance !== utterance) return;
        this.speechStarted = true; item.record.spoken = true; item.record.state = 'speaking'; this.notify();
      };
      utterance.onend = () => {
        if (this.utterance !== utterance) return;
        this.utterance = null; this.speechStarted = false;
        item.record.state = 'finished'; this.finishCurrent();
      };
      utterance.onerror = () => {
        if (this.utterance !== utterance) return;
        this.speechFailed = true; this.cancelSpeech();
        item.record.state = 'captions-only'; this.notify();
      };
      this.utterance = utterance;
      this.speechDeadline = this.elapsed + Math.max(12, item.text.length / 7);
      this.speech.speak(utterance);
    } catch {
      this.speechFailed = true; this.cancelSpeech();
      item.record.state = 'captions-only';
    }
  }

  cancelSpeech() {
    const active = this.utterance;
    this.utterance = null; this.speechStarted = false;
    if (active) this.speech?.cancel?.();
  }

  playChime(type) {
    if (!this.audioAvailable) return false;
    try {
      const time = this.audio.currentTime + 0.02;
      if (time - this.lastChimeTime < 0.45) return false;
      this.stopChime();
      this.lastChimeTime = time;
      const tones = type === 'doors-opening' ? [660, 880] : [880, 660];
      tones.forEach((frequency, index) => {
        const oscillator = this.audio.createOscillator(), gain = this.audio.createGain();
        const start = time + index * 0.19;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.025, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
        oscillator.connect(gain); gain.connect(this.audio.destination);
        oscillator.start(start); oscillator.stop(start + 0.19);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        this.chimeNodes.push(oscillator);
      });
      return true;
    } catch { this.audioFailed = true; this.notify(); return false; }
  }

  stopChime() {
    for (const oscillator of this.chimeNodes) {
      try { oscillator.stop(); } catch { /* A completed oscillator is already stopped. */ }
    }
    this.chimeNodes.length = 0;
  }

  finishCurrent() {
    if (this.currentItem) this.currentItem.record.state = 'finished';
    this.currentItem = null;
    this.caption = ''; this.captionLineId = null; this.captionKind = null;
    this.pump();
    this.notify();
  }

  clearChannel() {
    this.cancelSpeech(); this.stopChime();
    if (this.currentItem) this.currentItem.record.state = 'cancelled';
    for (const item of this.queue) item.record.state = 'cancelled';
    this.currentItem = null; this.queue.length = 0;
    this.caption = ''; this.captionLineId = null; this.captionKind = null;
  }

  update(delta) {
    if (this.disposed) return;
    if (Number.isFinite(delta) && delta > 0) this.elapsed += delta;
    this.syncRide();
    if (this.utterance && this.elapsed > this.speechDeadline) {
      this.cancelSpeech(); this.speechFailed = true;
    }
    if (this.currentItem && !this.utterance && this.elapsed >= this.currentItem.finishAt) this.finishCurrent();
    this.pump();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearChannel();
    for (const unsubscribe of this.unsubscribes) unsubscribe?.();
    this.speech?.removeEventListener?.('voiceschanged', this.onVoicesChanged);
    this.audio?.close?.()?.catch?.(() => {});
    this.listeners.clear(); this.announcementListeners.clear();
    this.activeInfo = null;
  }
}
