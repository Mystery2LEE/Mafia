const EventEmitter = require('events');
const crypto = require('crypto');
const { roleCounts } = require('../config/game');

const CHANNELS = ['public', 'mafia', 'dead', 'system'];
const MAX_CHAT_LEN = 200;
const HISTORY_CAP = 200;

const PHASE_TEXT = {
  role_reveal: () => '게임이 시작되었습니다. 자신의 직업을 확인하세요.',
  night: (g) => `${g.day}일차 밤이 되었습니다.`,
  morning: () => '아침이 밝았습니다.',
  discussion: () => '낮 토론이 시작되었습니다.',
  vote: () => '투표를 시작합니다. 처형할 사람을 지목하세요.',
  defense: () => '최후 변론을 시작합니다.',
  verdict: () => '찬반 투표를 시작합니다.',
  execution: () => '처형이 집행됩니다.',
};
const KILL_TEXT = { left: '님이 게임에서 이탈했습니다.', mafia: '님이 밤사이 사망했습니다.', vote: '님이 처형되었습니다.' };

/**
 * 방 1개 = Game 인스턴스 1개. 모든 상태는 인스턴스 안에만 둔다(모듈 전역 상태 금지).
 *
 * 밖으로 내보내는 이벤트(소켓 계층이 구독):
 *   'room'                      방 상태가 바뀜 → 참가자 각자에게 stateFor() 전송
 *   'lobby'                     로비 목록에 보이는 정보가 바뀜
 *   'toRoom' (event, payload)   방 전체 브로드캐스트
 *   'toUser' (userId, event, payload)  특정 유저에게만
 *   'ended'  (report)           게임 종료 보고(점수 반영용)
 */
class Game extends EventEmitter {
  constructor({ id, title, maxPlayers, passwordHash = null, times, limits }) {
    super();
    this.id = id;
    this.title = title;
    this.maxPlayers = maxPlayers;
    this.passwordHash = passwordHash;
    this.times = times;
    this.limits = limits;
    this.status = 'waiting'; // 'waiting' | 'playing'
    this.hostId = null;
    this.players = new Map(); // userId -> player
    this.createdAt = Date.now();

    this.phase = null;
    this.day = 0;
    this.endsAt = null;
    this.timer = null;
    this.destroyed = false;
    this.defendantId = null; // 최후 변론 대상 (투표 단계에서 채운다)
    this.history = this._emptyHistory();
  }

  _emptyHistory() { return { public: [], mafia: [], dead: [], system: [] }; }

  get hasPassword() { return !!this.passwordHash; }
  get isFull() { return this.players.size >= this.maxPlayers; }

  // ---------- 참가자 관리 ----------

  _newPlayer(user) {
    return {
      id: user.id, nickname: user.nickname, connected: true,
      alive: true, left: false, role: null, team: null,
      stats: { policeHits: 0, doctorSaves: 0 },
      chatTimes: [],
    };
  }

  addPlayer(user) {
    this.players.set(user.id, this._newPlayer(user));
    if (this.hostId === null) this.hostId = user.id;
  }

  setConnected(userId, connected) {
    const p = this.players.get(userId);
    if (p) p.connected = connected;
  }

  /**
   * 방 나가기(명시적 퇴장 또는 재접속 유예 만료).
   * 대기 중이면 목록에서 제거, 게임 중이면 "이탈" 처리(사망 + 패배 대상)로 남겨둔다.
   * @returns {{ empty: boolean }}
   */
  leave(userId) {
    const p = this.players.get(userId);
    if (!p) return { empty: this._remaining() === 0 };
    if (this.status === 'waiting') {
      this.players.delete(userId);
    } else {
      p.left = true;
      p.connected = false;
      if (p.alive) this._kill(userId, 'left');
    }
    this._ensureHost();
    // 이탈로 승리 조건이 충족될 수 있다 (종료되면 이탈자는 정리된다)
    if (this.status === 'playing') this._checkWin();
    return { empty: this._remaining() === 0 };
  }

  _remaining() {
    let n = 0;
    for (const p of this.players.values()) if (!p.left) n++;
    return n;
  }

  /** 방장이 나갔으면 가장 먼저 입장한 남은 사람에게 이전 */
  _ensureHost() {
    const host = this.players.get(this.hostId);
    if (host && !host.left) return;
    const next = [...this.players.values()].find((p) => !p.left);
    this.hostId = next ? next.id : null;
  }

  // ---------- 게임 시작 / 직업 배정 ----------

  start(userId) {
    if (userId !== this.hostId) return { error: 'not_host' };
    if (this.status !== 'waiting') return { error: 'already_started' };
    if (this.players.size < this.limits.minPlayers) return { error: 'not_enough_players' };

    this._assignRoles();
    this.status = 'playing';
    this.day = 0;
    this.defendantId = null;
    this.history = this._emptyHistory();
    const mafiaTeam = this._mafiaList();
    for (const p of this.players.values()) {
      this.emit('toUser', p.id, 'role:assigned', {
        role: p.role,
        mafiaTeam: p.role === 'mafia' ? mafiaTeam : undefined,
      });
    }
    this.emit('lobby');
    this.emit('room');
    this._enter('role_reveal', this.limits.fixedSec.roleReveal);
    return { ok: true };
  }

