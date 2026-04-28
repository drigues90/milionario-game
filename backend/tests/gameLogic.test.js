const assert = require('assert');
const {
  randomizeRolesForUsers,
  pickRandomMissionFromEachPlayer,
  canMillionaireViewMissions,
} = require('../src/gameLogic');

function runGameLogicTests() {
  const players = [10, 11, 12, 13];
  const roles = randomizeRolesForUsers(players);

  assert.equal(roles.length, 4);

  const millionaireCount = roles.filter((r) => r.role === 'MILIONARIO').length;
  const poorCount = roles.filter((r) => r.role === 'POBRE').length;

  assert.equal(millionaireCount, 1);
  assert.equal(poorCount, 3);
 
  assert.throws(() => randomizeRolesForUsers([1, 2, 3]), /exatamente 4 jogadores/);

  const selected = pickRandomMissionFromEachPlayer([
    {
      ownerUserId: 1,
      missions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    },
    {
      ownerUserId: 2,
      missions: [{ id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }],
    },
    {
      ownerUserId: 3,
      missions: [{ id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }],
    },
    {
      ownerUserId: 4,
      missions: [{ id: 13 }, { id: 14 }, { id: 15 }, { id: 16 }],
    },
  ]);

  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map((item) => item.ownerUserId)).size, 4);

  assert.throws(
    () =>
      pickRandomMissionFromEachPlayer([
        {
          ownerUserId: 1,
          missions: [{ id: 1 }, { id: 2 }, { id: 3 }],
        },
        {
          ownerUserId: 2,
          missions: [{ id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }],
        },
        {
          ownerUserId: 3,
          missions: [{ id: 8 }, { id: 9 }, { id: 10 }, { id: 11 }],
        },
        {
          ownerUserId: 4,
          missions: [{ id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }],
        },
      ]),
    /exatamente 4 missões/
  );

  assert.equal(
    canMillionaireViewMissions({
      drawDone: true,
      isMillionaire: true,
      allPlayersSubmittedFourMissions: true,
      assignedMissionsCount: 4,
    }),
    true
  );

  assert.equal(
    canMillionaireViewMissions({
      drawDone: false,
      isMillionaire: true,
      allPlayersSubmittedFourMissions: true,
      assignedMissionsCount: 4,
    }),
    false
  );

  assert.equal(
    canMillionaireViewMissions({
      drawDone: true,
      isMillionaire: false,
      allPlayersSubmittedFourMissions: true,
      assignedMissionsCount: 4,
    }),
    false
  );

  assert.equal(
    canMillionaireViewMissions({
      drawDone: true,
      isMillionaire: true,
      allPlayersSubmittedFourMissions: true,
      assignedMissionsCount: 3,
    }),
    false
  );

  assert.equal(
    canMillionaireViewMissions({
      drawDone: true,
      isMillionaire: true,
      allPlayersSubmittedFourMissions: false,
      assignedMissionsCount: 4,
    }),
    false
  );
}

module.exports = {
  runGameLogicTests,
};
