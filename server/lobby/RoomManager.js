const EventEmitter = require('events');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Game } = require('../game/Game');
const defaults = require('../config/game');

const TIME_KEYS = Object.keys(defaults.defaultTimes);

/**
 * 방 목록과 "유저 ↔ 방" 매핑을 관리한다. 소켓은 모른다(순수 로직).
 * 변경은 이벤트로 알린다: 'lobby'(방 목록 변경), 'room'(roomId: 방 내부 상태 변경)
 */
class RoomManager extends EventEmitter {
  constructor({ limits, playerInfo } = {}) {
    super();
    this.playerInfo = playerInfo; // (userId) => { av, tier } 표시용 정보 (선택)
    this.limits = {
      ...defaults.limits,
      ...limits,
      phaseSec: { ...defaults.limits.phaseSec, ...(limits && limits.phaseSec) },
    };
    this.rooms = new Map(); // roomId -> Game
    this.userRoom = new Map(); // userId -> roomId (한 유저는 한 방만)
    this.graceTimers = new Map(); // userId -> Timeout
  }

  get(roomId) { return this.rooms.get(roomId); }
  getRoomOf(userId) { return this.rooms.get(this.userRoom.get(userId)); }
  list() { return [...this.rooms.values()].map((g) => g.summary()); }

  _normalizeTimes(times) {
    const { min, max } = this.limits.phaseSec;
    const out = { ...defaults.defaultTimes };
    if (times === undefined || times === null) return out;
    if (typeof times !== 'object') return null;
    for (const [k, v] of Object.entries(times)) {
      if (!TIME_KEYS.includes(k)) return null;
      if (!Number.isInteger(v) || v < min || v > max) return null;
      out[k] = v;
    }
    return out;
  }

  _newId() {
    let id;
    do { id = crypto.randomBytes(3).toString('hex'); } while (this.rooms.has(id));
    return id;
  }

  async create(user, opts = {}) {
    const { title, maxPlayers, password, times } = opts || {};
    if (this.userRoom.has(user.id)) return { error: 'already_in_room', roomId: this.userRoom.get(user.id) };

    const t = typeof title === 'string' ? title.trim() : '';
    if (!t || t.length > this.limits.titleMax) return { error: 'invalid_title' };
    if (!Number.isInteger(maxPlayers) || maxPlayers < this.limits.minPlayers || maxPlayers > this.limits.maxPlayers)
      return { error: 'invalid_max_players' };
    if (password !== undefined && password !== null && password !== '' &&
        (typeof password !== 'string' || password.length > this.limits.passwordMax))
      return { error: 'invalid_password' };
    const normTimes = this._normalizeTimes(times);
    if (!normTimes) return { error: 'invalid_times' };
    // 마피아 수(선택): 1 ~ 최대인원÷3. 비우면 인원별 기본 배분
    let mafiaCount = null;
    if (opts.mafiaCount !== undefined && opts.mafiaCount !== null && opts.mafiaCount !== '') {
      if (!Number.isInteger(opts.mafiaCount) || opts.mafiaCount < 1 || opts.mafiaCount > defaults.maxMafia(maxPlayers))
        return { error: 'invalid_mafia_count' };
      mafiaCount = opts.mafiaCount;
    }
    const doctorSelfProtect = opts.doctorSelfProtect;
    if (doctorSelfProtect !== undefined && typeof doctorSelfProtect !== 'boolean')
      return { error: 'invalid_options' };

    const passwordHash = password ? await bcrypt.hash(password, 8) : null;
    // await 도중에 다른 방에 들어갔을 수 있으므로 다시 확인
    if (this.userRoom.has(user.id)) return { error: 'already_in_room', roomId: this.userRoom.get(user.id) };

    const game = new Game({
      id: this._newId(), title: t, maxPlayers, passwordHash, times: normTimes, limits: this.limits,
      options: doctorSelfProtect === undefined ? {} : { doctorSelfProtect },
      mafiaCount, playerInfo: this.playerInfo,
    });
    this._wire(game);
    game.addPlayer(user);
    this.rooms.set(game.id, game);
    this.userRoom.set(user.id, game.id);
    this.emit('lobby');
    return { room: game };
  }

  /** Game이 내보내는 이벤트를 RoomManager 이벤트로 전달 (소켓 계층은 RoomManager만 구독한다) */
  _wire(game) {
    game.on('room', () => this.emit('room', game.id));
    game.on('lobby', () => this.emit('lobby'));
    game.on('toRoom', (event, payload) => this.emit('toRoom', game.id, event, payload));
    game.on('toUser', (userId, event, payload) => this.emit('toUser', userId, event, payload));
    game.on('toChannel', (channel, event, payload) => this.emit('toChannel', game.id, channel, event, payload));
    game.on('ended', (report) => this.emit('ended', report));
  }

  async join(user, roomId, password) {
    const current = this.userRoom.get(user.id);
    if (current) return { error: current === roomId ? 'already_joined' : 'already_in_room', roomId: current };
    const check = () => {
      const g = this.rooms.get(roomId);
      if (!g) return { error: 'not_found' };
      if (g.status !== 'waiting') return { error: 'in_game' };
      if (g.isFull) return { error: 'full' };
      return { game: g };
    };
    let r = check();
    if (r.error) return r;
    if (r.game.hasPassword) {
      const ok = typeof password === 'string' && (await bcrypt.compare(password, r.game.passwordHash));
      if (!ok) return { error: 'bad_password' };
      // await 도중 상태가 바뀌었을 수 있다
      r = check();
      if (r.error) return r;
    }
    if (this.userRoom.has(user.id)) return { error: 'already_in_room', roomId: this.userRoom.get(user.id) };

    r.game.addPlayer(user);
    this.userRoom.set(user.id, roomId);
    this.emit('lobby');
    this.emit('room', roomId);
    return { room: r.game };
  }

  /** 방 나가기. 방장이면 다음 사람에게 이전, 빈 방이면 삭제 */
  leave(userId) {
    const game = this.getRoomOf(userId);
    if (!game) return null;
    this._clearGrace(userId);
    this.userRoom.delete(userId);
    const { empty } = game.leave(userId);
    if (empty) {
      game.destroy();
      this.rooms.delete(game.id);
    } else {
      this.emit('room', game.id);
    }
    this.emit('lobby');
    return { roomId: game.id, closed: empty };
  }

  _clearGrace(userId) {
    const t = this.graceTimers.get(userId);
    if (t) { clearTimeout(t); this.graceTimers.delete(userId); }
  }

  /** 소켓이 끊겼을 때. 유예 시간 안에 재접속하지 않으면 방에서 제거 */
  markDisconnected(userId) {
    const game = this.getRoomOf(userId);
    if (!game) return;
    game.setConnected(userId, false);
    this.emit('room', game.id);
    const ms = game.status === 'waiting' ? this.limits.waitingGraceMs : this.limits.ingameGraceMs;
    this._clearGrace(userId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(userId);
      this.leave(userId);
    }, ms);
    timer.unref?.();
    this.graceTimers.set(userId, timer);
  }

  markConnected(userId) {
    const game = this.getRoomOf(userId);
    if (!game) return null;
    this._clearGrace(userId);
    game.setConnected(userId, true);
    this.emit('room', game.id);
    return game;
  }

  shutdown() {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const g of this.rooms.values()) g.destroy();
  }
}

module.exports = { RoomManager };
