const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const bonjour = require('bonjour')();
const { initDb, run, get, all } = require('./db');
const { generateToken, authMiddleware } = require('./auth');
const {
  randomizeRolesForUsers,
  pickRandomMissionFromEachPlayer,
  canMillionaireViewMissions,
} = require('./gameLogic');

const app = express();
const PORT = process.env.PORT || 3001;
let httpServer;
let bonjourService;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

const GAME_PLAYERS_WHERE = 'is_admin = 0';

const POINTS = {
  CORRECT_VOTE: 2,
  WRONG_VOTE: -1,
  MILLIONAIRE_VOTE_PENALTY: -1,
  COMPLETED_ASSIGNED_MISSION: 1,
};

function sanitizeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    isAdmin: Number(user.is_admin || 0) === 1,
  };
}

function getRequesterOr404(userId, res) {
  const requester = get('SELECT id, username, is_admin FROM users WHERE id = ?', [userId]);
  if (!requester) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return null;
  }
  return requester;
}

function requireAdminOr403(requester, res) {
  if (Number(requester.is_admin) !== 1) {
    res.status(403).json({ error: 'Apenas o admin pode executar esta ação.' });
    return false;
  }
  return true;
}

function getGameState() {
  return get(
    `SELECT id, draw_done, millionaire_user_id, current_round, voting_started, voting_finalized, updated_at
     FROM game_state
     WHERE id = 1`
  );
}

function getCurrentRound() {
  const state = getGameState();
  return Number(state?.current_round || 1);
}

function getGamePlayers() {
  return all(
    `SELECT users.id, users.username, COALESCE(player_points.points, 0) AS points
     FROM users
     LEFT JOIN player_points ON player_points.user_id = users.id
     WHERE ${GAME_PLAYERS_WHERE}
     ORDER BY users.id`
  ).map((row) => ({
    id: Number(row.id),
    username: row.username,
    points: Number(row.points || 0),
  }));
}

function syncPlayerPoints() {
  run(`
    INSERT OR IGNORE INTO player_points (user_id, points)
    SELECT id, 0
    FROM users
    WHERE is_admin = 0;
  `);
}

function adjustPoints(userId, delta) {
  run('UPDATE player_points SET points = points + ? WHERE user_id = ?', [delta, userId]);
}

function getCurrentRole(userId) {
  const roleRow = get('SELECT role FROM player_roles WHERE user_id = ?', [userId]);
  return roleRow ? roleRow.role : null;
}

function hasUserViewedProfile(userId, roundNumber) {
  const view = get(
    'SELECT id FROM round_profile_views WHERE user_id = ? AND round_number = ?',
    [userId, roundNumber]
  );
  return Boolean(view);
}

function hasUserVoted(userId, roundNumber) {
  const vote = get('SELECT id FROM round_votes WHERE voter_user_id = ? AND round_number = ?', [
    userId,
    roundNumber,
  ]);
  return Boolean(vote);
}

function getRoundVotesCount(roundNumber) {
  const countRow = get('SELECT COUNT(*) AS total FROM round_votes WHERE round_number = ?', [roundNumber]);
  return Number(countRow?.total || 0);
}

function getMyVoteTargetUserId(userId, roundNumber) {
  const vote = get(
    'SELECT target_user_id FROM round_votes WHERE voter_user_id = ? AND round_number = ?',
    [userId, roundNumber]
  );
  return vote ? Number(vote.target_user_id) : null;
}

function finalizeVoting(roundNumber, millionaireUserId) {
  const votes = all(
    `SELECT voter_user_id, target_user_id
     FROM round_votes
     WHERE round_number = ?
     ORDER BY id ASC`,
    [roundNumber]
  );

  votes.forEach((vote) => {
    const voterId = Number(vote.voter_user_id);
    const targetId = Number(vote.target_user_id);

    if (targetId === Number(millionaireUserId)) {
      adjustPoints(voterId, POINTS.CORRECT_VOTE);
      adjustPoints(Number(millionaireUserId), POINTS.MILLIONAIRE_VOTE_PENALTY);
    } else {
      adjustPoints(voterId, POINTS.WRONG_VOTE);
    }
  });

  run('UPDATE game_state SET voting_finalized = 1, updated_at = ? WHERE id = 1', [
    new Date().toISOString(),
  ]);
}

