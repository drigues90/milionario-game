function randomizeRolesForUsers(userIds, excludedMillionaireUserIds = []) {
  if (!Array.isArray(userIds) || userIds.length !== 4) {
    throw new Error('O sorteio exige exatamente 4 jogadores cadastrados.');
  }

  const unique = new Set(userIds);
  if (unique.size !== 4) {
    throw new Error('Os jogadores devem ser únicos para o sorteio.');
  }

  const excluded = new Set((excludedMillionaireUserIds || []).map((id) => Number(id)));
  const eligibleMillionaires = userIds.filter((id) => !excluded.has(Number(id)));
  if (eligibleMillionaires.length === 0) {
    throw new Error('Não há jogadores elegíveis para ser milionário nesta rodada.');
  }

  const millionaireIndex = Math.floor(Math.random() * eligibleMillionaires.length);
  const millionaireUserId = eligibleMillionaires[millionaireIndex];

  return userIds.map((id) => ({
    userId: id,
    role: id === millionaireUserId ? 'MILIONARIO' : 'POBRE',
  }));
}

function pickRandomMissionFromEachPlayer(missionsByPlayer) {
  if (!Array.isArray(missionsByPlayer) || missionsByPlayer.length !== 4) {
    throw new Error('É necessário informar as missões dos 4 jogadores.');
  }

  return missionsByPlayer.map((playerMissions) => {
    if (!Array.isArray(playerMissions.missions) || playerMissions.missions.length !== 4) {
      throw new Error('Cada jogador precisa ter exatamente 4 missões cadastradas.');
    }

    const randomIndex = Math.floor(Math.random() * playerMissions.missions.length);
    return {
      ownerUserId: playerMissions.ownerUserId,
      mission: playerMissions.missions[randomIndex],
    };
  });
}

function canMillionaireViewMissions({
  drawDone,
  isMillionaire,
  allPlayersSubmittedFourMissions,
  assignedMissionsCount,
}) {
  return (
    Boolean(drawDone) &&
    Boolean(isMillionaire) &&
    Boolean(allPlayersSubmittedFourMissions) &&
    Number(assignedMissionsCount) === 4
  );
}

module.exports = {
  randomizeRolesForUsers,
  pickRandomMissionFromEachPlayer,
  canMillionaireViewMissions,
};
