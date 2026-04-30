const { useEffect, useMemo, useState } = React;

const API_BASE = '/api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('milionario_token') || '');
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('milionario_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [state, setState] = useState(null);
  const [missionText, setMissionText] = useState('');
  const [editingMissionId, setEditingMissionId] = useState(null);
  const [editingMissionText, setEditingMissionText] = useState('');
  const [voteTargetUserId, setVoteTargetUserId] = useState('');
  const [adminRoundInput, setAdminRoundInput] = useState('1');
  const [adminPointsByPlayer, setAdminPointsByPlayer] = useState({});
  const [adminPasswordByPlayer, setAdminPasswordByPlayer] = useState({});
  const [isDevelopmentMode, setIsDevelopmentMode] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isLogged = Boolean(token && user);

  async function api(path, method = 'GET', body) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao comunicar com o servidor.');
    }

    return data;
  }

  async function refreshState() {
    if (!token) return;
    try {
      const data = await api('/game/state');
      setState(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!token) return;

    refreshState();
    const interval = setInterval(refreshState, 4000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    api('/runtime')
      .then((data) => {
        if (cancelled) return;
        setIsDevelopmentMode(Boolean(data?.isDevelopment));
      })
      .catch(() => {
        if (cancelled) return;
        setIsDevelopmentMode(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Falha ao registrar service worker:', err);
      });
    };

    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  useEffect(() => {
    if (!state?.isAdmin) return;

    setAdminRoundInput(String(state?.currentRound || 1));
    const nextPoints = {};
    (state?.adminData?.players || []).forEach((player) => {
      nextPoints[player.id] = String(player.points ?? 0);
    });
    setAdminPointsByPlayer(nextPoints);
  }, [state?.isAdmin, state?.currentRound, state?.adminData?.players]);

  function persistSession(authData) {
    setToken(authData.token);
    setUser(authData.user);
    localStorage.setItem('milionario_token', authData.token);
    localStorage.setItem('milionario_user', JSON.stringify(authData.user));
  }

  function clearFeedback() {
    setError('');
    setMessage('');
  }

  async function handleAuth(event) {
    event.preventDefault();
    clearFeedback();

    if (!username.trim() || !password) {
      setError('Informe usuário e senha.');
      return;
    }

    setLoading(true);
    try {
      const route = authMode === 'login' ? '/auth/login' : '/auth/register';
      const data = await api(route, 'POST', {
        username: username.trim(),
        password,
      });
      persistSession(data);
      setUsername('');
      setPassword('');
      setMessage(authMode === 'login' ? 'Login realizado!' : 'Cadastro realizado!');
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevealProfile() {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api('/game/reveal-profile', 'POST');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefuseMillionaire() {
    clearFeedback();

    const confirmed = window.confirm(
      'Deseja recusar ser o milionário nesta rodada? O sorteio será liberado novamente para todos.'
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api('/rounds/refuse-millionaire', 'POST');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMissionSubmit(event) {
    event.preventDefault();
    clearFeedback();

    setLoading(true);
    try {
      const result = await api('/game/mission', 'POST', { content: missionText });
      setMessage(result.message);
      setMissionText('');
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMissionEditSubmit(event, missionId) {
    event.preventDefault();
    clearFeedback();

    setLoading(true);
    try {
      const result = await api(`/game/missions/${missionId}`, 'PUT', { content: editingMissionText });
      setMessage(result.message);
      setEditingMissionId(null);
      setEditingMissionText('');
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMissionRemove(missionId) {
    clearFeedback();

    const confirmed = window.confirm('Deseja remover esta missão?');
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api(`/game/missions/${missionId}`, 'DELETE');
      setMessage(result.message);
      if (editingMissionId === missionId) {
        setEditingMissionId(null);
        setEditingMissionText('');
      }
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMillionaireMissions() {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api('/game/missions');
      setState((prev) => ({
        ...prev,
        missionsVisibleToMillionaire: result.missions,
      }));
      setMessage('Missões carregadas com sucesso.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartVoting() {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api('/rounds/start-voting', 'POST');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVoteSubmit(event) {
    event.preventDefault();
    clearFeedback();

    if (!voteTargetUserId) {
      setError('Selecione um jogador para votar.');
      return;
    }

    setLoading(true);
    try {
      const result = await api('/rounds/vote', 'POST', { targetUserId: Number(voteTargetUserId) });
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCompleteAssignedMission(assignmentId) {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api(`/rounds/assigned-missions/${assignmentId}/complete`, 'POST');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartNextRound() {
    clearFeedback();

    const confirmed = window.confirm('Deseja iniciar a próxima rodada? Isso fará um novo sorteio de perfis.');
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api('/rounds/next', 'POST');
      setMessage(result.message);
      setVoteTargetUserId('');
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetGame() {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api('/game/reset', 'POST');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemovePlayer(playerId, playerUsername) {
    clearFeedback();

    const confirmed = window.confirm(`Deseja remover o jogador ${playerUsername}?`);
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api(`/admin/players/${playerId}`, 'DELETE');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminResetProfiles() {
    clearFeedback();

    const confirmed = window.confirm(
      'Deseja resetar os perfis da rodada atual e liberar "Ver seu perfil" para todos?'
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api('/admin/round/reset-profiles', 'POST');
      setMessage(result.message);
      setVoteTargetUserId('');
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminForceMillionaire(playerId, playerUsername) {
    clearFeedback();

    const confirmed = window.confirm(
      `Deseja forçar ${playerUsername} como milionário no próximo sorteio desta rodada?`
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api('/admin/game/forced-millionaire', 'PUT', { playerId });
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminResetPassword(playerId, playerUsername) {
    clearFeedback();

    const newPassword = adminPasswordByPlayer[playerId] || '';
    if (newPassword.length < 4) {
      setError('A nova senha deve ter ao menos 4 caracteres.');
      return;
    }

  const confirmed = window.confirm(`Deseja redefinir a senha do jogador ${playerUsername}?`);
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api(`/admin/players/${playerId}/password`, 'PUT', { newPassword });
      setMessage(result.message);
      setAdminPasswordByPlayer((prev) => ({
        ...prev,
        [playerId]: '',
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMission(missionId) {
    clearFeedback();

    const confirmed = window.confirm('Deseja remover esta missão?');
    if (!confirmed) return;

    setLoading(true);
    try {
      const result = await api(`/admin/missions/${missionId}`, 'DELETE');
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSetCurrentRound(event) {
    event.preventDefault();
    clearFeedback();

    const currentRound = Number(adminRoundInput);
    if (!Number.isInteger(currentRound) || currentRound < 1) {
      setError('Informe uma rodada válida (inteiro maior ou igual a 1).');
      return;
    }

    setLoading(true);
    try {
      const result = await api('/admin/game/current-round', 'PUT', { currentRound });
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSetPlayerPoints(playerId, playerUsername) {
    clearFeedback();

    const points = Number(adminPointsByPlayer[playerId]);
    if (!Number.isInteger(points)) {
      setError(`Pontuação inválida para ${playerUsername}. Informe um número inteiro.`);
      return;
    }

    setLoading(true);
    try {
      const result = await api(`/admin/players/${playerId}/points`, 'PUT', { points });
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSetAssignedMissionCompleted(assignmentId, completed) {
    clearFeedback();
    setLoading(true);

    try {
      const result = await api(`/admin/assigned-missions/${assignmentId}/completed`, 'PUT', { completed });
      setMessage(result.message);
      await refreshState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken('');
    setUser(null);
    setState(null);
    localStorage.removeItem('milionario_token');
    localStorage.removeItem('milionario_user');
    setMessage('Sessão finalizada.');
    setError('');
  }

  const statusLabel = useMemo(() => {
    if (!state) return 'Carregando...';
    if (state.isAdmin) return 'Admin acompanhando a rodada atual';
    if (state.totalPlayers < 4) return `Aguardando jogadores (${state.totalPlayers}/4)`;
    if (state.millionaireAvailable) return 'milionario disponivel';
    if (!state.profileViewed) return 'Clique em "Ver seu perfil" para descobrir seu papel';
    if (!state.allPlayersSubmittedMissions)
      return `Aguardando missões (${state.missionsCount}/${state.requiredTotalMissions})`;
    if (!state.votingStarted) return 'Aguardando início da votação';
    if (!state.votingFinalized) return `Votação em andamento (${state.votesCount}/3 votos)`;
    return 'Rodada concluída. O milionário pode iniciar a próxima rodada';
  }, [state]);
  const millionaireMissionsAlreadyAssigned = (state?.missionsVisibleToMillionaire || []).length === 4;

  if (!isLogged) {
    return (
      <main className={`min-h-screen flex items-center justify-center p-4 ${isDevelopmentMode ? 'pt-16' : ''}`}>
        {isDevelopmentMode && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-slate-950 text-center font-bold tracking-wide py-2 px-4 shadow-lg">
            MODO DE DESENVOLVIMENTO
          </div>
        )}
        <section className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6">
          <h1 className="text-3xl font-bold text-emerald-400 mb-2">O Milionario</h1>
          <p className="text-slate-300 mb-6">
            Jogo para 4 pessoas: 3 pobres e 1 milionário.
          </p>

          <div className="flex gap-2 mb-4">
            <button
              className={`px-4 py-2 rounded-lg font-semibold ${
                authMode === 'login' ? 'bg-emerald-500 text-white' : 'bg-slate-800'
              }`}
              onClick={() => setAuthMode('login')}
              type="button"
            >
              Login
            </button>
            <button
              className={`px-4 py-2 rounded-lg font-semibold ${
                authMode === 'register' ? 'bg-emerald-500 text-white' : 'bg-slate-800'
              }`}
              onClick={() => setAuthMode('register')}
              type="button"
            >
              Cadastro
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleAuth}>
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
              placeholder="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              className="w-full bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-800 transition rounded-lg py-2 font-bold"
              disabled={loading}
              type="submit"
            >
              {loading ? 'Enviando...' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          {error && <p className="mt-4 text-red-400">{error}</p>}
          {message && <p className="mt-4 text-emerald-400">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={`min-h-screen p-4 md:p-8 ${isDevelopmentMode ? 'pt-16 md:pt-20' : ''}`}>
      {isDevelopmentMode && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-slate-950 text-center font-bold tracking-wide py-2 px-4 shadow-lg">
          MODO DE DESENVOLVIMENTO
        </div>
      )}
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-emerald-400">O Milionario</h1>
            <p className="text-slate-300">
              Jogador: <strong>{user.username}</strong>{' '}
              {state?.myRole ? `· Perfil: ${state.myRole}` : '· Perfil oculto'}
            </p>
            <p className="text-sm text-slate-300 mt-1">
              Rodada: <strong>{state?.currentRound || 1}</strong>{' '}
              {!state?.isAdmin && (
                <>
                  · Pontos: <strong>{state?.myPoints ?? 0}</strong>
                </>
              )}
            </p>
            <p className="text-sm text-slate-400 mt-1">Status: {statusLabel}</p>
          </div>
          <div className="flex gap-2">
            {(state?.isAdmin || user?.isAdmin) && (
              <button
                className="bg-rose-600 hover:bg-rose-500 rounded-lg px-4 py-2 font-semibold"
                onClick={handleResetGame}
                disabled={loading}
                type="button"
              >
                Resetar rodada
              </button>
            )}
            <button
              className="bg-slate-800 hover:bg-slate-700 rounded-lg px-4 py-2"
              onClick={logout}
              type="button"
            >
              Sair
            </button>
          </div>
        </header>

        {error && <p className="text-red-400">{error}</p>}
        {message && <p className="text-emerald-400">{message}</p>}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <article className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-3">Jogadores</h2>
            <ul className="space-y-2">
              {(state?.players || []).map((player) => (
                <li key={player.id} className="bg-slate-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span>{player.username}</span>
                    <span className="text-xs text-emerald-300 font-semibold">{player.points ?? 0} pts</span>
                  </div>
                </li>
              ))}
            </ul>

            {!state?.isAdmin && (
              <button
                className="mt-4 w-full bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-800 rounded-lg py-2 font-bold"
                disabled={loading || !state?.isReadyToDraw || state?.profileViewed}
                onClick={handleRevealProfile}
                type="button"
              >
                {state?.profileViewed ? 'Perfil já revelado' : 'Ver seu perfil'}
              </button>
            )}
          </article>

          <article className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-3">Minhas missões</h2>
            <p className="text-sm text-slate-400 mb-3">
              Você deve cadastrar ao menos {state?.maxMissionsPerPlayer || 4} missões. Atual:{' '}
              {state?.myMissionsCount || 0}/{state?.maxMissionsPerPlayer || 4}
            </p>

            <form onSubmit={handleMissionSubmit} className="space-y-3 mb-4">
              <textarea
                className="w-full h-28 bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
                placeholder="Descreva uma missão..."
                value={missionText}
                onChange={(e) => setMissionText(e.target.value)}
              />
              <button
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-800 rounded-lg py-2 font-bold"
                disabled={loading}
                type="submit"
              >
                Salvar missão
              </button>
            </form>

            <ul className="space-y-2">
              {(state?.myMissions || []).map((mission) => (
                <li key={mission.id} className="bg-slate-800 rounded-lg px-3 py-2">
                  {mission.assignedToMillionaire && (
                    <p className="text-xs text-amber-300 mb-2 font-semibold">
                      Já atribuída ao milionário nesta rodada
                    </p>
                  )}
                  {editingMissionId === mission.id ? (
                    <form onSubmit={(event) => handleMissionEditSubmit(event, mission.id)} className="space-y-2">
                      <textarea
                        className="w-full h-24 bg-slate-900 rounded-lg px-3 py-2 border border-slate-700"
                        value={editingMissionText}
                        onChange={(e) => setEditingMissionText(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={loading || state?.profileViewed || mission.assignedToMillionaire}
                          className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-800 rounded-lg px-3 py-1 text-sm font-semibold"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMissionId(null);
                            setEditingMissionText('');
                          }}
                          className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1 text-sm font-semibold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <p>{mission.content}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={loading || state?.profileViewed || mission.assignedToMillionaire}
                          onClick={() => {
                            setEditingMissionId(mission.id);
                            setEditingMissionText(mission.content);
                          }}
                          className="bg-amber-500 hover:bg-amber-400 disabled:bg-amber-900 text-slate-900 rounded-lg px-2 py-1 text-xs font-bold"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={loading || state?.profileViewed || mission.assignedToMillionaire}
                          onClick={() => handleMissionRemove(mission.id)}
                          className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 rounded-lg px-2 py-1 text-xs font-bold"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </article>
        </section>

        {!state?.isAdmin && state?.myRole === 'POBRE' && state?.profileViewed && state?.allPlayersSubmittedMissions && (
          <section className="bg-slate-900 border border-indigo-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold text-indigo-300 mb-3">Votação da Rodada</h2>

            {!state?.votingStarted ? (
              <div className="space-y-3">
                <p className="text-slate-300 text-sm">
                  A votação começa quando os 4 jogadores clicarem em "Ver seu perfil".
                </p>
                <button
                  className="bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-800 rounded-lg px-4 py-2 font-semibold"
                  disabled={loading || !state?.allPlayersViewedProfiles}
                  onClick={handleStartVoting}
                  type="button"
                >
                  Iniciar votação
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  Votos: {state?.votesCount || 0}/3
                </p>

                {state?.votingFinalized ? (
                  <p className="text-emerald-300 text-sm font-semibold">
                    Votação finalizada! Pontuação da rodada já foi aplicada.
                  </p>
                ) : state?.hasVoted ? (
                  <p className="text-emerald-300 text-sm font-semibold">
                    Seu voto já foi registrado.
                  </p>
                ) : (
                  <form onSubmit={handleVoteSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {(state?.players || [])
                        .filter((player) => player.id !== user.id)
                        .map((player) => (
                          <label
                            key={player.id}
                            className="bg-slate-800 rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer"
                          >
                            <input
                              type="radio"
                              name="voteTarget"
                              value={String(player.id)}
                              checked={String(voteTargetUserId) === String(player.id)}
                              onChange={(e) => setVoteTargetUserId(e.target.value)}
                            />
                            <span>{player.username}</span>
                          </label>
                        ))}
                    </div>

                    <button
                      className="bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-800 rounded-lg px-4 py-2 font-semibold"
                      disabled={loading || !voteTargetUserId}
                      type="submit"
                    >
                      Confirmar voto
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>
        )}

        {state?.myRole === 'MILIONARIO' && (
          <section className="bg-slate-900 border border-amber-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold text-amber-300 mb-3">Painel do Milionário</h2>

            <p className="text-slate-300 mb-4">
              O sistema vai sortear aleatoriamente 1 missão de cada jogador (incluindo uma sua) para você.
              Isso só libera quando o sorteio de perfis terminar e todos tiverem 4 missões.
            </p>

            <button
              className="mb-4 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-800 text-slate-900 font-bold rounded-lg px-4 py-2"
              onClick={loadMillionaireMissions}
              disabled={
                loading ||
                !state?.drawDone ||
                !state?.allPlayersSubmittedMissions ||
                state?.myRole !== 'MILIONARIO' ||
                millionaireMissionsAlreadyAssigned
              }
              type="button"
            >
              {millionaireMissionsAlreadyAssigned
                ? 'Missões já sorteadas nesta rodada'
                : 'Ver minhas 4 missões sorteadas'}
            </button>

            {state?.canRefuseMillionaire && (
              <button
                className="mb-4 ml-2 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 text-white font-bold rounded-lg px-4 py-2"
                onClick={handleRefuseMillionaire}
                disabled={loading}
                type="button"
              >
                Recusar
              </button>
            )}

            <ul className="space-y-2">
              {(state?.missionsVisibleToMillionaire || []).map((mission) => (
                <li key={mission.id} className="bg-slate-800 rounded-lg px-3 py-3">
                  <p className="text-sm text-amber-300 font-semibold">
                    Missão sorteada de: {mission.ownerUsername}
                  </p>
                  <p>{mission.content}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span
                      className={`text-xs font-semibold ${
                        mission.completed ? 'text-emerald-300' : 'text-slate-300'
                      }`}
                    >
                      {mission.completed ? 'Concluída' : 'Pendente'}
                    </span>
                    <button
                      type="button"
                      disabled={loading || mission.completed || !state?.votingFinalized}
                      onClick={() => handleCompleteAssignedMission(mission.id)}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-900 text-slate-900 rounded-lg px-3 py-1 text-xs font-bold"
                    >
                      Marcar concluída
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-5 pt-4 border-t border-slate-700">
              <p className="text-sm text-slate-300 mb-3">
                Missões concluídas: {state?.completedAssignedMissionsCount || 0}/4
              </p>
              <button
                type="button"
                onClick={handleStartNextRound}
                disabled={loading || !state?.votingFinalized}
                className="bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-800 rounded-lg px-4 py-2 font-semibold"
              >
                Iniciar nova rodada
              </button>
            </div>
          </section>
        )}

        {(state?.isAdmin || user?.isAdmin) && (
          <section className="bg-slate-900 border border-rose-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold text-rose-300 mb-4">Painel do Admin</h2>
            <p className="text-sm text-slate-300 mb-4">
              Quantidade de milionários nesta rodada: <strong>{state?.adminData?.millionaireCount ?? 0}</strong>
            </p>

            <article className="mb-6 bg-slate-800 rounded-lg p-4">
              <h3 className="font-semibold mb-2">Configurar rodada atual</h3>
              <form onSubmit={handleAdminSetCurrentRound} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="number"
                  min="1"
                  value={adminRoundInput}
                  onChange={(e) => setAdminRoundInput(e.target.value)}
                  className="bg-slate-900 rounded-lg px-3 py-2 border border-slate-700 w-full sm:w-40"
                  placeholder="Rodada"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-900 rounded-lg px-4 py-2 font-semibold"
                >
                  Salvar rodada
                </button>
                <button
                  type="button"
                  disabled={loading}
                  className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 rounded-lg px-4 py-2 font-semibold"
                  onClick={handleAdminResetProfiles}
                >
                  Resetar perfis
                </button>
              </form>
              <p className="text-xs text-slate-400 mt-3">
                Milionário forçado para o próximo sorteio:{' '}
                <strong>
                  {(state?.adminData?.players || []).find(
                    (player) => player.id === state?.adminData?.forcedMillionaireUserId
                  )?.username || 'nenhum'}
                </strong>
              </p>
            </article>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <article>
                <h3 className="font-semibold mb-2">Remover jogadores</h3>
                <ul className="space-y-2">
                  {(state?.adminData?.players || []).map((player) => (
                    <li
                      key={player.id}
                      className="bg-slate-800 rounded-lg px-3 py-2 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          {player.username}{' '}
                          {player.id === state?.adminData?.forcedMillionaireUserId && (
                            <span className="text-xs text-amber-300 font-semibold">
                              · Milionário forçado
                            </span>
                          )}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={loading || state?.drawDone}
                            className="bg-amber-500 hover:bg-amber-400 disabled:bg-amber-900 text-slate-900 rounded-lg px-3 py-1 text-sm font-semibold"
                            onClick={() => handleAdminForceMillionaire(player.id, player.username)}
                          >
                            Forçar milionário
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 rounded-lg px-3 py-1 text-sm font-semibold"
                            onClick={() => handleRemovePlayer(player.id, player.username)}
                          >
                            Remover
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="number"
                          value={adminPointsByPlayer[player.id] ?? ''}
                          onChange={(e) =>
                            setAdminPointsByPlayer((prev) => ({
                              ...prev,
                              [player.id]: e.target.value,
                            }))
                          }
                          placeholder="Pontos"
                          className="flex-1 bg-slate-900 rounded-lg px-3 py-2 border border-slate-700"
                        />
                        <button
                          type="button"
                          disabled={loading}
                          className="bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-900 rounded-lg px-3 py-2 text-sm font-semibold"
                          onClick={() => handleAdminSetPlayerPoints(player.id, player.username)}
                        >
                          Salvar pontos
                        </button>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="password"
                          value={adminPasswordByPlayer[player.id] || ''}
                          onChange={(e) =>
                            setAdminPasswordByPlayer((prev) => ({
                              ...prev,
                              [player.id]: e.target.value,
                            }))
                          }
                          placeholder="Nova senha"
                          className="flex-1 bg-slate-900 rounded-lg px-3 py-2 border border-slate-700"
                        />
                        <button
                          type="button"
                          disabled={loading}
                          className="bg-amber-500 hover:bg-amber-400 disabled:bg-amber-900 text-slate-900 rounded-lg px-3 py-2 text-sm font-semibold"
                          onClick={() => handleAdminResetPassword(player.id, player.username)}
                        >
                          Resetar senha
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>

              <article>
                <h3 className="font-semibold mb-2">Missões atribuídas da rodada</h3>
                <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                  {(state?.adminData?.assignedMissions || []).map((assignment) => (
                    <li
                      key={assignment.id}
                      className="bg-slate-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-xs text-slate-400 mb-1">{assignment.ownerUsername}</p>
                        <p>Missão atribuída #{assignment.id}</p>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        className={`rounded-lg px-3 py-1 text-sm font-semibold ${
                          assignment.completed
                            ? 'bg-emerald-600 hover:bg-emerald-500'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                        }`}
                        onClick={() =>
                          handleAdminSetAssignedMissionCompleted(assignment.id, !assignment.completed)
                        }
                      >
                        {assignment.completed ? 'Concluída' : 'Pendente'}
                      </button>
                    </li>
                  ))}
                </ul>
              </article>

              <article>
                <h3 className="font-semibold mb-2">Remover missões</h3>
                <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                  {(state?.adminData?.missions || []).map((mission) => (
                    <li
                      key={mission.id}
                      className="bg-slate-800 rounded-lg px-3 py-2 flex items-start justify-between gap-3"
                    >
                      <div>
                        <p className="text-xs text-slate-400 mb-1">{mission.ownerUsername}</p>
                        <p>Missão #{mission.id}</p>
                        {mission.assignedToMillionaire && (
                          <p className="text-xs text-amber-300 mt-1 font-semibold">
                            Já atribuída ao milionário
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={loading || mission.assignedToMillionaire}
                        className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 rounded-lg px-3 py-1 text-sm font-semibold"
                        onClick={() => handleRemoveMission(mission.id)}
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
