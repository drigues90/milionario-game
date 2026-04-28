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

  async function handleRemovePlayer(playerId, playerLabel) {
    clearFeedback();

    const confirmed = window.confirm(`Deseja remover o ${playerLabel}?`);
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
    if (state.totalPlayers < 4) return `Aguardando jogadores (${state.totalPlayers}/4)`;
    if (!state.profileViewed) return 'Clique em "Ver seu perfil" para descobrir seu papel';
    if (!state.allPlayersSubmittedMissions)
      return `Aguardando missões (${state.missionsCount}/${state.requiredTotalMissions})`;
    return 'Jogo pronto para sortear 4 missões para o Milionário';
  }, [state]);

  if (!isLogged) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
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
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-emerald-400">O Milionario</h1>
            <p className="text-slate-300">
              Jogador: <strong>{user.username}</strong>{' '}
              {state?.myRole ? `· Perfil: ${state.myRole}` : '· Perfil oculto'}
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
                  {player.username}
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
              Você deve cadastrar {state?.maxMissionsPerPlayer || 4} missões. Atual:{' '}
              {state?.myMissionsCount || 0}/{state?.maxMissionsPerPlayer || 4}
            </p>

            {(state?.myMissionsCount || 0) < (state?.maxMissionsPerPlayer || 4) && (
              <form onSubmit={handleMissionSubmit} className="space-y-3 mb-4">
                <textarea
                  className="w-full h-28 bg-slate-800 rounded-lg px-3 py-2 border border-slate-700"
                  placeholder="Descreva uma missão..."
                  value={missionText}
                  onChange={(e) => setMissionText(e.target.value)}
                />
                <button
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-800 rounded-lg py-2 font-bold"
                  disabled={loading || !state?.isReadyToDraw}
                  type="submit"
                >
                  Salvar missão
                </button>
              </form>
            )}

            <ul className="space-y-2">
              {(state?.myMissions || []).map((mission) => (
                <li key={mission.id} className="bg-slate-800 rounded-lg px-3 py-2">
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
                          disabled={loading || state?.profileViewed}
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
                          disabled={loading || state?.profileViewed}
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
                          disabled={loading || state?.profileViewed}
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
                state?.myRole !== 'MILIONARIO'
              }
              type="button"
            >
              Sortear e ver minhas 4 missões
            </button>

            <ul className="space-y-2">
              {(state?.missionsVisibleToMillionaire || []).map((mission) => (
                <li key={mission.id} className="bg-slate-800 rounded-lg px-3 py-3">
                  <p className="text-sm text-amber-300 font-semibold">
                    Missão sorteada de: {mission.ownerUsername}
                  </p>
                  <p>{mission.content}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(state?.isAdmin || user?.isAdmin) && (
          <section className="bg-slate-900 border border-rose-700 rounded-2xl p-5">
            <h2 className="text-xl font-semibold text-rose-300 mb-4">Painel do Admin</h2>
            <p className="text-sm text-slate-300 mb-4">
              Quantidade de milionários nesta rodada: <strong>{state?.adminData?.millionaireCount ?? 0}</strong>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <article>
                <h3 className="font-semibold mb-2">Remover jogadores</h3>
                <ul className="space-y-2">
                  {(state?.adminData?.players || []).map((player) => (
                    <li
                      key={player.id}
                      className="bg-slate-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <span>{player.label}</span>
                      <button
                        type="button"
                        disabled={loading}
                        className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 rounded-lg px-3 py-1 text-sm font-semibold"
                        onClick={() => handleRemovePlayer(player.id, player.label)}
                      >
                        Remover
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
                        <p className="text-xs text-slate-400 mb-1">{mission.ownerLabel}</p>
                        <p>Missão #{mission.id}</p>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
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
