# O Milionario

Sistema web para 4 jogadores com:
- **Frontend:** React + Tailwind (via CDN, no browser)
- **Backend:** Node.js + Express
- **Banco:** SQLite (via `sql.js`, persistido em arquivo local)
- **Descoberta de rede:** Bonjour/mDNS (serviço `milionario`)
- **PWA:** instalável no celular/desktop (manifest + service worker)

## Regras implementadas

- Cadastro e login com usuário e senha.
- Limite de **4 jogadores** cadastrados.
- Sorteio automático de **1 Milionário** e **3 Pobres** ao clicar em **Ver seu perfil**.
- Cada jogador deve cadastrar **4 missões** (total de 16 missões no jogo).
- O sistema sorteia **1 missão de cada jogador** para o Milionário (4 missões no total), incluindo uma missão do próprio Milionário.
- Uma missão já atribuída ao Milionário em rodada anterior **não pode ser sorteada novamente**.
- O jogo agora funciona em **rodadas sequenciais**:
  - rodada inicia com novo sorteio de perfis ao clicar em **Ver seu perfil**;
  - após todos verem perfil, qualquer jogador pode iniciar a votação;
  - apenas os jogadores **POBRES** votam em quem acreditam ser o Milionário;
  - pontuação é aplicada automaticamente ao fim dos 3 votos (um por jogador pobre).
- Regras de pontuação:
  - acerto ao votar no Milionário: **+2 pontos**;
  - erro no voto: **-1 ponto**;
  - cada voto recebido pelo Milionário: **-1 ponto** para o Milionário.
  - cada missão concluída pelo Milionário: **+1 ponto** para o Milionário.
- Após a votação, o Milionário pode marcar missões sorteadas como concluídas (opcional, para pontuar).
- A **próxima rodada** pode ser iniciada após a votação finalizada, sem obrigatoriedade de marcar missões como concluídas.
- Cada jogador pode **editar/remover apenas as próprias missões**.
- Após clicar em **Ver seu perfil**, o jogador não pode mais editar nem remover missões.
- O Milionário só consegue ver as missões sorteadas quando:
  1. o sorteio foi realizado; e
  2. os 4 jogadores cadastraram 4 missões cada.
- Existe um usuário administrativo fixo para controle da rodada:
  - usuário: `admin`
  - senha: `admin`
  - esse perfil vê a tela como perfil pobre e possui um botão de **Resetar rodada**.
- O reset do admin limpa:
  - sorteio de perfis;
  - missões cadastradas;
  - missões sorteadas para o milionário;
  - votos e progresso de rodada;
  - pontuação e número da rodada (volta para rodada 1).
- O admin também pode:
  - remover jogadores (isso reinicia o sorteio da rodada);
  - remover missões individualmente.
  - resetar a senha de um jogador informando uma nova senha (sobrescreve a antiga).
  - definir manualmente qual é a rodada atual.
  - ajustar manualmente a pontuação atual de cada jogador.
  - marcar/desmarcar manualmente quais missões atribuídas já estão concluídas.
- No perfil do admin:
  - os usernames dos jogadores ficam visíveis para administração;
  - o texto das missões dos jogadores fica oculto;
  - é exibida apenas a quantidade de jogadores milionários na rodada.

## Estrutura

- `backend/` API e persistência.
- `frontend/` interface web (React + Tailwind em CDN).
- `backend/data/milionario.sqlite` arquivo de dados persistido localmente.

## PWA (Progressive Web App)

O frontend agora inclui:

- `frontend/manifest.webmanifest`
- `frontend/sw.js`
- `frontend/pwa-register.js`
- `frontend/icons/` (ícones do app)

Com isso, navegadores compatíveis podem instalar o app na tela inicial e manter o shell da interface em cache para abertura mais rápida.

## Como rodar

### 1) Instalar dependências do backend

```powershell
npm --prefix .\backend install
```

### 2) Iniciar o sistema

```powershell
npm --prefix .\backend start
```

Aplicação disponível em: `http://localhost:3001`

Na rede local, o backend também anuncia o serviço Bonjour com o nome `milionario` para facilitar a descoberta.

## Desenvolvimento (hot reload)

```powershell
npm --prefix .\backend run dev
```

## Testes

```powershell
npm --prefix .\backend test
```

## Migração para outro host

O projeto inclui scripts para empacotar e restaurar tudo (código + banco SQLite):

- `scripts/migration/export-host-migration.ps1`
- `scripts/migration/import-host-migration.ps1`

### 1) No host atual (origem): gerar pacote

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\migration\export-host-migration.ps1
```

Opcional: incluir também o `backend/.env` no pacote:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\migration\export-host-migration.ps1 -IncludeEnv
```

O script cria um ZIP em `migration-packages/`.

### 2) Copiar o ZIP para o novo host

Copie o arquivo `.zip` gerado para o servidor de destino.

### 3) No novo host (destino): restaurar pacote

```powershell
powershell -ExecutionPolicy Bypass -File .\import-host-migration.ps1 -PackagePath .\milionario-migration-YYYYMMDD-HHMMSS.zip -InstallDependencies
```

> Se você executou o comando fora da pasta dos scripts, use o caminho completo para `import-host-migration.ps1`.

### 3.1) No novo host Linux/Termux: restaurar pacote

Use o script:

- `scripts/migration/import-host-migration-termux.sh`

Pré-requisitos no Termux:

```bash
pkg update -y
pkg install -y nodejs unzip
```

Executar importação:

```bash
bash ./scripts/migration/import-host-migration-termux.sh -p ~/storage/downloads/milionario-migration-YYYYMMDD-HHMMSS.zip -t ~/apps -i
```

O parâmetro `-i` instala dependências do backend automaticamente.

### 4) Subir o backend no host novo

```powershell
cd .\milionario-migration-YYYYMMDD-HHMMSS\backend
npm start
```

Se necessário, ajuste `backend/.env` antes de iniciar.

## Variáveis de ambiente (opcional)

Crie um arquivo `.env` no `backend/` se quiser customizar:

- `PORT` (padrão: `3001`)
- `JWT_SECRET` (padrão de desenvolvimento interno)

## Fluxo de jogo sugerido

1. Quatro jogadores criam conta.
2. Cada jogador clica em **Ver seu perfil** para descobrir se é Milionário ou Pobre.
3. Cada jogador cadastra 4 missões (16 no total).
4. Após os 4 jogadores revelarem perfil, iniciar a votação.
5. Apenas os jogadores pobres votam em quem acham que é o Milionário.
6. O jogador **MILIONARIO** visualiza as 4 missões sorteadas, executa e marca cada uma como concluída.
7. Com a votação finalizada, o Milionário pode iniciar a próxima rodada (concluir missões é opcional).
8. Se necessário, o usuário `admin` pode usar **Resetar rodada** para zerar o jogo inteiro.
9. O `admin` pode remover jogadores e missões pelo **Painel do Admin**.
10. O `admin` também pode redefinir senha de jogadores pelo **Painel do Admin**.

## Observação técnica

O frontend foi implementado em React + Tailwind com CDN para garantir execução no ambiente atual sem etapa de build local, mantendo o requisito de uso dessas tecnologias e acesso via navegador.