function resetRoundState({ resetToRoundOne = false } = {}) {
  const state = getGameState();
  const currentRound = Number(state?.current_round || 1);

  run('DELETE FROM selected_missions');
  run('DELETE FROM player_roles');

  if (resetToRoundOne) {
    run('DELETE FROM round_votes');
    run('DELETE FROM round_profile_views');
  } else {
    run('DELETE FROM round_votes WHERE round_number = ?', [currentRound]);
    run('DELETE FROM round_profile_views WHERE round_number = ?', [currentRound]);
  }

  run(
    'UPDATE game_state SET draw_done = 0, millionaire_user_id = NULL, voting_started = 0, voting_finalized = 0, current_round = ?, updated_at = ? WHERE id = 1',
    [resetToRoundOne ? 1 : currentRound, new Date().toISOString()]
  );
}

function ensureRolesDrawn(roundNumber) {
  const users = getGamePlayers();
  if (users.length !== 4) {
    throw new Error('É necessário ter 4 jogadores cadastrados para revelar perfil.');
  }

  const state = getGameState();
  if (Number(state.draw_done) === 1) {
    return;
  }

  const roles = randomizeRolesForUsers(users.map((u) => Number(u.id)));

  run('DELETE FROM player_roles');
  roles.forEach((role) => {
    run('INSERT INTO player_roles (user_id, role) VALUES (?, ?)', [role.userId, role.role]);
  });

  const millionaire = roles.find((r) => r.role === 'MILIONARIO');

  run(
    'UPDATE game_state SET draw_done = 1, millionaire_user_id = ?, voting_started = 0, voting_finalized = 0, updated_at = ? WHERE id = 1',
    [millionaire.userId, new Date().toISOString()]
  );

  run('DELETE FROM selected_missions');
  run('DELETE FROM round_votes WHERE round_number = ?', [roundNumber]);
}

function mapMissionRow(row) {
  return {
    id: Number(row.id),
    ownerUserId: Number(row.owner_user_id),
    ownerUsername: row.username,
    content: row.content,
    createdAt: row.created_at,
  };
}

function getAllMissions() {
  return all(
    `SELECT missions.id, missions.owner_user_id, missions.content, missions.created_at, users.username
     FROM missions
     INNER JOIN users ON users.id = missions.owner_user_id
     WHERE users.is_admin = 0
     ORDER BY missions.created_at ASC`
  ).map(mapMissionRow);
}

function getSelectedMissions() {
  return all(
    `SELECT selected_missions.id,
            selected_missions.owner_user_id,
            selected_missions.mission_id,
            selected_missions.millionaire_user_id,
            selected_missions.drawn_at,
            selected_missions.completed,
            missions.content,
            missions.created_at,
            users.username
     FROM selected_missions
     INNER JOIN missions ON missions.id = selected_missions.mission_id
     INNER JOIN users ON users.id = selected_missions.owner_user_id
    WHERE users.is_admin = 0
     ORDER BY selected_missions.owner_user_id ASC`
  ).map((row) => ({
    id: Number(row.id),
    missionId: Number(row.mission_id),
    ownerUserId: Number(row.owner_user_id),
    ownerUsername: row.username,
    millionaireUserId: Number(row.millionaire_user_id),
    content: row.content,
    createdAt: row.created_at,
    drawnAt: row.drawn_at,
    completed: Number(row.completed) === 1,
  }));
}

function allPlayersSubmittedFourMissions(users, missions) {
  if (users.length !== 4) return false;

  const countByUser = users.reduce((acc, user) => {
    acc[Number(user.id)] = 0;
    return acc;
  }, {});

  missions.forEach((mission) => {
    if (Object.prototype.hasOwnProperty.call(countByUser, mission.ownerUserId)) {
      countByUser[mission.ownerUserId] += 1;
    }
  });

  return users.every((user) => countByUser[Number(user.id)] === 4);
}