  _assignRoles() {
    const counts = roleCounts(this.players.size);
    const roles = [];
    for (const [role, n] of Object.entries(counts)) for (let i = 0; i < n; i++) roles.push(role);
    // Fisher-Yates (암호학적 난수)
    for (let i = roles.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    let i = 0;
    for (const p of this.players.values()) {
      p.role = roles[i++];
      p.team = p.role === 'mafia' ? 'mafia' : 'citizen';
      p.alive = true;
      p.stats = { policeHits: 0, doctorSaves: 0 };
    }
  }

  _mafiaList() {
    return [...this.players.values()]
      .filter((p) => p.role === 'mafia')
      .map((p) => ({ id: p.id, nickname: p.nickname }));
  }

  // ---------- 페이즈 상태 머신 (서버 타이머가 유일한 진행 수단) ----------

  _ms(sec) { return sec * this.limits.secondMs; }

  _enter(phase, sec) {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.phase = phase;
    this.endsAt = Date.now() + this._ms(sec);
    this.timer = setTimeout(() => this._advance(), this._ms(sec));
    this.timer.unref?.();
    this.emit('toRoom', 'phase:change', { phase, endsAt: this.endsAt, day: this.day });
    this.emit('room');
    this._system(PHASE_TEXT[phase](this));
  }

  _startNight() {
    this.day += 1;
    this._enter('night', this.times.night);
  }

  _advance() {
    if (this.destroyed || this.status !== 'playing') return;
    const fixed = this.limits.fixedSec;
    switch (this.phase) {
      case 'role_reveal':
        return this._startNight();
      case 'night':
        this._resolveNight();
        return this._enter('morning', fixed.morning);
      case 'morning':
        if (this._checkWin()) return;
        return this._enter('discussion', this.times.discussion);
      case 'discussion':
        return this._enter('vote', this.times.vote);
      case 'vote':
        return this._resolveVote()
          ? this._enter('defense', this.times.defense)
          : this._startNight();
      case 'defense':
        return this._enter('verdict', this.times.verdict);
      case 'verdict':
        return this._resolveVerdict()
          ? this._enter('execution', fixed.execution)
          : this._startNight();
      case 'execution':
        if (this._checkWin()) return;
        return this._startNight();
    }
  }

  // 아래 세 가지는 다음 단계(밤 능력 / 투표)에서 실제 판정을 채운다.
  _resolveNight() {}
  _resolveVote() { return false; } // 최후 변론 대상이 있으면 true
  _resolveVerdict() { return false; } // 처형이 있으면 true

  // ---------- 사망 / 승리 판정 ----------

  _kill(userId, cause) {
    const p = this.players.get(userId);
    if (!p || !p.alive) return;
    p.alive = false;
    this.emit('toRoom', 'player:killed', { id: userId, cause });
    this.emit('room'); // 소켓 계층이 여기서 채널 소속을 다시 맞춘다 (사망자는 dead/mafia 채널 읽기 + 히스토리 수신)
    this._system(`${p.nickname}${KILL_TEXT[cause] || '님이 사망했습니다.'}`);
  }

  // ---------- 채팅 (읽기/쓰기 권한은 모두 여기서 판정한다) ----------

  /** 이 유저가 읽을 수 있는 채널. 소켓 계층은 이 목록대로 Socket.IO room에 넣고 뺀다. */
  readChannels(userId) {
    const p = this.players.get(userId);
    if (!p || p.left) return [];
    const ch = ['public', 'system'];
    if (this.status === 'playing') {
      if (p.role === 'mafia' || !p.alive) ch.push('mafia'); // 마피아 + 사망자
      if (!p.alive) ch.push('dead'); // 사망자만
    }
    return ch;
  }

  /** 지금 이 유저가 해당 채널에 쓸 수 있는가 */
  canWrite(userId, channel) {
    const p = this.players.get(userId);
    if (!p || p.left) return false;
    if (this.status === 'waiting') return channel === 'public'; // 대기실에서는 전체 채팅만
    switch (channel) {
      case 'public':
        if (!p.alive) return false;
        if (this.phase === 'discussion' || this.phase === 'vote') return true;
        if (this.phase === 'defense') return userId === this.defendantId; // 변론 중엔 지목자만
        return false;
      case 'mafia':
        return p.alive && p.role === 'mafia' && this.phase === 'night';
      case 'dead':
        return !p.alive;
      default: // system 은 서버만
        return false;
    }
  }

  chat(userId, channel, text) {
    const p = this.players.get(userId);
    if (!p || p.left) return { error: 'not_in_room' };
    if (!CHANNELS.includes(channel)) return { error: 'invalid_channel' };
    if (typeof text !== 'string') return { error: 'invalid_text' };
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!clean || clean.length > MAX_CHAT_LEN) return { error: 'invalid_text' };
    if (!this.canWrite(userId, channel)) return { error: 'forbidden' };

    const { count, perMs } = this.limits.chatRate;
    const now = Date.now();
    p.chatTimes = p.chatTimes.filter((t) => now - t < perMs);
    if (p.chatTimes.length >= count) return { error: 'rate_limited' };
    p.chatTimes.push(now);

    this._deliver(channel, { channel, from: { id: p.id, nickname: p.nickname }, text: clean, ts: now });
    return { ok: true };
  }

