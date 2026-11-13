// 게임/방 설정값. 숫자 조정은 이 파일에서만 한다.
module.exports = {
  limits: {
    minPlayers: 4,
    maxPlayers: 12,
    titleMax: 30,
    passwordMax: 20,
    // 소켓이 끊긴 뒤 이 시간 안에 재접속하면 같은 방으로 복구, 지나면 방에서 제거
    waitingGraceMs: 10_000,
    ingameGraceMs: 60_000,
    phaseSec: { min: 5, max: 180 },
  },
  // 페이즈 기본 시간(초)
  defaultTimes: { night: 30, discussion: 90, vote: 30, defense: 20, verdict: 15 },
};