function generateMissionAssignments({ millionaireUserId, users }) {
  const missionsByPlayer = users.map((user) => {
    const missions = all(
      `SELECT id, owner_user_id, content, created_at
       FROM missions
       WHERE owner_user_id = ?
         AND assigned_to_millionaire = 0
       ORDER BY id ASC`,
      [user.id]
    ).map((mission) => ({
      id: Number(mission.id),
      ownerUserId: Number(mission.owner_user_id),
      content: mission.content,
      createdAt: mission.created_at,
    }));

    return {
      ownerUserId: Number(user.id),
      missions,
    };
  });

  const playerWithoutAvailableMission = missionsByPlayer.find((player) => player.missions.length === 0);
  if (playerWithoutAvailableMission) {
    throw new Error(
      'Não há missões inéditas suficientes para todos os jogadores nesta rodada. Cadastre novas missões para continuar.'
    );
  }

  const selected = pickRandomMissionFromEachPlayer(missionsByPlayer);
  const drawnAt = new Date().toISOString();

  run('DELETE FROM selected_missions');
  selected.forEach((item) => {
    run(
      `INSERT INTO selected_missions (millionaire_user_id, owner_user_id, mission_id, drawn_at, completed)
       VALUES (?, ?, ?, ?, 0)`,
      [millionaireUserId, item.ownerUserId, item.mission.id, drawnAt]
    );
    run('UPDATE missions SET assigned_to_millionaire = 1 WHERE id = ?', [item.mission.id]);
  });
}

