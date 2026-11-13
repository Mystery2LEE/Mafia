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
    // 방 설정과 무관하게 고정인 페이즈 길이(초)
    fixedSec: { roleReveal: 5, morning: 5, execution: 4 },
    // 1초가 몇 ms인가. 테스트에서 줄여서 타이머를 빠르게 돌린다.
    secondMs: 1000,
  },
  // 페이즈 기본 시간(초)
  defaultTimes: { night: 30, discussion: 90, vote: 30, defense: 20, verdict: 15 },

  // 인원별 직업 배분: 4–5명 마피아1 / 6–8명 마피아2 / 9–12명 마피아3, 경찰·의사 각 1, 나머지 시민
  roleCounts(n) {
    const mafia = n <= 5 ? 1 : n <= 8 ? 2 : 3;
    return { mafia, police: 1, doctor: 1, citizen: n - mafia - 2 };
  },
};
