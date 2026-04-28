const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Inicialização do Banco de Dados SQLite
const db = new sqlite3.Database('./game.db', (err) => {
    if (err) console.error('Erro ao abrir banco:', err.message);
    console.log('Conectado ao banco SQLite.');
});

// Criar tabelas
db.serialize(() => {
    // Tabela de Jogadores
    db.run(`CREATE TABLE IF NOT EXISTS players (
        username TEXT PRIMARY KEY,
        password TEXT,
        ready INTEGER DEFAULT 0
    )`);

    // Tabela de Missões
    db.run(`CREATE TABLE IF NOT EXISTS missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        mission_text TEXT,
        FOREIGN KEY(username) REFERENCES players(username)
    )`);

    // Tabela de Estado do Jogo
    db.run(`CREATE TABLE IF NOT EXISTS game_state (
        id INTEGER PRIMARY KEY,
        status TEXT,
        millionaire_name TEXT,
        assigned_missions TEXT
    )`);

    // Inicializar estado se vazio
    db.run(`INSERT OR IGNORE INTO game_state (id, status) VALUES (1, 'LOBBY')`);
});

// --- API Endpoints ---

// Login / Cadastro
app.post('/api/auth', (req, res) => {
    const { username, password, isRegistering } = req.body;
    
    if (isRegistering) {
        db.run(`INSERT INTO players (username, password) VALUES (?, ?)`, [username, password], function(err) {
            if (err) return res.status(400).json({ error: 'Usuário já existe' });
            res.json({ success: true });
        });
    } else {
        db.get(`SELECT * FROM players WHERE username = ? AND password = ?`, [username, password], (err, row) => {
            if (!row) return res.status(401).json({ error: 'Credenciais inválidas' });
            res.json({ success: true, username: row.username });
        });
    }
});

// Enviar Missões
app.post('/api/missions', (req, res) => {
    const { username, missions } = req.body;
    
    db.serialize(() => {
        db.run(`DELETE FROM missions WHERE username = ?`, [username]);
        const stmt = db.prepare(`INSERT INTO missions (username, mission_text) VALUES (?, ?)`);
        missions.forEach(m => stmt.run(username, m));
        stmt.finalize();
        db.run(`UPDATE players SET ready = 1 WHERE username = ?`, [username]);
        
        io.emit('update'); // Avisa a todos que alguém ficou pronto
        res.json({ success: true });
    });
});

// Realizar Sorteio
app.post('/api/draw', (req, res) => {
    db.all(`SELECT username FROM players WHERE ready = 1`, [], (err, players) => {
        if (players.length < 4) return res.status(400).json({ error: 'Aguarde 4 jogadores prontos' });

        const millionaire = players[Math.floor(Math.random() * players.length)].username;
        
        // Pegar uma missão aleatória de cada um dos 4 jogadores
        db.all(`SELECT username, mission_text FROM missions`, [], (err, allMissions) => {
            const selectedMissions = [];
            players.forEach(p => {
                const pMissions = allMissions.filter(m => m.username === p.username);
                const randomM = pMissions[Math.floor(Math.random() * pMissions.length)];
                selectedMissions.push({ from: p.username, text: randomM.mission_text });
            });

            db.run(`UPDATE game_state SET status = 'PLAYING', millionaire_name = ?, assigned_missions = ? WHERE id = 1`, 
                [millionaire, JSON.stringify(selectedMissions)], () => {
                    io.emit('gameStarted');
                    res.json({ success: true });
                }
            );
        });
    });
});

// Resetar Jogo
app.post('/api/reset', (req, res) => {
    db.serialize(() => {
        db.run(`UPDATE players SET ready = 0`);
        db.run(`DELETE FROM missions`);
        db.run(`UPDATE game_state SET status = 'LOBBY', millionaire_name = NULL, assigned_missions = NULL WHERE id = 1`);
        io.emit('update');
        res.json({ success: true });
    });
});

// Obter Dados Gerais (Polling/Initial)
app.get('/api/status', (req, res) => {
    db.get(`SELECT * FROM game_state WHERE id = 1`, (err, game) => {
        db.all(`SELECT username, ready FROM players`, (err, players) => {
            res.json({ game, players });
        });
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});