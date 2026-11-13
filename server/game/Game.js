// 방 1개 = Game 인스턴스 1개. 모든 상태는 인스턴스 안에만 둔다(모듈 전역 상태 금지).
class Game {
  constructor({ id, title, maxPlayers, passwordHash = null, times }) {
    this.id = id;
    this.title = title;
    this.maxPlayers = maxPlayers;
    this.passwordHash = passwordHash;
    this.times = times;
    this.status = 'waiting'; // 'waiting' | 'playing'
    this.hostId = null;
    this.players = new Map(); // userId -> { id, nickname, connected }
    this.createdAt = Date.now();
  }

  get hasPassword() { return !!this.passwordHash; }
  get isFull() { return this.players.size >= this.maxPlayers; }

  addPlayer(user) {
    this.players.set(user.id, { id: user.id, nickname: user.nickname, connected: true });
    if (this.hostId === null) this.hostId = user.id;
  }

  /** @returns {{ empty: boolean, newHostId: number|null }} */
  removePlayer(userId) {
    this.players.delete(userId);
    if (this.players.size === 0) return { empty: true, newHostId: null };
    let newHostId = null;
    if (this.hostId === userId) {
      // Map은 삽입 순서를 보존하므로 가장 먼저 입장한 사람이 다음 방장
      this.hostId = this.players.keys().next().value;
      newHostId = this.hostId;
    }
    return { empty: false, newHostId };
  }

  setConnected(userId, connected) {
    const p = this.players.get(userId);
    if (p) p.connected = connected;
  }

  /** 로비 목록용 요약 (비밀번호 해시 등 내부 정보는 절대 포함하지 않는다) */
  summary() {
    return {
      id: this.id,
      title: this.title,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      status: this.status,
      hasPassword: this.hasPassword,
      hostNickname: this.players.get(this.hostId)?.nickname ?? '',
    };
  }

  /** 방 참가자에게 내려주는 상태. 이후 단계에서 직업 등 개인별 정보는 여기서만 가공한다. */
  stateFor(userId) {
    return {
      id: this.id,
      title: this.title,
      maxPlayers: this.maxPlayers,
      status: this.status,
      hasPassword: this.hasPassword,
      times: this.times,
      hostId: this.hostId,
      youId: userId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        connected: p.connected,
        isHost: p.id === this.hostId,
      })),
    };
  }

  destroy() {
    // 이후 단계에서 타이머 정리 등을 여기서 한다.
  }
}

module.exports = { Game };
