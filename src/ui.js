export class UI {
  constructor(player, board) {
    this.player = player;
    this.board = board;
    this.helpPanel = document.querySelector('#help-panel');
    this.helpButton = document.querySelector('#help-button');
    this.elapsed = 0;
    this.clockElement = document.querySelector('#station-clock');
    this.destinationElement = document.querySelector('.service-main strong');
    this.routeElement = document.querySelector('.service-main .line-badge');
    this.minutesElement = document.querySelector('.arrival').firstChild;
    this.platformElement = document.querySelector('.service-footer > span:last-child');
    this.boardRevision = -1;
    this.lastClock = '';
    document.querySelector('#reset-button').addEventListener('click', () => { this.showHelp(false); this.player.reset(); });
    document.querySelector('.identity').addEventListener('click', event => { event.preventDefault(); this.player.reset(); });
    this.helpButton.addEventListener('click', () => this.showHelp(this.helpPanel.hidden));
    document.querySelector('#close-help').addEventListener('click', () => this.showHelp(false));
    window.addEventListener('keydown', event => { if (event.code === 'Escape') this.showHelp(false); });
    for (const button of document.querySelectorAll('[data-move]')) {
      button.addEventListener('pointerdown', event => { event.preventDefault(); if (!this.player.enabled) return; button.setPointerCapture(event.pointerId); this.player.keys.add(button.dataset.move); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => this.player.keys.delete(button.dataset.move));
    }
  }

  showHelp(open) {
    this.helpPanel.hidden = !open;
    this.helpButton.setAttribute('aria-expanded', String(open));
    this.player.setEnabled(!open);
    if (open) document.querySelector('#close-help').focus();
  }

  update(delta) {
    this.elapsed += delta;
    // A station clock, independent of the user's timezone. Timetable stays a Phase 1 fixture.
    const minutes = 14 * 60 + 32 + Math.floor(this.elapsed / 60);
    const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (clock !== this.lastClock) {
      this.clockElement.textContent = clock;
      this.board.setClock(clock);
      this.lastClock = clock;
    }
    if (this.boardRevision !== this.board.revision) {
      const next = this.board.departures[0];
      if (next) {
        this.destinationElement.textContent = next.destination;
        this.routeElement.textContent = next.route;
        this.minutesElement.textContent = `${next.minutes} `;
        this.platformElement.textContent = `Platform ${next.platform}  →`;
      }
      this.boardRevision = this.board.revision;
    }
  }

  ready() {
    const loading = document.querySelector('#loading');
    loading.classList.add('complete');
    window.setTimeout(() => loading.hidden = true, 450);
  }
}

export function showError(error) {
  document.querySelector('#loading').hidden = true;
  document.querySelector('#error-message').textContent = error.message || 'Please use a browser with WebGL 2 support and hardware acceleration enabled.';
  document.querySelector('#error').hidden = false;
}