function getStateForUser(userId) {
  syncPlayerPoints();

  const users = getGamePlayers();
  const me = get('SELECT id, username, is_admin FROM users WHERE id = ?', [userId]);
  const isAdmin = me && Number(me.is_admin) === 1;
  const state = getGameState();
  const currentRound = Number(state.current_round || 1);
  const missions = getAllMissions();
  const selectedMissions = getSelectedMissions();
  const myMissionsRaw = all(
    `SELECT missions.id, missions.owner_user_id, missions.content, missions.created_at, users.username
     FROM missions
     INNER JOIN users ON users.id = missions.owner_user_id
     WHERE missions.owner_user_id = ?
     ORDER BY missions.created_at ASC`,
    [userId]
  );

  const profileViewed = isAdmin ? true : hasUserViewedProfile(userId, currentRound);
  const meRoleRaw = isAdmin ? 'POBRE' : getCurrentRole(userId);
  const meRole = isAdmin || profileViewed ? meRoleRaw : null;
  const drawDone = Number(state.draw_done) === 1;
  const missionsCount = missions.length;
  const myMissions = myMissionsRaw.map(mapMissionRow);
  const completedAllFour = allPlayersSubmittedFourMissions(users, missions);
  const isMillionaire = meRole === 'MILIONARIO';
  const isPoor = meRoleRaw === 'POBRE';
  const canViewAll = canMillionaireViewMissions({
    drawDone,
    isMillionaire: meRoleRaw === 'MILIONARIO' && profileViewed,
    allPlayersSubmittedFourMissions: completedAllFour,
    assignedMissionsCount: selectedMissions.length,
  });

  const millionaireCountRow = get("SELECT COUNT(*) AS total FROM player_roles WHERE role = 'MILIONARIO'");
  const millionaireCount = Number(millionaireCountRow?.total || 0);

  const pointsRow = get('SELECT points FROM player_points WHERE user_id = ?', [userId]);
  const myPoints = Number(pointsRow?.points || 0);

  const viewsCountRow = get('SELECT COUNT(*) AS total FROM round_profile_views WHERE round_number = ?', [
    currentRound,
  ]);
  const allPlayersViewedProfiles =
    users.length === 4 && Number(viewsCountRow?.total || 0) === 4;

  const votingStarted = Number(state.voting_started) === 1;
  const votingFinalized = Number(state.voting_finalized) === 1;
  const hasVoted = !isAdmin && isPoor && hasUserVoted(userId, currentRound);
  const myVoteTargetUserId = hasVoted ? getMyVoteTargetUserId(userId, currentRound) : null;
  const votesCount = getRoundVotesCount(currentRound);

  const completedAssignedMissionsCount = selectedMissions.filter((m) => m.completed).length;
  const allAssignedMissionsCompleted =
    selectedMissions.length === 4 && completedAssignedMissionsCount === 4;

  const adminData = isAdmin
    ? {
        millionaireCount,
        players: users.map((u) => ({
          id: Number(u.id),
          username: u.username,
          points: Number(u.points || 0),
        })),
        missions: missions.map((mission) => ({
          id: mission.id,
          ownerUserId: mission.ownerUserId,
          ownerUsername: mission.ownerUsername,
        })),
        assignedMissions: selectedMissions.map((mission) => ({
          id: mission.id,
          missionId: mission.missionId,
          ownerUserId: mission.ownerUserId,
          ownerUsername: mission.ownerUsername,
          completed: Boolean(mission.completed),
        })),
      }
    : null;

  return {
    gameName: 'O Milionario',
    currentRound,
    totalPlayers: users.length,
    isReadyToDraw: users.length === 4,
    isAdmin,
    drawDone,
    profileViewed,
    millionaireUserId: state.millionaire_user_id ? Number(state.millionaire_user_id) : null,
    myRole: meRole,
    myPoints,
    myMissions,
    myMissionsCount: myMissions.length,
    maxMissionsPerPlayer: 4,
    requiredTotalMissions: 16,
    missionsCount,
    allPlayersSubmittedMissions: completedAllFour,
    allPlayersViewedProfiles,
    votingStarted,
    votingFinalized,
    votesCount,
    hasVoted,
    myVoteTargetUserId,
    completedAssignedMissionsCount,
    allAssignedMissionsCompleted,
    missionsVisibleToMillionaire: canViewAll
      ? selectedMissions
      : [],
    players: users.map((u) => ({
      id: Number(u.id),
      username: u.username,
      points: Number(u.points || 0),
    })),
    adminData,
  };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    if (String(username).trim().length < 3 || String(password).length < 4) {
      return res
        .status(400)
        .json({ error: 'Usuário deve ter ao menos 3 caracteres e senha ao menos 4.' });
    }

    if (String(username).trim().toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Este usuário é reservado.' });
    }

    const usersCountRow = get(`SELECT COUNT(*) AS total FROM users WHERE ${GAME_PLAYERS_WHERE}`);
    if (Number(usersCountRow.total) >= 4) {
      return res.status(400).json({ error: 'Limite de 4 jogadores já foi atingido.' });
    }

    const exists = get('SELECT id FROM users WHERE username = ?', [String(username).trim()]);
    if (exists) {
      return res.status(409).json({ error: 'Este usuário já existe.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    run('INSERT INTO users (username, is_admin, password_hash, created_at) VALUES (?, 0, ?, ?)', [
      String(username).trim(),
      passwordHash,
      new Date().toISOString(),
    ]);

    const created = get('SELECT id, username, is_admin FROM users WHERE username = ?', [
      String(username).trim(),
    ]);

    run('INSERT OR IGNORE INTO player_points (user_id, points) VALUES (?, 0)', [created.id]);

    const token = generateToken(created);

    return res.status(201).json({ user: sanitizeUser(created), token });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao cadastrar.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    const user = get('SELECT id, username, is_admin, password_hash FROM users WHERE username = ?', [
      String(username).trim(),
    ]);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = generateToken(user);
    return res.json({ user: sanitizeUser(user), token });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao logar.' });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = get('SELECT id, username, is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.get('/api/game/state', authMiddleware, (req, res) => {
  const user = get('SELECT id FROM users WHERE id = ?', [req.user.id]);
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  return res.json(getStateForUser(req.user.id));
});

app.post('/api/game/draw', authMiddleware, (req, res) => {
  try {
    const currentRound = getCurrentRound();
    ensureRolesDrawn(currentRound);
    const myRole = getCurrentRole(req.user.id);

    return res.json({
      message: 'Sorteio realizado com sucesso!',
      myRole,
      drawDone: true,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao realizar sorteio.' });
  }
});

app.post('/api/game/reveal-profile', authMiddleware, (req, res) => {
  try {
    const requester = getRequesterOr404(req.user.id, res);
    if (!requester) {
      return undefined;
    }

    if (Number(requester.is_admin) === 1) {
      return res.status(400).json({ error: 'O admin não precisa revelar perfil.' });
    }

    const currentRound = getCurrentRound();
    ensureRolesDrawn(currentRound);

    if (!hasUserViewedProfile(req.user.id, currentRound)) {
      run(
        'INSERT OR REPLACE INTO round_profile_views (round_number, user_id, viewed_at) VALUES (?, ?, ?)',
        [currentRound, req.user.id, new Date().toISOString()]
      );
    }

    const myRole = getCurrentRole(req.user.id);
    return res.json({
      message: `Perfil revelado: ${myRole}`,
      myRole,
      profileViewed: true,
      currentRound,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao revelar perfil.' });
  }
});

app.post('/api/rounds/start-voting', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não participa da votação.' });
  }

  const state = getGameState();
  const currentRound = Number(state.current_round || 1);

  if (Number(state.draw_done) !== 1) {
    return res.status(400).json({ error: 'A rodada precisa ter perfis revelados antes de iniciar votação.' });
  }

  const players = getGamePlayers();
  const viewsCountRow = get('SELECT COUNT(*) AS total FROM round_profile_views WHERE round_number = ?', [
    currentRound,
  ]);

  if (players.length !== 4 || Number(viewsCountRow?.total || 0) !== 4) {
    return res.status(400).json({
      error: 'Todos os 4 jogadores precisam clicar em "Ver seu perfil" antes da votação.',
    });
  }

  if (Number(state.voting_started) === 1) {
    return res.status(400).json({ error: 'A votação desta rodada já foi iniciada.' });
  }

  run('UPDATE game_state SET voting_started = 1, voting_finalized = 0, updated_at = ? WHERE id = 1', [
    new Date().toISOString(),
  ]);

  return res.json({ message: 'Votação iniciada com sucesso.' });
});

app.post('/api/rounds/vote', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não participa da votação.' });
  }

  const { targetUserId } = req.body || {};
  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ error: 'Jogador alvo inválido para votação.' });
  }

  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Você não pode votar em si mesmo.' });
  }

  const state = getGameState();
  const currentRound = Number(state.current_round || 1);

  if (Number(state.millionaire_user_id) === Number(req.user.id)) {
    return res.status(403).json({ error: 'O milionário não pode votar nesta rodada.' });
  }

  if (Number(state.draw_done) !== 1) {
    return res.status(400).json({ error: 'A rodada ainda não está pronta para votação.' });
  }

  if (Number(state.voting_started) !== 1) {
    return res.status(400).json({ error: 'A votação ainda não foi iniciada.' });
  }

  if (Number(state.voting_finalized) === 1) {
    return res.status(400).json({ error: 'A votação desta rodada já foi finalizada.' });
  }

  if (hasUserVoted(req.user.id, currentRound)) {
    return res.status(409).json({ error: 'Você já votou nesta rodada.' });
  }

  const targetPlayer = get(`SELECT id FROM users WHERE id = ? AND ${GAME_PLAYERS_WHERE}`, [targetId]);
  if (!targetPlayer) {
    return res.status(404).json({ error: 'Jogador alvo não encontrado para votação.' });
  }

  run(
    'INSERT INTO round_votes (round_number, voter_user_id, target_user_id, created_at) VALUES (?, ?, ?, ?)',
    [currentRound, req.user.id, targetId, new Date().toISOString()]
  );

  const votesCount = getRoundVotesCount(currentRound);
  const players = getGamePlayers();
  const expectedVotes = Math.max(0, players.length - 1);

  if (votesCount === expectedVotes) {
    finalizeVoting(currentRound, Number(state.millionaire_user_id));
    return res.json({
      message: 'Voto registrado. Todos votaram e a pontuação da rodada foi processada.',
      votingFinalized: true,
    });
  }

  return res.json({ message: 'Voto registrado com sucesso.' });
});