  _system(text) {
    this._deliver('system', { channel: 'system', from: null, text, ts: Date.now() });
  }

  _deliver(channel, msg) {
    const h = this.history[channel];
    h.push(msg);
    if (h.length > HISTORY_CAP) h.shift();
    this.emit('toChannel', channel, 'chat:message', msg);
  }

  historyOf(channel) { return this.history[channel] ?? []; }

  /** 채널 목록과 쓰기 가능 여부 (클라이언트 UI 표시용 — 실제 권한은 chat()에서 다시 검증) */
  chatStateFor(userId) {
    return {
      read: this.readChannels(userId),
      write: ['public', 'mafia', 'dead'].filter((c) => this.canWrite(userId, c)),
    };
  }

  /** 승리 조건을 확인하고, 충족되면 게임을 끝낸다. @returns {boolean} 종료 여부 */
  _checkWin() {
    let mafia = 0;
    let citizen = 0;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.team === 'mafia') mafia++; else citizen++;
    }
    let winner = null;
    if (mafia === 0) winner = 'citizen';
    else if (mafia >= citizen) winner = 'mafia';
    if (!winner) return false;
    this._endGame(winner);
    return true;
  }

  _endGame(winner) {
    clearTimeout(this.timer);
    const roles = [...this.players.values()].map((p) => ({
      id: p.id, nickname: p.nickname, role: p.role, team: p.team, alive: p.alive, left: p.left,
    }));
    this.emit('toRoom', 'game:over', { winner, roles });
    this._system(`게임 종료! ${winner === 'mafia' ? '마피아' : '시민'} 팀이 승리했습니다.`);
    this.history.mafia = [];
    this.history.dead = [];
    this.defendantId = null;
    this.emit('ended', {
      roomId: this.id, title: this.title, winner,
      players: [...this.players.values()].map((p) => ({
        id: p.id, role: p.role, team: p.team, alive: p.alive, left: p.left, stats: { ...p.stats },
      })),
    });

    // 대기실로 복귀: 이탈자는 정리하고 나머지는 직업 초기화
    for (const [id, p] of this.players) {
      if (p.left) this.players.delete(id);
      else Object.assign(p, { role: null, team: null, alive: true });
    }
    this.status = 'waiting';
    this.phase = null;
    this.endsAt = null;
    this.day = 0;
    this._ensureHost();
    this.emit('lobby');
    this.emit('room');
  }

  // ---------- 클라이언트에 내려주는 뷰 ----------

  /** 로비 목록용 요약 (비밀번호 해시 등 내부 정보는 절대 포함하지 않는다) */
  summary() {
    return {
      id: this.id,
      title: this.title,
      playerCount: [...this.players.values()].filter((p) => !p.left).length,
      maxPlayers: this.maxPlayers,
      status: this.status,
      hasPassword: this.hasPassword,
      hostNickname: this.players.get(this.hostId)?.nickname ?? '',
    };
  }

  /**
   * 참가자 한 명에게 내려주는 상태. 다른 사람의 직업은 절대 포함하지 않는다.
   * (예외: 마피아에게는 동료 마피아 목록) — 항상 필드를 명시적으로 골라 담는다.
   */
  stateFor(userId) {
    const me = this.players.get(userId);
    const playing = this.status === 'playing';
    const state = {
      id: this.id,
      title: this.title,
      maxPlayers: this.maxPlayers,
      status: this.status,
      hasPassword: this.hasPassword,
      times: this.times,
      hostId: this.hostId,
      youId: userId,
      chat: this.chatStateFor(userId),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        connected: p.connected,
        isHost: p.id === this.hostId,
        alive: playing ? p.alive : undefined,
        left: playing ? p.left : undefined,
      })),
    };
    if (playing && me) {
      state.phase = this.phase;
      state.day = this.day;
      state.endsAt = this.endsAt;
      state.you = {
        role: me.role,
        alive: me.alive,
        mafiaTeam: me.role === 'mafia' ? this._mafiaList() : undefined,
      };
    }
    return state;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.removeAllListeners();
  }
}

module.exports = { Game };
