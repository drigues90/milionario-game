const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initDb, run, get, all } = require('./db');
const { generateToken, authMiddleware } = require('./auth');
const {
  randomizeRolesForUsers,
  pickRandomMissionFromEachPlayer,
  canMillionaireViewMissions,
} = require('./gameLogic');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

const GAME_PLAYERS_WHERE = 'is_admin = 0';

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

function getCurrentRole(userId) {
  const roleRow = get('SELECT role FROM player_roles WHERE user_id = ?', [userId]);
  return roleRow ? roleRow.role : null;
}

function hasUserViewedProfile(userId) {
  const view = get('SELECT user_id FROM profile_views WHERE user_id = ?', [userId]);
  return Boolean(view);
}

function resetRoundState() {
  run('DELETE FROM selected_missions');
  run('DELETE FROM player_roles');
  run('DELETE FROM profile_views');
  run('UPDATE game_state SET draw_done = 0, millionaire_user_id = NULL, updated_at = ? WHERE id = 1', [
    new Date().toISOString(),
  ]);
}

function ensureRolesDrawn() {
  const users = all(`SELECT id FROM users WHERE ${GAME_PLAYERS_WHERE} ORDER BY id`);
  if (users.length !== 4) {
    throw new Error('É necessário ter 4 jogadores cadastrados para revelar perfil.');
  }

  const state = get('SELECT draw_done FROM game_state WHERE id = 1');
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
    'UPDATE game_state SET draw_done = 1, millionaire_user_id = ?, updated_at = ? WHERE id = 1',
    [millionaire.userId, new Date().toISOString()]
  );

  run('DELETE FROM selected_missions');
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

  const selected = pickRandomMissionFromEachPlayer(missionsByPlayer);
  const drawnAt = new Date().toISOString();

  run('DELETE FROM selected_missions');
  selected.forEach((item) => {
    run(
      `INSERT INTO selected_missions (millionaire_user_id, owner_user_id, mission_id, drawn_at)
       VALUES (?, ?, ?, ?)`,
      [millionaireUserId, item.ownerUserId, item.mission.id, drawnAt]
    );
  });
}

function getStateForUser(userId) {
  const users = all(`SELECT id, username FROM users WHERE ${GAME_PLAYERS_WHERE} ORDER BY id`);
  const me = get('SELECT id, username, is_admin FROM users WHERE id = ?', [userId]);
  const isAdmin = me && Number(me.is_admin) === 1;
  const state = get('SELECT draw_done, millionaire_user_id FROM game_state WHERE id = 1');
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

  const profileViewed = isAdmin ? true : hasUserViewedProfile(userId);
  const meRoleRaw = isAdmin ? 'POBRE' : getCurrentRole(userId);
  const meRole = isAdmin || profileViewed ? meRoleRaw : null;
  const drawDone = Number(state.draw_done) === 1;
  const missionsCount = missions.length;
  const myMissions = myMissionsRaw.map(mapMissionRow);
  const completedAllFour = allPlayersSubmittedFourMissions(users, missions);
  const isMillionaire = meRole === 'MILIONARIO';
  const canViewAll = canMillionaireViewMissions({
    drawDone,
    isMillionaire: meRoleRaw === 'MILIONARIO' && profileViewed,
    allPlayersSubmittedFourMissions: completedAllFour,
    assignedMissionsCount: selectedMissions.length,
  });

  const millionaireCountRow = get("SELECT COUNT(*) AS total FROM player_roles WHERE role = 'MILIONARIO'");
  const millionaireCount = Number(millionaireCountRow?.total || 0);

  const adminData = isAdmin
    ? {
        millionaireCount,
        players: users.map((u) => ({
          id: Number(u.id),
          username: u.username,
        })),
        missions: missions.map((mission) => ({
          id: mission.id,
          ownerUserId: mission.ownerUserId,
          ownerUsername: mission.ownerUsername,
        })),
      }
    : null;

  return {
    gameName: 'O Milionario',
    totalPlayers: users.length,
    isReadyToDraw: users.length === 4,
    isAdmin,
    drawDone,
  profileViewed,
    millionaireUserId: state.millionaire_user_id ? Number(state.millionaire_user_id) : null,
    myRole: meRole,
    myMissions,
    myMissionsCount: myMissions.length,
    maxMissionsPerPlayer: 4,
    requiredTotalMissions: 16,
    missionsCount,
    allPlayersSubmittedMissions: completedAllFour,
    missionsVisibleToMillionaire: canViewAll
      ? selectedMissions
      : [],
    players: users.map((u) => ({
      id: Number(u.id),
      username: u.username,
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
    ensureRolesDrawn();
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

    ensureRolesDrawn();

    if (!hasUserViewedProfile(req.user.id)) {
      run('INSERT OR REPLACE INTO profile_views (user_id, viewed_at) VALUES (?, ?)', [
        req.user.id,
        new Date().toISOString(),
      ]);
    }

    const myRole = getCurrentRole(req.user.id);
    return res.json({
      message: `Perfil revelado: ${myRole}`,
      myRole,
      profileViewed: true,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao revelar perfil.' });
  }
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

  if (hasUserViewedProfile(req.user.id)) {
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

  if (hasUserViewedProfile(req.user.id)) {
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
    generateMissionAssignments({ millionaireUserId: req.user.id, users });
    selectedMissions = getSelectedMissions();
  }

  return res.json({ missions: selectedMissions });
});

app.post('/api/game/reset', authMiddleware, (req, res) => {
  const requester = getRequesterOr404(req.user.id, res);
  if (!requester) {
    return undefined;
  }

  if (!requireAdminOr403(requester, res)) {
    return undefined;
  }

  run('DELETE FROM selected_missions');
  run('DELETE FROM missions');
  resetRoundState();

  return res.json({ message: 'Reset concluído: sorteio e missões zerados.' });
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
  run('DELETE FROM profile_views WHERE user_id = ?', [playerId]);
  run('DELETE FROM missions WHERE owner_user_id = ?', [playerId]);
  run('DELETE FROM player_roles WHERE user_id = ?', [playerId]);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'index.html'));
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Servidor do Milionario rodando em http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
};