app.post('/api/game/mission', authMiddleware, (req, res) => {
  try {
    const requester = get('SELECT id, is_admin FROM users WHERE id = ?', [req.user.id]);
    if (!requester) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const { content } = req.body;

    if (!content || String(content).trim().length < 5) {
      return res
        .status(400)
        .json({ error: 'A missão é obrigatória e precisa ter ao menos 5 caracteres.' });
    }

    const usersCount = get(`SELECT COUNT(*) AS total FROM users WHERE ${GAME_PLAYERS_WHERE}`);
    if (Number(usersCount.total) !== 4) {
      return res.status(400).json({ error: 'As missões só podem ser cadastradas quando houver 4 jogadores.' });
    }

    const mineCount = get('SELECT COUNT(*) AS total FROM missions WHERE owner_user_id = ?', [req.user.id]);
    if (Number(mineCount.total) >= 4) {
      return res.status(409).json({ error: 'Você já cadastrou suas 4 missões.' });
    }

    run('INSERT INTO missions (owner_user_id, content, created_at) VALUES (?, ?, ?)', [
      req.user.id,
      String(content).trim(),
      new Date().toISOString(),
    ]);

    return res.status(201).json({
      message: 'Missão cadastrada com sucesso.',
      myMissionsCount: Number(mineCount.total) + 1,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao cadastrar missão.' });
  }
});

app.put('/api/game/missions/:missionId', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não pode editar missões por esta rota.' });
  }

  const currentRound = getCurrentRound();

  if (hasUserViewedProfile(req.user.id, currentRound)) {
    return res.status(403).json({
      error: 'Não é possível editar missões após clicar em ver seu perfil.',
    });
  }

  const missionId = Number(req.params.missionId);
  if (!Number.isInteger(missionId)) {
    return res.status(400).json({ error: 'ID de missão inválido.' });
  }

  const mission = get('SELECT id, owner_user_id FROM missions WHERE id = ?', [missionId]);
  if (!mission) {
    return res.status(404).json({ error: 'Missão não encontrada.' });
  }

  if (Number(mission.owner_user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Você só pode editar suas próprias missões.' });
  }

  const { content } = req.body;
  if (!content || String(content).trim().length < 5) {
    return res.status(400).json({ error: 'A missão precisa ter ao menos 5 caracteres.' });
  }

  run('UPDATE missions SET content = ? WHERE id = ?', [String(content).trim(), missionId]);
  run('DELETE FROM selected_missions WHERE mission_id = ?', [missionId]);

  return res.json({ message: 'Missão atualizada com sucesso.' });
});

app.delete('/api/game/missions/:missionId', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não pode remover missões por esta rota.' });
  }

  const currentRound = getCurrentRound();

  if (hasUserViewedProfile(req.user.id, currentRound)) {
    return res.status(403).json({
      error: 'Não é possível remover missões após clicar em ver seu perfil.',
    });
  }

  const missionId = Number(req.params.missionId);
  if (!Number.isInteger(missionId)) {
    return res.status(400).json({ error: 'ID de missão inválido.' });
  }

  const mission = get('SELECT id, owner_user_id FROM missions WHERE id = ?', [missionId]);
  if (!mission) {
    return res.status(404).json({ error: 'Missão não encontrada.' });
  }

  if (Number(mission.owner_user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Você só pode remover suas próprias missões.' });
  }

  run('DELETE FROM selected_missions WHERE mission_id = ? OR owner_user_id = ?', [
    missionId,
    req.user.id,
  ]);
  run('DELETE FROM missions WHERE id = ?', [missionId]);

  return res.json({ message: 'Missão removida com sucesso.' });
});

