const EventEmitter = require('events');
const crypto = require('crypto');
const gameCfg = require('../config/game');

const { roleCounts } = gameCfg;

const CHANNELS = ['public', 'mafia', 'dead', 'system'];
const MAX_CHAT_LEN = 200;
const HISTORY_CAP = 200;

const PHASE_TEXT = {
  role_reveal: () => '게임이 시작되었습니다. 자신의 직업을 확인하세요.',
  night: (g) => `${g.day}일차 밤이 되었습니다.`,
  morning: () => '아침이 밝았습니다.',
  discussion: (g) => (g.day === 1 && !g.limits.firstDayVote
    ? '첫날 낮입니다. 오늘은 토론만 하고 처형 투표는 없습니다. 밤이 되면 능력이 시작됩니다.'
    : '낮 토론이 시작되었습니다.'),
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
  constructor({ id, title, maxPlayers, passwordHash = null, times, limits, options, mafiaCount = null, playerInfo = null }) {
    super();
    this.playerInfo = playerInfo; // (userId) => { av, tier } 표시용 정보 (선택)
    this.mafiaCount = mafiaCount; // 방장이 정한 마피아 수 (null 이면 인원별 기본값)
    this.customRules = false; // 이번 판이 기본 배분과 다른가 (true 면 랭킹 미반영)
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
    this.defendantId = null; // 최후 변론 대상
    this.history = this._emptyHistory();
    this.options = { ...limits.options, ...options };

    // 라운드별 임시 상태 (매 밤/투표마다 초기화)
    this.nightActs = this._emptyNight();
    this.ballots = new Map(); // voterId -> targetId (낮 투표)
    this.verdicts = new Map(); // voterId -> boolean (찬반)
    this.policeLog = []; // 경찰에게만 보이는 누적 조사 결과
  }

  _emptyNight() { return { mafia: new Map(), doctor: null, police: null }; }

  _emptyHistory() { return { public: [], mafia: [], dead: [], system: [] }; }

  get hasPassword() { return !!this.passwordHash; }
  get isFull() { return this.players.size >= this.maxPlayers; }

  // ---------- 참가자 관리 ----------

  _newPlayer(user) {
    return {
      id: user.id, nickname: user.nickname, connected: true,
      alive: true, left: false, role: null, team: null,
      stats: { policeHits: 0, doctorSaves: 0 },
      executed: false, // 투표로 처형되었는가 (점수 계산용)
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

    // 실제 인원 기준으로 마피아 수를 확정한다. 설정값이 상한(인원÷3)을 넘으면 줄이고,
    // 기본 배분과 다르면 직접 정한 판으로 본다(랭킹 미반영).
    const n = this.players.size;
    const def = gameCfg.defaultMafia(n);
    let mafia = def;
    let adjusted = false;
    if (this.mafiaCount != null) {
      mafia = Math.min(this.mafiaCount, gameCfg.maxMafia(n));
      adjusted = mafia !== this.mafiaCount;
    }
    this.customRules = mafia !== def;
    this._assignRoles(mafia);
    this.status = 'playing';
    this.day = 0;
    this.defendantId = null;
    this.history = this._emptyHistory();
    this.policeLog = [];
    this.nightActs = this._emptyNight();
    this.ballots.clear();
    this.verdicts.clear();
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
    if (adjusted) this._system(`인원이 적어 마피아 수를 ${mafia}명으로 조정했습니다.`);
    if (this.customRules) this._system('마피아 수가 기본 배분과 달라 이번 판은 랭킹에 반영되지 않습니다.');
    return { ok: true };
  }

  _assignRoles(mafia) {
    const counts = roleCounts(this.players.size, mafia);
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
      p.executed = false;
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

  // 하루의 순서: 낮(토론/투표) → 밤 → 아침 결과. 첫날은 낮부터 시작하므로 밤에 day 를 올리지 않는다
  // (day 는 아침 결과 뒤 새 낮이 시작될 때 +1).
  _startNight() {
    this.nightActs = this._emptyNight();
    this.defendantId = null;
    this._enter('night', this.times.night);
  }

  _advance() {
    if (this.destroyed || this.status !== 'playing') return;
    const fixed = this.limits.fixedSec;
    switch (this.phase) {
      case 'role_reveal':
        this.day = 1; // 첫날은 낮 토론부터: 밤에 바로 죽는 사람이 없도록
        return this._enter('discussion', this.times.discussion);
      case 'night': {
        const result = this._resolveNight();
        this._enter('morning', fixed.morning);
        return this._announceNight(result); // 사망/세이브는 아침 화면에서 공개한다
      }
      case 'morning':
        if (this._checkWin()) return;
        this.day += 1;
        return this._enter('discussion', this.times.discussion);
      case 'discussion':
        if (this.day === 1 && !this.limits.firstDayVote) return this._startNight();
        this.ballots.clear();
        this.emit('toRoom', 'vote:update', { tally: {} });
        return this._enter('vote', this.times.vote);
      case 'vote':
        if (!this._resolveVote()) return this._startNight();
        return this._enter('defense', this.times.defense);
      case 'defense':
        this.verdicts.clear();
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

  // ---------- 밤 능력 ----------

  _isAlive(id) { const p = this.players.get(id); return !!p && p.alive && !p.left; }

  /** 밤 능력 사용: 마피아=지목 살해 / 의사=보호 / 경찰=조사. 밤이 끝나기 전까지는 마지막 선택이 유효하다. */
  nightAction(userId, targetId) {
    const me = this.players.get(userId);
    if (!me || me.left || !me.alive || this.status !== 'playing') return { error: 'forbidden' };
    if (this.phase !== 'night') return { error: 'wrong_phase' };
    if (!['mafia', 'doctor', 'police'].includes(me.role)) return { error: 'no_ability' };
    if (!this._isAlive(targetId)) return { error: 'invalid_target' };
    const target = this.players.get(targetId);

    if (me.role === 'mafia') {
      if (target.team === 'mafia') return { error: 'invalid_target' }; // 동료는 지목 불가
      this.nightActs.mafia.set(userId, targetId);
      this._sendMafiaPicks();
    } else if (me.role === 'doctor') {
      if (targetId === userId && !this.options.doctorSelfProtect) return { error: 'invalid_target' };
      this.nightActs.doctor = targetId;
    } else {
      if (targetId === userId) return { error: 'invalid_target' };
      this.nightActs.police = targetId;
    }
    return { ok: true };
  }

  _sendMafiaPicks() {
    const picks = Object.fromEntries(this.nightActs.mafia);
    for (const p of this.players.values()) {
      if (p.role === 'mafia' && !p.left) this.emit('toUser', p.id, 'mafia:picks', { picks });
    }
  }

  /** 밤 종료 시 판정. 결과만 계산하고, 공개(사망/세이브/조사 결과 전송)는 _announceNight 에서 한다. */
  _resolveNight() {
    const { mafia, doctor, police } = this.nightActs;

    // 마피아 다수결. 동률이면 동률 후보 중 무작위, 아무도 지목하지 않았으면 킬 없음
    const votes = new Map();
    for (const [mafiaId, t] of mafia) {
      if (!this._isAlive(mafiaId) || !this._isAlive(t)) continue;
      votes.set(t, (votes.get(t) || 0) + 1);
    }
    let targetId = null;
    if (votes.size) {
      const top = Math.max(...votes.values());
      const cands = [...votes].filter(([, n]) => n === top).map(([id]) => id);
      targetId = cands[crypto.randomInt(cands.length)];
    }

    const saved = targetId !== null && doctor === targetId && this._isAlive(doctor);
    if (saved) {
      const doc = [...this.players.values()].find((p) => p.role === 'doctor' && p.alive);
      if (doc) doc.stats.doctorSaves += 1;
    }

    let policeResult = null;
    const cop = [...this.players.values()].find((p) => p.role === 'police' && p.alive && !p.left);
    if (cop && police !== null && this._isAlive(police)) {
      const isMafia = this.players.get(police).role === 'mafia';
      if (isMafia) cop.stats.policeHits += 1;
      policeResult = { copId: cop.id, targetId: police, isMafia };
      this.policeLog.push({ targetId: police, isMafia, day: this.day });
    }

    return { killedId: saved ? null : targetId, saved, policeResult };
  }

  _announceNight({ killedId, saved, policeResult }) {
    if (policeResult) {
      this.emit('toUser', policeResult.copId, 'police:result',
        { targetId: policeResult.targetId, isMafia: policeResult.isMafia });
    }
    if (saved) {
      this.emit('toRoom', 'night:saved', {});
      this._system('누군가 살아남았습니다.');
    } else if (killedId !== null) {
      this._kill(killedId, 'mafia');
    } else {
      this._system('평화로운 밤이었습니다.');
    }
  }

  // ---------- 낮 투표 / 최후 변론 / 찬반 투표 ----------

  /** 유효한 표만 집계 (생존 투표자 → 생존 대상) */
  _tally() {
    const tally = {};
    for (const [voter, t] of this.ballots) {
      if (!this._isAlive(voter) || !this._isAlive(t)) continue;
      tally[t] = (tally[t] || 0) + 1;
    }
    return tally;
  }

  _aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive && !p.left) n++;
    return n;
  }

  /** targetId === null 이면 투표 취소. 모든 생존자가 투표하면 투표 단계를 일찍 끝낸다. */
  castVote(userId, targetId) {
    const me = this.players.get(userId);
    if (!me || me.left || !me.alive || this.status !== 'playing') return { error: 'forbidden' };
    if (this.phase !== 'vote') return { error: 'wrong_phase' };
    if (targetId === null) {
      this.ballots.delete(userId);
    } else {
      if (!this._isAlive(targetId)) return { error: 'invalid_target' };
      this.ballots.set(userId, targetId);
    }
    this.emit('toRoom', 'vote:update', { tally: this._tally() });
    this.emit('room'); // 본인의 투표 상태 갱신
    if (targetId !== null && this._validBallotCount() >= this._aliveCount()) this._advance();
    return { ok: true };
  }

  _validBallotCount() {
    let n = 0;
    for (const [voter, t] of this.ballots) if (this._isAlive(voter) && this._isAlive(t)) n++;
    return n;
  }

  /** 최다 득표 단독자가 최후 변론 대상. 동률이거나 무투표면 처형 없이 밤으로. @returns {boolean} 변론 대상 존재 */
  _resolveVote() {
    const tally = this._tally();
    const entries = Object.entries(tally).map(([id, n]) => [Number(id), n]);
    let defendant = null;
    let tied = null; // 동점이면 공동 최다 득표자 [{ id, nickname, votes }]
    if (entries.length) {
      const top = Math.max(...entries.map(([, n]) => n));
      const leaders = entries.filter(([, n]) => n === top);
      if (leaders.length === 1) defendant = leaders[0][0];
      else tied = leaders.map(([id, votes]) => ({ id, nickname: this.players.get(id).nickname, votes }));
    }
    this.defendantId = defendant;
    // reason: 'tie'(동점) | 'no_votes'(투표 없음) — 클라이언트가 "이번 투표는 넘어갑니다" 안내를 띄운다
    const reason = defendant !== null ? null : tied ? 'tie' : 'no_votes';
    this.emit('toRoom', 'vote:result', { defendantId: defendant, tally, reason, tied: tied || undefined });
    if (defendant === null) {
      this._system(tied
        ? `동점입니다. (${tied.map((t) => `${t.nickname} ${t.votes}표`).join(', ')}) 이번 투표는 넘어가고 아무도 처형되지 않습니다.`
        : '투표한 사람이 없어 이번 투표는 넘어가고 아무도 처형되지 않습니다.');
      return false;
    }
    this._system(`${this.players.get(defendant).nickname}님이 최후 변론 대상으로 지목되었습니다.`);
    return true;
  }

  castVerdict(userId, agree) {
    const me = this.players.get(userId);
    if (!me || me.left || !me.alive || this.status !== 'playing') return { error: 'forbidden' };
    if (this.phase !== 'verdict') return { error: 'wrong_phase' };
    if (userId === this.defendantId) return { error: 'forbidden' }; // 지목된 본인은 투표 불가
    if (typeof agree !== 'boolean') return { error: 'invalid_vote' };
    this.verdicts.set(userId, agree);
    this.emit('room');
    if (this._verdictVoterCount() >= this._aliveCount() - 1) this._advance();
    return { ok: true };
  }

  _verdictVoterCount() {
    let n = 0;
    for (const voter of this.verdicts.keys()) if (this._isAlive(voter) && voter !== this.defendantId) n++;
    return n;
  }

  /** 찬성이 (본인 제외 생존자의 절반)을 넘으면 처형. 기권은 반대로 계산. @returns {boolean} 처형 여부 */
  _resolveVerdict() {
    const defendant = this.defendantId;
    if (defendant === null || !this._isAlive(defendant)) {
      this.defendantId = null;
      return false;
    }
    const eligible = this._aliveCount() - 1;
    let agree = 0;
    let disagree = 0;
    for (const [voter, v] of this.verdicts) {
      if (!this._isAlive(voter) || voter === defendant) continue;
      if (v) agree++; else disagree++;
    }
    const executed = agree > eligible / 2;
    this.emit('toRoom', 'verdict:result', { defendantId: defendant, executed, agree, disagree });
    if (!executed) {
      this._system('찬성이 과반이 되지 않아 처형하지 않습니다.');
      this.defendantId = null;
      return false;
    }
    this._kill(defendant, 'vote');
    return true;
  }

  // ---------- 사망 / 승리 판정 ----------

  _kill(userId, cause) {
    const p = this.players.get(userId);
    if (!p || !p.alive) return;
    p.alive = false;
    if (cause === 'vote') p.executed = true;
    // 직업은 투표 처형일 때만 공개한다 (마피아 킬/이탈은 비공개)
    this.emit('toRoom', 'player:killed',
      { id: userId, cause, role: cause === 'vote' ? p.role : undefined });
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
      roomId: this.id, title: this.title, winner, customRules: this.customRules,
      players: [...this.players.values()].map((p) => ({
        id: p.id, role: p.role, team: p.team, alive: p.alive, left: p.left,
        executed: p.executed, stats: { ...p.stats },
      })),
    });

    // 대기실로 복귀: 이탈자는 정리하고 나머지는 직업 초기화
    for (const [id, p] of this.players) {
      if (p.left) this.players.delete(id);
      else Object.assign(p, { role: null, team: null, alive: true, executed: false });
    }
    this.nightActs = this._emptyNight();
    this.ballots.clear();
    this.verdicts.clear();
    this.policeLog = [];
    this.status = 'waiting';
    this.customRules = false;
    this.phase = null;
    this.endsAt = null;
    this.day = 0;
    this._ensureHost();
    this.emit('lobby');
    this.emit('room');
  }

  // ---------- 클라이언트에 내려주는 뷰 ----------

  /** 표시용 부가 정보(프로필 사진 버전 av, 티어 키 tier). 없으면 필드를 생략한다. */
  _infoOf(userId) {
    const i = this.playerInfo ? this.playerInfo(userId) : null;
    if (!i) return {};
    return { av: i.av || undefined, tier: i.tier };
  }

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
      mafiaCount: this.mafiaCount,
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
      firstDayVote: this.limits.firstDayVote,
      mafiaCount: this.mafiaCount,
      customRules: this.customRules,
      youId: userId,
      chat: this.chatStateFor(userId),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        ...this._infoOf(p.id),
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
      if (['defense', 'verdict', 'execution'].includes(this.phase)) state.defendantId = this.defendantId;
      if (this.phase === 'vote') state.tally = this._tally();
      state.you = {
        role: me.role,
        alive: me.alive,
        mafiaTeam: me.role === 'mafia' ? this._mafiaList() : undefined,
        // 아래는 모두 본인 선택/본인 직업 결과만 (재접속 시 UI 복구용)
        nightTarget: this.phase === 'night' ? this._myNightTarget(me) : undefined,
        mafiaPicks: me.role === 'mafia' && this.phase === 'night' ? Object.fromEntries(this.nightActs.mafia) : undefined,
        policeLog: me.role === 'police' ? this.policeLog : undefined,
        vote: this.phase === 'vote' ? (this.ballots.get(userId) ?? null) : undefined,
        verdict: this.phase === 'verdict' ? (this.verdicts.get(userId) ?? null) : undefined,
      };
    }
    return state;
  }

  _myNightTarget(p) {
    if (p.role === 'mafia') return this.nightActs.mafia.get(p.id) ?? null;
    if (p.role === 'doctor') return this.nightActs.doctor;
    if (p.role === 'police') return this.nightActs.police;
    return undefined;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.removeAllListeners();
  }
}

module.exports = { Game };