app.get('/api/game/missions', authMiddleware, (req, res) => {
  const users = all(`SELECT id FROM users WHERE ${GAME_PLAYERS_WHERE} ORDER BY id`);
  const state = getStateForUser(req.user.id);

  if (state.myRole !== 'MILIONARIO') {
    return res.status(403).json({ error: 'Apenas o milionário pode ver as missões de todos.' });
  }

  if (!state.drawDone || !state.allPlayersSubmittedMissions) {
    return res.status(400).json({
      error:
        'O milionário só poderá ver as missões quando o sorteio ocorrer e os 4 jogadores cadastrarem 4 missões cada (16 no total).',
    });
  }

  if (users.length !== 4) {
    return res.status(400).json({ error: 'É necessário ter exatamente 4 jogadores.' });
  }

  let selectedMissions = getSelectedMissions();

  if (selectedMissions.length !== 4) {
    try {
      generateMissionAssignments({ millionaireUserId: req.user.id, users });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Erro ao sortear missões.' });
    }
    selectedMissions = getSelectedMissions();
  }

  return res.json({ missions: selectedMissions });
});

app.post('/api/rounds/assigned-missions/:assignmentId/complete', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não participa da rodada.' });
  }

  const state = getGameState();
  if (Number(state.draw_done) !== 1) {
    return res.status(400).json({ error: 'A rodada ainda não foi iniciada.' });
  }

  if (Number(state.millionaire_user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Apenas o milionário pode concluir missões atribuídas.' });
  }

  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId)) {
    return res.status(400).json({ error: 'ID de atribuição de missão inválido.' });
  }

  const assignment = get(
    'SELECT id, millionaire_user_id, completed FROM selected_missions WHERE id = ?',
    [assignmentId]
  );

  if (!assignment) {
    return res.status(404).json({ error: 'Missão atribuída não encontrada.' });
  }

  if (Number(assignment.millionaire_user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Você só pode concluir missões atribuídas para você.' });
  }

  if (Number(assignment.completed) === 1) {
    return res.status(409).json({ error: 'Esta missão já foi marcada como concluída.' });
  }

  run('UPDATE selected_missions SET completed = 1 WHERE id = ?', [assignmentId]);
  adjustPoints(req.user.id, POINTS.COMPLETED_ASSIGNED_MISSION);

  return res.json({ message: 'Missão marcada como concluída.' });
});

app.post('/api/rounds/next', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (Number(requester.is_admin) === 1) {
    return res.status(403).json({ error: 'Admin não participa da rodada.' });
  }

  const state = getGameState();
  const currentRound = Number(state.current_round || 1);

  if (Number(state.draw_done) !== 1) {
    return res.status(400).json({ error: 'A rodada atual ainda não foi iniciada.' });
  }

  if (Number(state.voting_finalized) !== 1) {
    return res.status(400).json({ error: 'A votação da rodada precisa estar finalizada para avançar.' });
  }

  const selectedMissions = getSelectedMissions();
  if (selectedMissions.length !== 4) {
    return res.status(400).json({
      error: 'As 4 missões da rodada precisam estar atribuídas antes de iniciar uma nova rodada.',
    });
  }

  run('DELETE FROM selected_missions');
  run('DELETE FROM player_roles');

  const nextRound = currentRound + 1;
  run(
    'UPDATE game_state SET current_round = ?, draw_done = 0, millionaire_user_id = NULL, voting_started = 0, voting_finalized = 0, updated_at = ? WHERE id = 1',
    [nextRound, new Date().toISOString()]
  );

  return res.json({
    message: `Nova rodada iniciada com sucesso (Rodada ${nextRound}). Agora cada jogador deve clicar em "Ver seu perfil".`,
    currentRound: nextRound,
  });
});

app.post('/api/game/reset', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  run('DELETE FROM missions');
  run('UPDATE player_points SET points = 0');
  resetRoundState({ resetToRoundOne: true });

  return res.json({ message: 'Reset concluído: sorteio, missões, rodadas e pontos zerados.' });
});

app.delete('/api/admin/players/:playerId', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId)) {
    return res.status(400).json({ error: 'ID de jogador inválido.' });
  }

  const player = get('SELECT id, is_admin FROM users WHERE id = ?', [playerId]);
  if (!player) {
    return res.status(404).json({ error: 'Jogador não encontrado.' });
  }

  if (Number(player.is_admin) === 1) {
    return res.status(400).json({ error: 'Não é permitido remover o usuário admin.' });
  }

  run('DELETE FROM selected_missions WHERE owner_user_id = ? OR millionaire_user_id = ?', [
    playerId,
    playerId,
  ]);
  run('DELETE FROM round_profile_views WHERE user_id = ?', [playerId]);
  run('DELETE FROM round_votes WHERE voter_user_id = ? OR target_user_id = ?', [playerId, playerId]);
  run('DELETE FROM missions WHERE owner_user_id = ?', [playerId]);
  run('DELETE FROM player_roles WHERE user_id = ?', [playerId]);
  run('DELETE FROM player_points WHERE user_id = ?', [playerId]);
  run('DELETE FROM users WHERE id = ?', [playerId]);

  resetRoundState();

  return res.json({
    message: 'Jogador removido com sucesso. Sorteio da rodada foi reiniciado.',
  });
});

app.delete('/api/admin/missions/:missionId', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const missionId = Number(req.params.missionId);
  if (!Number.isInteger(missionId)) {
    return res.status(400).json({ error: 'ID de missão inválido.' });
  }

  const mission = get('SELECT missions.id, missions.owner_user_id FROM missions WHERE missions.id = ?', [
    missionId,
  ]);

  if (!mission) {
    return res.status(404).json({ error: 'Missão não encontrada.' });
  }

  run('DELETE FROM selected_missions WHERE mission_id = ? OR owner_user_id = ?', [
    missionId,
    mission.owner_user_id,
  ]);
  run('DELETE FROM missions WHERE id = ?', [missionId]);

  return res.json({
    message: 'Missão removida com sucesso.',
  });
});

app.put('/api/admin/players/:playerId/password', authMiddleware, async (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId)) {
    return res.status(400).json({ error: 'ID de jogador inválido.' });
  }

  const player = get('SELECT id, is_admin FROM users WHERE id = ?', [playerId]);
  if (!player) {
    return res.status(404).json({ error: 'Jogador não encontrado.' });
  }

  if (Number(player.is_admin) === 1) {
    return res.status(400).json({ error: 'Não é permitido resetar senha do usuário admin por esta rota.' });
  }

  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 4 caracteres.' });
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, playerId]);

  return res.json({ message: 'Senha redefinida com sucesso.' });
});

app.put('/api/admin/game/current-round', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const { currentRound } = req.body || {};
  const nextRound = Number(currentRound);
  if (!Number.isInteger(nextRound) || nextRound < 1) {
    return res.status(400).json({ error: 'Rodada atual inválida. Informe um número inteiro maior ou igual a 1.' });
  }

  run('UPDATE game_state SET current_round = ?, updated_at = ? WHERE id = 1', [
    nextRound,
    new Date().toISOString(),
  ]);

  return res.json({ message: `Rodada atual definida para ${nextRound}.` });
});

app.put('/api/admin/players/:playerId/points', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId)) {
    return res.status(400).json({ error: 'ID de jogador inválido.' });
  }

  const player = get(`SELECT id, is_admin FROM users WHERE id = ? AND ${GAME_PLAYERS_WHERE}`, [playerId]);
  if (!player) {
    return res.status(404).json({ error: 'Jogador não encontrado.' });
  }

  const { points } = req.body || {};
  const nextPoints = Number(points);
  if (!Number.isInteger(nextPoints)) {
    return res.status(400).json({ error: 'Pontuação inválida. Informe um número inteiro.' });
  }

  run('INSERT OR IGNORE INTO player_points (user_id, points) VALUES (?, 0)', [playerId]);
  run('UPDATE player_points SET points = ? WHERE user_id = ?', [nextPoints, playerId]);

  return res.json({ message: 'Pontuação do jogador atualizada com sucesso.' });
});

app.put('/api/admin/assigned-missions/:assignmentId/completed', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId)) {
    return res.status(400).json({ error: 'ID de missão atribuída inválido.' });
  }

  const assignment = get('SELECT id FROM selected_missions WHERE id = ?', [assignmentId]);
  if (!assignment) {
    return res.status(404).json({ error: 'Missão atribuída não encontrada.' });
  }

  const { completed } = req.body || {};
  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'Valor de conclusão inválido. Informe true ou false.' });
  }

  run('UPDATE selected_missions SET completed = ? WHERE id = ?', [completed ? 1 : 0, assignmentId]);

  return res.json({
    message: completed
      ? 'Missão atribuída marcada como concluída.'
      : 'Missão atribuída marcada como pendente.',
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'index.html'));
});

async function start() {
  await initDb();
  httpServer = app.listen(PORT, () => {
    bonjourService = bonjour.publish({
      name: 'milionario',
      type: 'http',
      port: Number(PORT),
    });

    // eslint-disable-next-line no-console
    console.log(`Servidor do Milionario rodando em http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log('Serviço Bonjour publicado como "milionario".');
  });

  const shutdown = () => {
    if (bonjourService) {
      bonjourService.stop(() => {
        bonjour.destroy();
      });
      bonjourService = null;
    } else {
      bonjour.destroy();
    }

    if (httpServer) {
      httpServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
};
